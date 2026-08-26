const PRODUCTION_ORIGIN = "https://www.billguarded.com";

export function applicationOrigin(requestUrl: string) {
  if (process.env.VERCEL_ENV === "production") return PRODUCTION_ORIGIN;
  return new URL(requestUrl).origin;
}
