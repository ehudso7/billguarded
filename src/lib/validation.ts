import { z } from "zod";

export const intakeSchema = z.object({
  company: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  monthly3plSpend: z.coerce.number().int().min(0).max(100_000_000),
  invoiceCount: z.coerce.number().int().min(1).max(10_000),
});

export const uploadRequestSchema = z.object({
  requestId: z.string().uuid(),
  filename: z.string().trim().min(1).max(180),
  contentType: z.string().trim().min(1).max(120),
  size: z.number().int().positive().max(20 * 1024 * 1024),
  kind: z.enum(["contract", "rate_card", "invoice"]),
});

export const confirmUploadSchema = uploadRequestSchema.omit({
  filename: true,
}).extend({
  originalFilename: z.string().trim().min(1).max(180),
  storagePath: z.string().trim().min(1).max(500),
});

export const checkoutSchema = z.object({
  requestId: z.string().uuid(),
  offer: z.enum(["audit_90_day", "continuous_monitor"]),
});

export const allowedDocumentTypes = new Set([
  "application/pdf",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
]);

export function safeFilename(filename: string) {
  const cleaned = filename
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return cleaned.slice(0, 120) || "document";
}
