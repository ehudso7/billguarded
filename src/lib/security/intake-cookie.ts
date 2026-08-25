import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { supabaseServerEnv } from "@/lib/env";

const COOKIE_VERSION = "v1";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24;
const SIGNING_CONTEXT = "billguarded:intake-cookie:v1";

type IntakePayload = {
  requestId: string;
  exp: number;
};

let cachedSigningKey: Buffer | undefined;

function signingKey() {
  if (!cachedSigningKey) {
    cachedSigningKey = createHash("sha256")
      .update(SIGNING_CONTEXT, "utf8")
      .update("\0", "utf8")
      .update(supabaseServerEnv().SUPABASE_SECRET_KEY, "utf8")
      .digest();
  }
  return cachedSigningKey;
}

function sign(value: string) {
  return createHmac("sha256", signingKey()).update(value).digest("base64url");
}

export function createIntakeCookie(requestId: string) {
  const payload: IntakePayload = {
    requestId,
    exp: Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(`${COOKIE_VERSION}.${encoded}`);
  return {
    value: `${COOKIE_VERSION}.${encoded}.${signature}`,
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}

export function verifyIntakeCookie(value: string | undefined | null) {
  if (!value) return null;
  const [version, encoded, signature] = value.split(".");
  if (version !== COOKIE_VERSION || !encoded || !signature) return null;

  const expected = sign(`${version}.${encoded}`);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as IntakePayload;
    if (
      typeof payload.requestId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(payload.requestId) ||
      typeof payload.exp !== "number" ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export const intakeCookieName = "billguarded_intake_access";
