export function deliveryIdempotencyKey(fingerprint: string) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new Error("delivery_fingerprint_invalid");
  }
  return `billguarded/audit-complete/${fingerprint}`;
}

export function providerErrorDetails(error: unknown) {
  const value =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : {};

  return {
    code:
      typeof value.name === "string"
        ? value.name.slice(0, 120)
        : "resend_rejected",
    message:
      typeof value.message === "string"
        ? value.message.slice(0, 500)
        : "Resend rejected the delivery request.",
    statusCode:
      typeof value.statusCode === "number" ? value.statusCode : null,
  };
}

export function resendFailureIsRetryable(error: unknown) {
  const details = providerErrorDetails(error);
  return (
    details.statusCode === 408 ||
    details.statusCode === 409 ||
    details.statusCode === 429 ||
    (details.statusCode !== null && details.statusCode >= 500) ||
    [
      "application_error",
      "internal_server_error",
      "rate_limit_exceeded",
      "concurrent_idempotent_requests",
    ].includes(details.code)
  );
}
