"use client";

import { createClient } from "@supabase/supabase-js";
import { useSearchParams } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import type { OfferId } from "@/lib/offers";

type IntakeResponse = { requestId: string };
type SignedUploadResponse = {
  path: string;
  token: string;
};
type CheckoutResponse = { url: string };

const ACCEPT =
  ".pdf,.csv,.xls,.xlsx,.png,.jpg,.jpeg,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/png,image/jpeg";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function selectedOfferFromQuery(value: string | null): OfferId {
  return value === "continuous_monitor" ? "continuous_monitor" : "audit_90_day";
}

async function jsonOrThrow<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error || "Request failed.");
  }
  return body;
}

export default function IntakeForm() {
  const searchParams = useSearchParams();
  const [offer, setOffer] = useState<OfferId>(() =>
    selectedOfferFromQuery(searchParams.get("offer")),
  );
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
    file: File,
    kind: "contract" | "invoice",
  ) {
    if (!supabase) throw new Error("Upload service is not configured.");

    const signed = await jsonOrThrow<SignedUploadResponse>(
      await fetch("/api/intake/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
          kind,
        }),
      }),
    );

    const { error: uploadError } = await supabase.storage
      .from("audit-documents")
      .uploadToSignedUrl(signed.path, signed.token, file);

    if (uploadError) throw uploadError;

    await jsonOrThrow<{ ok: true }>(
      await fetch("/api/intake/confirm-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          storagePath: signed.path,
          originalFilename: file.name,
          contentType: file.type || "application/octet-stream",
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
      setError("Add the contract or rate card first.");
      return;
    }
    if (invoiceFiles.length === 0) {
      setError("Add at least one invoice.");
      return;
    }

    const allFiles = [contractFile, ...invoiceFiles];
    const tooLarge = allFiles.find((file) => file.size > MAX_FILE_BYTES);
    if (tooLarge) {
      setError(`${tooLarge.name} is larger than 20 MB.`);
      return;
    }

    const form = new FormData(event.currentTarget);
    setBusy(true);

    try {
      setStatus("Creating your audit workspace…");
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
      await uploadDocument(intake.requestId, contractFile, "contract");

      for (let index = 0; index < invoiceFiles.length; index += 1) {
        setStatus(
          `Uploading invoice ${index + 1} of ${invoiceFiles.length}…`,
        );
        await uploadDocument(intake.requestId, invoiceFiles[index], "invoice");
      }

      setStatus("Opening secure Stripe Checkout…");
      const checkout = await jsonOrThrow<CheckoutResponse>(
        await fetch("/api/stripe/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: intake.requestId,
            offer,
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
          <input id="company" name="company" required minLength={2} />
        </div>
        <div className="field full">
          <label htmlFor="email">Work email</label>
          <input id="email" name="email" type="email" required />
        </div>
        <div className="field">
          <label htmlFor="monthly3plSpend">Approx. monthly 3PL spend ($)</label>
          <input
            id="monthly3plSpend"
            name="monthly3plSpend"
            type="number"
            min="0"
            step="100"
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
            required
          />
        </div>
        <div className="field full">
          <label htmlFor="contract">
            Contract or rate card — PDF, CSV, Excel, PNG, JPG
          </label>
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
        </div>
        <div className="field full">
          <label htmlFor="invoices">Recent invoices — up to 10 files</label>
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
        </div>
      </div>

      <div className="offer-picker" aria-label="Choose audit plan">
        <label
          className={`offer-option ${
            offer === "audit_90_day" ? "selected" : ""
          }`}
        >
          <span>
            <strong>Full 90-Day Audit</strong>
            <span className="muted"> — $1,500 one time</span>
          </span>
          <input
            type="radio"
            name="offer"
            checked={offer === "audit_90_day"}
            onChange={() => setOffer("audit_90_day")}
          />
        </label>
        <label
          className={`offer-option ${
            offer === "continuous_monitor" ? "selected" : ""
          }`}
        >
          <span>
            <strong>Continuous Monitor</strong>
            <span className="muted"> — $599/month</span>
          </span>
          <input
            type="radio"
            name="offer"
            checked={offer === "continuous_monitor"}
            onChange={() => setOffer("continuous_monitor")}
          />
        </label>
      </div>

      <button className="button primary" type="submit" disabled={busy}>
        {busy ? "Preparing secure checkout…" : "Upload and continue to Stripe →"}
      </button>
      <p className={`status ${error ? "error" : ""}`}>
        {error || status}
      </p>
    </form>
  );
}
