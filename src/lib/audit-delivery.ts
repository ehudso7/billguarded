import { z } from "zod";
import { recordAuditFunnelEvent } from "@/lib/funnel-analytics";
import {
  AUDIT_COMPLETION_SUBJECT,
  AUDIT_COMPLETION_TEMPLATE_VERSION,
  buildAuditCompletionEmail,
} from "@/lib/audit-delivery-email";
import {
  deliveryIdempotencyKey,
  providerErrorDetails,
  resendFailureIsRetryable,
} from "@/lib/delivery-policy";
import { resend } from "@/lib/resend";
import { supabaseAdmin } from "@/lib/supabase-admin";

type DeliveryClaimRow = {
  delivery_id: string;
  audit_request_id: string;
  audit_run_id: string;
  claim_token: string;
  recipient_email: string;
  checkout_session_id: string;
  delivery_fingerprint: string;
  template_version: string;
  subject: string;
};

export type DeliverySweepResult =
  | { state: "idle" }
  | {
      state:
        | "accepted"
        | "retryable"
        | "failed"
        | "acceptance_uncertain";
      deliveryId: string;
    };

const recipientSchema = z.email().max(254);

async function recordDeliveryFailure(input: {
  claim: DeliveryClaimRow;
  retryable: boolean;
  error: unknown;
}): Promise<DeliverySweepResult> {
  const details = providerErrorDetails(input.error);
  const { data, error } = await supabaseAdmin().rpc(
    "billguarded_record_delivery_failure",
    {
      p_delivery_id: input.claim.delivery_id,
      p_claim_token: input.claim.claim_token,
      p_retryable: input.retryable,
      p_error_code: details.code,
      p_error_message: details.message,
    },
  );
  if (error) throw error;

  try {
    await recordAuditFunnelEvent({
      auditRequestId: input.claim.audit_request_id,
      eventName: "delivery_failed",
      dedupePart: `${input.claim.delivery_id}:${input.claim.claim_token}`,
      outcome: input.retryable ? "retryable" : "terminal",
    });
  } catch (analyticsError) {
    console.error(
      "delivery_failure_funnel_event_failed",
      analyticsError &&
        typeof analyticsError === "object" &&
        "code" in analyticsError
        ? String(analyticsError.code).slice(0, 80)
        : "unknown_error",
    );
  }

  return {
    state: data === "retryable" ? "retryable" : "failed",
    deliveryId: input.claim.delivery_id,
  };
}

async function quarantineUncertainAcceptance(
  claim: DeliveryClaimRow,
  message: string,
): Promise<DeliverySweepResult> {
  const { error } = await supabaseAdmin().rpc(
    "billguarded_record_delivery_uncertain",
    {
      p_delivery_id: claim.delivery_id,
      p_claim_token: claim.claim_token,
      p_error_message: message.slice(0, 500),
    },
  );
  if (error) {
    console.error(
      "billguarded_delivery_uncertain_persistence_failed",
      claim.delivery_id,
    );
  }

  return {
    state: "acceptance_uncertain",
    deliveryId: claim.delivery_id,
  };
}

async function persistProviderAcceptance(
  claim: DeliveryClaimRow,
  providerMessageId: string,
): Promise<DeliverySweepResult> {
  let lastError: unknown;

  for (const delayMs of [0, 250, 1000]) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const { data, error } = await supabaseAdmin().rpc(
      "billguarded_record_delivery_accepted",
      {
        p_delivery_id: claim.delivery_id,
        p_claim_token: claim.claim_token,
        p_provider_message_id: providerMessageId,
      },
    );
    if (!error && data === true) {
      try {
        await recordAuditFunnelEvent({
          auditRequestId: claim.audit_request_id,
          eventName: "customer_notified",
          dedupePart: claim.delivery_id,
        });
      } catch (analyticsError) {
        console.error(
          "customer_notification_funnel_event_failed",
          analyticsError &&
            typeof analyticsError === "object" &&
            "code" in analyticsError
            ? String(analyticsError.code).slice(0, 80)
            : "unknown_error",
        );
      }
      return { state: "accepted", deliveryId: claim.delivery_id };
    }
    lastError = error;

    const { data: current } = await supabaseAdmin()
      .from("audit_deliveries")
      .select("status,provider_message_id")
      .eq("id", claim.delivery_id)
      .maybeSingle();

    if (
      current?.provider_message_id === providerMessageId &&
      ["accepted", "sent", "delivered", "bounced", "failed", "suppressed", "complained"].includes(
        current.status,
      )
    ) {
      return { state: "accepted", deliveryId: claim.delivery_id };
    }
  }

  console.error(
    "billguarded_provider_accepted_state_uncertain",
    claim.delivery_id,
    providerMessageId,
    lastError instanceof Error ? lastError.message.slice(0, 160) : "database_write_unconfirmed",
  );

  return quarantineUncertainAcceptance(
    claim,
    "Resend returned an accepted message ID, but database acceptance persistence could not be confirmed. Reconcile the known provider message ID before any further action.",
  );
}

export async function claimDelivery(
  workerId: string,
): Promise<DeliveryClaimRow | null> {
  const { data, error } = await supabaseAdmin().rpc(
    "billguarded_claim_delivery",
    {
      p_worker_id: workerId,
      p_lease_seconds: 300,
    },
  );
  if (error) throw error;

  return ((data ?? []) as DeliveryClaimRow[])[0] ?? null;
}

export async function sweepOneDelivery(
  workerId: string,
): Promise<DeliverySweepResult> {
  const claim = await claimDelivery(workerId);
  if (!claim) return { state: "idle" };

  if (
    !recipientSchema.safeParse(claim.recipient_email).success ||
    claim.template_version !== AUDIT_COMPLETION_TEMPLATE_VERSION ||
    claim.subject !== AUDIT_COMPLETION_SUBJECT
  ) {
    return recordDeliveryFailure({
      claim,
      retryable: false,
      error: {
        name: "delivery_contract_invalid",
        message: "The claimed delivery did not match the approved completion template contract.",
      },
    });
  }

  const email = buildAuditCompletionEmail({
    recipientEmail: claim.recipient_email,
    checkoutSessionId: claim.checkout_session_id,
  });

  const { data: began, error: beginError } = await supabaseAdmin().rpc(
    "billguarded_begin_delivery_send",
    {
      p_delivery_id: claim.delivery_id,
      p_claim_token: claim.claim_token,
    },
  );
  if (beginError) throw beginError;
  if (!began) {
    return {
      state: "acceptance_uncertain",
      deliveryId: claim.delivery_id,
    };
  }

  try {
    const response = await resend().emails.send(email, {
      idempotencyKey: deliveryIdempotencyKey(
        claim.delivery_fingerprint,
      ),
    });

    if (response.error) {
      return recordDeliveryFailure({
        claim,
        retryable: resendFailureIsRetryable(response.error),
        error: response.error,
      });
    }

    if (!response.data?.id) {
      return quarantineUncertainAcceptance(
        claim,
        "Resend returned no error and no provider message ID. Manual provider reconciliation is required.",
      );
    }

    return persistProviderAcceptance(claim, response.data.id);
  } catch (error) {
    return quarantineUncertainAcceptance(
      claim,
      error instanceof Error
        ? `Resend outcome was not observable: ${error.message.slice(0, 380)}`
        : "Resend outcome was not observable. Manual provider reconciliation is required.",
    );
  }
}
