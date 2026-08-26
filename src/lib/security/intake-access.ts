import { createHash } from "node:crypto";

export function intakeAccessTokenHash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
