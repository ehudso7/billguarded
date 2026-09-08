"use client";

import {
  ATTRIBUTION_CHANNELS,
  classifyTouch,
  demoTouch,
  SAFE_UTM_MEDIA,
  SAFE_UTM_SOURCES,
  type SafeAttribution,
  type SafeTouch,
} from "@/lib/funnel-attribution";
import type {
  FunnelEventName,
  PublicAnalyticsPath,
} from "@/lib/funnel-events";

const ANONYMOUS_ID_KEY = "billguarded_analytics_id_v1";
const FIRST_TOUCH_KEY = "billguarded_first_touch_v1";
const LAST_TOUCH_KEY = "billguarded_last_touch_v1";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHANNELS = new Set<string>(ATTRIBUTION_CHANNELS);
const SOURCES = new Set<string>(SAFE_UTM_SOURCES);
const MEDIA = new Set<string>(SAFE_UTM_MEDIA);

function validCampaign(value: unknown) {
  return (
    typeof value === "string" &&
    value.length <= 96 &&
    /^(?:billguarded-|bg-)[a-zA-Z0-9._~-]*$/.test(value)
  );
}

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readTouch(key: string): SafeTouch | null {
  try {
    const value = storage()?.getItem(key);
    if (!value) return null;
    const parsed = JSON.parse(value) as SafeTouch;
    if (
      !parsed ||
      !CHANNELS.has(parsed.channel) ||
      (parsed.utmSource !== undefined && !SOURCES.has(parsed.utmSource)) ||
      (parsed.utmMedium !== undefined && !MEDIA.has(parsed.utmMedium)) ||
      (parsed.utmCampaign !== undefined && !validCampaign(parsed.utmCampaign))
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeTouch(key: string, touch: SafeTouch) {
  try {
    storage()?.setItem(key, JSON.stringify(touch));
  } catch {
    // Attribution must never block the buyer flow.
  }
}

function anonymousId() {
  const existing = storage()?.getItem(ANONYMOUS_ID_KEY);
  if (existing && UUID_PATTERN.test(existing)) return existing;
  const created = window.crypto.randomUUID();
  try {
    storage()?.setItem(ANONYMOUS_ID_KEY, created);
  } catch {
    // The current event can still use the in-memory identifier.
  }
  return created;
}

function referrerHost() {
  if (!document.referrer) return null;
  try {
    return new URL(document.referrer).hostname;
  } catch {
    return null;
  }
}

export function currentAttribution(): SafeAttribution {
  const params = new URLSearchParams(window.location.search);
  const observed = classifyTouch({
    pathname: window.location.pathname,
    siteHost: window.location.hostname,
    referrerHost: referrerHost(),
    utmSource: params.get("utm_source"),
    utmMedium: params.get("utm_medium"),
    utmCampaign: params.get("utm_campaign"),
  });
  const firstTouch = readTouch(FIRST_TOUCH_KEY) ?? observed;
  const lastTouch =
    params.has("utm_source") ||
    params.has("utm_medium") ||
    params.has("utm_campaign") ||
    !readTouch(LAST_TOUCH_KEY)
      ? observed
      : readTouch(LAST_TOUCH_KEY)!;

  writeTouch(FIRST_TOUCH_KEY, firstTouch);
  writeTouch(LAST_TOUCH_KEY, lastTouch);

  return { anonymousId: anonymousId(), firstTouch, lastTouch };
}

export function markDemoTouch() {
  writeTouch(LAST_TOUCH_KEY, demoTouch());
}

export async function captureFunnelEvent(
  eventName: FunnelEventName,
  path: PublicAnalyticsPath,
) {
  const attribution = currentAttribution();
  const payload = {
    eventName,
    eventId: window.crypto.randomUUID(),
    anonymousId: attribution.anonymousId,
    path,
    firstTouch: attribution.firstTouch,
    lastTouch: attribution.lastTouch,
  };

  try {
    await fetch("/api/analytics/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "same-origin",
      keepalive: true,
    });
  } catch {
    // Measurement must never interrupt the customer journey.
  }
}
