export const AUDIT_COMPLETION_TEMPLATE_VERSION = "audit-complete-v1";
export const AUDIT_COMPLETION_SUBJECT =
  "Your BillGuarded audit is complete";

export const BILLGUARDED_EMAIL_DOMAIN = "billguarded.com";
export const BILLGUARDED_PROMOTIONAL_EMAIL =
  `hello@${BILLGUARDED_EMAIL_DOMAIN}`;
export const BILLGUARDED_SUPPORT_EMAIL =
  `support@${BILLGUARDED_EMAIL_DOMAIN}`;
export const BILLGUARDED_SUPPORT_SENDER =
  `BillGuarded <${BILLGUARDED_SUPPORT_EMAIL}>`;

const LIVE_CHECKOUT_SESSION = /^cs_live_[A-Za-z0-9_]+$/;

export type AuditCompletionEmail = {
  from: string;
  to: string[];
  replyTo: string;
  subject: string;
  text: string;
  html: string;
};

export function auditRecoveryUrl(checkoutSessionId: string) {
  if (!LIVE_CHECKOUT_SESSION.test(checkoutSessionId)) {
    throw new Error("live_recovery_session_required");
  }

  return `https://billguarded.com/recover#session_id=${encodeURIComponent(checkoutSessionId)}`;
}

export function buildAuditCompletionEmail(input: {
  recipientEmail: string;
  checkoutSessionId: string;
}): AuditCompletionEmail {
  const recoveryUrl = auditRecoveryUrl(input.checkoutSessionId);

  return {
    from: BILLGUARDED_SUPPORT_SENDER,
    to: [input.recipientEmail],
    replyTo: BILLGUARDED_SUPPORT_EMAIL,
    subject: AUDIT_COMPLETION_SUBJECT,
    text: [
      "Your BillGuarded audit is complete.",
      "",
      "Use this private recovery link to access your audit:",
      recoveryUrl,
      "",
      "Do not forward this private link. It grants access to your audit workspace.",
      "",
      `Need help? Contact ${BILLGUARDED_SUPPORT_EMAIL}.`,
      "",
      "BillGuarded provides evidence and reconciliation software. It does not guarantee a refund, credit, reimbursement, or recovery.",
    ].join("\n"),
    html: [
      "<p>Your BillGuarded audit is complete.</p>",
      `<p><a href="${recoveryUrl}">Open your private audit workspace</a></p>`,
      "<p><strong>Do not forward this private link.</strong> It grants access to your audit workspace.</p>",
      `<p>Need help? Contact <a href="mailto:${BILLGUARDED_SUPPORT_EMAIL}">${BILLGUARDED_SUPPORT_EMAIL}</a>.</p>`,
      "<p>BillGuarded provides evidence and reconciliation software. It does not guarantee a refund, credit, reimbursement, or recovery.</p>",
    ].join(""),
  };
}
