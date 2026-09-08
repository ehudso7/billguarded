import type { MetadataRoute } from "next";

const baseUrl = "https://billguarded.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-09-08T00:00:00.000Z");
  const auditLandingModified = new Date("2026-09-08T00:00:00.000Z");

  return [
    { url: `${baseUrl}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    {
      url: `${baseUrl}/3pl-invoice-audit`,
      lastModified: auditLandingModified,
      changeFrequency: "weekly",
      priority: 0.95,
    },
    {
      url: `${baseUrl}/demo`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/security`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.4,
    },
  ];
}
