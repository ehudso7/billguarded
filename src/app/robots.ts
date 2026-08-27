import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/privacy", "/terms", "/security"],
      disallow: ["/api/", "/checkout/", "/success", "/start", "/recover"],
    },
    sitemap: "https://billguarded.com/sitemap.xml",
  };
}
