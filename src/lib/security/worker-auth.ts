import { timingSafeEqual } from "node:crypto";

export function workerAuthorizationValid(
  authorizationHeader: string | null,
  secret: string,
) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorizationHeader ?? "");

  return (
    actual.length === expected.length &&
    timingSafeEqual(actual, expected)
  );
}
