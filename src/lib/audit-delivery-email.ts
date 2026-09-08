export const AUDIT_COMPLETION_TEMPLATE_VERSION = "audit-complete-v1";
export const AUDIT_COMPLETION_SUBJECT =
  "Your BillGuarded 90-Day Audit is complete";
export const BILLGUARDED_SUPPORT_SENDER =
  "BillGuarded <support@billguarded.com>";

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
    replyTo: "support@billguarded.com",
    subject: AUDIT_COMPLETION_SUBJECT,
    text: [
      "Your BillGuarded 90-Day Audit is complete.",
      "",
      "Use this private recovery link to access your audit:",
      recoveryUrl,
      "",
      "Do not forward this private link. It grants access to your audit workspace.",
      "",
      "Need help? Contact support@billguarded.com.",
      "",
      "BillGuarded provides evidence and reconciliation software. It does not guarantee a refund, credit, reimbursement, or recovery.",
    ].join("\n"),
    html: [
      "<p>Your BillGuarded 90-Day Audit is complete.</p>",
      `<p><a href="${recoveryUrl}">Open your private audit workspace</a></p>`,
      "<p><strong>Do not forward this private link.</strong> It grants access to your audit workspace.</p>",
      "<p>Need help? Contact <a href=\"mailto:support@billguarded.com\">support@billguarded.com</a>.</p>",
      "<p>BillGuarded provides evidence and reconciliation software. It does not guarantee a refund, credit, reimbursement, or recovery.</p>",
    ].join(""),
  };
}
