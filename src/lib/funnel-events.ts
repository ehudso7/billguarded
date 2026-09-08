export const FUNNEL_EVENT_NAMES = [
  "landing_view",
  "demo_view",
  "fit_check_click",
  "intake_started",
  "intake_completed",
  "rate_card_uploaded",
  "invoice_upload_completed",
  "unsupported_file_rejected",
  "upload_failed",
  "checkout_started",
  "checkout_creation_failed",
  "checkout_abandoned",
  "paid_audit_confirmed",
  "paid_audit_queued",
  "audit_completed",
  "audit_failed",
  "customer_notified",
  "delivery_failed",
  "report_recovery_opened",
] as const;

export type FunnelEventName = (typeof FUNNEL_EVENT_NAMES)[number];

export const CLIENT_FUNNEL_EVENTS = [
  "landing_view",
  "demo_view",
  "fit_check_click",
  "intake_started",
  "unsupported_file_rejected",
  "upload_failed",
  "checkout_creation_failed",
  "checkout_abandoned",
] as const satisfies readonly FunnelEventName[];

export const PUBLIC_ANALYTICS_PATHS = [
  "/",
  "/3pl-invoice-audit",
  "/demo",
  "/start",
] as const;

export type PublicAnalyticsPath = (typeof PUBLIC_ANALYTICS_PATHS)[number];
