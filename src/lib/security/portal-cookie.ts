import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { serverEnv } from "@/lib/env";

const COOKIE_VERSION = "v1";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

type PortalPayload = {
  customerId: string;
  exp: number;
};

function sign(value: string) {
  return createHmac("sha256", serverEnv().APP_SIGNING_SECRET)
    .update(value)
    .digest("base64url");
}

export function createPortalCookie(customerId: string) {
  const payload: PortalPayload = {
    customerId,
    exp: Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE_SECONDS,
  };

  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = sign(`${COOKIE_VERSION}.${encoded}`);

  return {
    value: `${COOKIE_VERSION}.${encoded}.${signature}`,
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}

export function verifyPortalCookie(value: string | undefined | null) {
  if (!value) return null;

  const [version, encoded, signature] = value.split(".");
  if (
    version !== COOKIE_VERSION ||
    !encoded ||
    !signature
  ) {
    return null;
  }

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
    ) as PortalPayload;

    if (
      typeof payload.customerId !== "string" ||
      !payload.customerId.startsWith("cus_") ||
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

export const portalCookieName = "reqovr_billing_access";
