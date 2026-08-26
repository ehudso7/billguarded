"use client";

import { createClient } from "@supabase/supabase-js";
import { FormEvent, useMemo, useState } from "react";

type IntakeResponse = { requestId: string; accessToken: string };
type SignedUploadResponse = {
  path: string;
  token: string;
};
type CheckoutResponse = { url: string };

const ACCEPT = ".csv,text/csv,application/vnd.ms-excel";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

async function jsonOrThrow<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error || "Request failed.");
  }
  return body;
}

function csvContentType(file: File) {
  return file.type === "application/vnd.ms-excel"
    ? "application/vnd.ms-excel"
    : "text/csv";
}

function validateCsvFile(file: File) {
  if (!file.name.toLowerCase().endsWith(".csv")) {
    throw new Error(`${file.name} is not a CSV file.`);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${file.name} is larger than 20 MB.`);
  }
}

export default function IntakeForm() {
  const [contractFile, setContractFile] = useState<File | null>(null);
  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([]);
  const [status, setStatus] = useState("Ready.");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return null;
    return createClient(url, key);
  }, []);

  async function uploadDocument(
    requestId: string,
    accessToken: string,
    file: File,
    kind: "contract" | "invoice",
  ) {
    if (!supabase) throw new Error("Upload service is not configured.");
    validateCsvFile(file);
    const contentType = csvContentType(file);

    const signed = await jsonOrThrow<SignedUploadResponse>(
      await fetch("/api/intake/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          accessToken,
          filename: file.name,
          contentType,
          size: file.size,
          kind,
        }),
      }),
    );

    const { error: uploadError } = await supabase.storage
      .from("audit-documents")
      .uploadToSignedUrl(signed.path, signed.token, file, {
        contentType,
      });

    if (uploadError) throw uploadError;

    await jsonOrThrow<{ ok: true }>(
      await fetch("/api/intake/confirm-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          accessToken,
          storagePath: signed.path,
          originalFilename: file.name,
          contentType,
          size: file.size,
          kind,
        }),
      }),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!contractFile) {
      setError("Add the CSV contract or rate card first.");
      return;
    }
    if (invoiceFiles.length === 0) {
      setError("Add at least one CSV invoice.");
      return;
    }

    try {
      [contractFile, ...invoiceFiles].forEach(validateCsvFile);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Use CSV files only.");
      return;
    }

    const form = new FormData(event.currentTarget);
    setBusy(true);

    try {
      setStatus("Creating your private audit workspace…");
      const intake = await jsonOrThrow<IntakeResponse>(
        await fetch("/api/intake", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            company: form.get("company"),
            email: form.get("email"),
            monthly3plSpend: Number(form.get("monthly3plSpend")),
            invoiceCount: Number(form.get("invoiceCount")),
          }),
        }),
      );

      setStatus("Uploading contract or rate card…");
      await uploadDocument(
        intake.requestId,
        intake.accessToken,
        contractFile,
        "contract",
      );

      for (let index = 0; index < invoiceFiles.length; index += 1) {
        setStatus(
          `Uploading invoice ${index + 1} of ${invoiceFiles.length}…`,
        );
        await uploadDocument(
          intake.requestId,
          intake.accessToken,
          invoiceFiles[index],
          "invoice",
        );
      }

      setStatus("Opening secure Stripe Checkout…");
      const checkout = await jsonOrThrow<CheckoutResponse>(
        await fetch("/api/stripe/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: intake.requestId,
            accessToken: intake.accessToken,
            offer: "audit_90_day",
          }),
        }),
      );

      window.location.assign(checkout.url);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Something went wrong. Please try again.",
      );
      setStatus("Stopped before payment.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-grid">
        <div className="field full">
          <label htmlFor="company">Company</label>
          <input id="company" name="company" required minLength={2} autoComplete="organization" />
        </div>
        <div className="field full">
          <label htmlFor="email">Work email</label>
          <input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="monthly3plSpend">Approx. monthly 3PL spend ($)</label>
          <input
            id="monthly3plSpend"
            name="monthly3plSpend"
            type="number"
            min="0"
            step="100"
            inputMode="numeric"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="invoiceCount">Invoices per month</label>
          <input
            id="invoiceCount"
            name="invoiceCount"
            type="number"
            min="1"
            max="10000"
            inputMode="numeric"
            required
          />
        </div>
        <div className="field full">
          <label htmlFor="contract">Contract or rate card — CSV</label>
          <div className="file-box">
            <input
              id="contract"
              type="file"
              accept={ACCEPT}
              required
              onChange={(event) =>
                setContractFile(event.target.files?.[0] ?? null)
              }
            />
          </div>
          <span className="field-help">
            Include a service/fee code and agreed unit rate. One file, up to 20 MB.
          </span>
        </div>
        <div className="field full">
          <label htmlFor="invoices">Recent invoices — CSV, up to 10 files</label>
          <div className="file-box">
            <input
              id="invoices"
              type="file"
              accept={ACCEPT}
              multiple
              required
              onChange={(event) =>
                setInvoiceFiles(
                  Array.from(event.target.files ?? []).slice(0, 10),
                )
              }
            />
          </div>
          <span className="field-help">
            Best results include a reference/order ID, service code, quantity, unit rate, and line total.
          </span>
        </div>
      </div>

      <div className="offer-option selected" aria-label="Selected audit plan">
        <span>
          <strong>Full 90-Day Audit</strong>
          <span className="muted"> — $1,500 one time</span>
        </span>
        <span className="eyebrow">Production ready</span>
      </div>

      <button className="button primary" type="submit" disabled={busy}>
        {busy ? "Preparing secure checkout…" : "Upload and continue to Stripe →"}
      </button>
      <p className={`status ${error ? "error" : ""}`} aria-live="polite">
        {error || status}
      </p>
    </form>
  );
}
