import { z } from "zod";

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export const intakeSchema = z.object({
  company: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  monthly3plSpend: z.coerce.number().int().min(0).max(100_000_000),
  invoiceCount: z.coerce.number().int().min(1).max(10_000),
  acceptedTerms: z.literal(true),
  website: z.string().max(0).optional().default(""),
});

export const uploadRequestSchema = z.object({
  requestId: z.string().uuid(),
  filename: z.string().trim().min(1).max(180),
  contentType: z.string().trim().min(1).max(120),
  size: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
  kind: z.enum(["contract", "rate_card", "invoice"]),
});

export const confirmUploadSchema = uploadRequestSchema
  .omit({ filename: true })
  .extend({
    originalFilename: z.string().trim().min(1).max(180),
    storagePath: z.string().trim().min(1).max(500),
  });

export const checkoutSchema = z.object({
  requestId: z.string().uuid(),
  offer: z.enum(["audit_90_day", "continuous_monitor"]),
});

const CSV_CONTENT_TYPES = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "text/plain",
]);

export function isAllowedCsvUpload(filename: string, contentType: string) {
  return (
    filename.trim().toLowerCase().endsWith(".csv") &&
    CSV_CONTENT_TYPES.has(contentType.trim().toLowerCase())
  );
}

export function safeFilename(filename: string) {
  const cleaned = filename
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return cleaned.slice(0, 120) || "document.csv";
}
