export const ATTRIBUTION_CHANNELS = [
  "direct",
  "organic",
  "referral",
  "relationship_outreach",
  "approved_campaign",
  "demo",
  "unknown",
] as const;

export type AttributionChannel = (typeof ATTRIBUTION_CHANNELS)[number];

export type SafeTouch = {
  channel: AttributionChannel;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
};

export type SafeAttribution = {
  anonymousId: string;
  firstTouch: SafeTouch;
  lastTouch: SafeTouch;
};

const SAFE_UTM = /^[a-zA-Z0-9._~-]+$/;
export const SAFE_UTM_SOURCES = [
  "approved_campaign",
  "bing",
  "demo",
  "direct",
  "duckduckgo",
  "google",
  "linkedin",
  "newsletter",
  "referral",
  "relationship",
  "yahoo",
] as const;
export const SAFE_UTM_MEDIA = [
  "approved_campaign",
  "demo",
  "email",
  "organic",
  "outreach",
  "referral",
  "relationship",
] as const;
const SAFE_SOURCES = new Set<string>(SAFE_UTM_SOURCES);
const SAFE_MEDIA = new Set<string>(SAFE_UTM_MEDIA);
const SEARCH_HOSTS = new Set([
  "bing.com",
  "duckduckgo.com",
  "google.com",
  "search.brave.com",
  "yahoo.com",
]);

export function sanitizeUtm(
  value: string | null | undefined,
  maxLength = 64,
) {
  if (!value) return undefined;
  const trimmed = value.trim().slice(0, maxLength);
  return SAFE_UTM.test(trimmed) ? trimmed : undefined;
}

function normalizedHost(host: string | null | undefined) {
  return (host ?? "").trim().toLowerCase().replace(/^www\./, "");
}

function isSearchHost(host: string) {
  return [...SEARCH_HOSTS].some(
    (searchHost) => host === searchHost || host.endsWith(`.${searchHost}`),
  );
}

export function classifyTouch(input: {
  pathname: string;
  siteHost: string;
  referrerHost?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
}): SafeTouch {
  const sourceCandidate = sanitizeUtm(input.utmSource)?.toLowerCase();
  const mediumCandidate = sanitizeUtm(input.utmMedium)?.toLowerCase();
  const campaignCandidate = sanitizeUtm(input.utmCampaign, 96)?.toLowerCase();
  const utmSource =
    sourceCandidate && SAFE_SOURCES.has(sourceCandidate)
      ? sourceCandidate
      : undefined;
  const utmMedium =
    mediumCandidate && SAFE_MEDIA.has(mediumCandidate)
      ? mediumCandidate
      : undefined;
  const utmCampaign =
    campaignCandidate &&
    (campaignCandidate.startsWith("billguarded-") ||
      campaignCandidate.startsWith("bg-"))
      ? campaignCandidate
      : undefined;
  const hadUtm = Boolean(
    input.utmSource || input.utmMedium || input.utmCampaign,
  );
  const normalizedSource = utmSource?.toLowerCase();
  const normalizedMedium = utmMedium?.toLowerCase();
  const normalizedCampaign = utmCampaign?.toLowerCase();

  let channel: AttributionChannel = "unknown";
  if (
    normalizedSource === "relationship" ||
    normalizedMedium === "relationship" ||
    normalizedMedium === "outreach" ||
    normalizedCampaign?.startsWith("billguarded-relationship-") ||
    normalizedCampaign?.startsWith("bg-relationship-")
  ) {
    channel = "relationship_outreach";
  } else if (
    normalizedSource === "approved_campaign" ||
    normalizedMedium === "approved_campaign"
  ) {
    channel = "approved_campaign";
  } else if (normalizedMedium === "organic") {
    channel = "organic";
  } else if (normalizedMedium === "referral") {
    channel = "referral";
  } else if (hadUtm) {
    channel = "unknown";
  } else {
    const referrerHost = normalizedHost(input.referrerHost);
    const siteHost = normalizedHost(input.siteHost);
    if (!referrerHost || referrerHost === siteHost) {
      channel = "direct";
    } else if (isSearchHost(referrerHost)) {
      channel = "organic";
    } else {
      channel = "referral";
    }
  }

  return {
    channel,
    ...(utmSource ? { utmSource } : {}),
    ...(utmMedium ? { utmMedium } : {}),
    ...(utmCampaign ? { utmCampaign } : {}),
  };
}

export function demoTouch(): SafeTouch {
  return { channel: "demo" };
}
