"use client";

import { createClient } from "@supabase/supabase-js";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  captureFunnelEvent,
  currentAttribution,
} from "@/lib/funnel-client";

type IntakeResponse = { requestId: string; accessToken: string };
type SignedUploadResponse = {
  path: string;
  token: string;
};
type CheckoutResponse = { url: string };

const ACCEPT = ".csv,text/csv,application/vnd.ms-excel";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

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

export default function IntakeForm(props: {
  initialMessage?: string;
  checkoutCancelled?: boolean;
}) {
  const [contractFile, setContractFile] = useState<File | null>(null);
  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([]);
  const [status, setStatus] = useState(props.initialMessage ?? "Ready.");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const stage = useRef<"idle" | "intake" | "upload" | "checkout">("idle");
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (props.checkoutCancelled) {
      void captureFunnelEvent("checkout_abandoned", "/start");
    }
  }, [props.checkoutCancelled]);

  function markStarted() {
    if (started.current) return;
    started.current = true;
    void captureFunnelEvent("intake_started", "/start");
  }

  function showError(message: string) {
    setError(message);
    window.requestAnimationFrame(() => statusRef.current?.focus());
  }

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
      showError("Add the CSV contract or rate card first.");
      return;
    }
    if (invoiceFiles.length === 0) {
      showError("Add at least one CSV invoice.");
      return;
    }

    const selectedFiles = [contractFile, ...invoiceFiles];
    try {
      selectedFiles.forEach(validateCsvFile);
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : "Use CSV files only.");
      void captureFunnelEvent("unsupported_file_rejected", "/start");
      return;
    }

    const totalBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      showError(
        "The combined upload is larger than 50 MB. Split the audit into a smaller supported file set before paying.",
      );
      void captureFunnelEvent("unsupported_file_rejected", "/start");
      return;
    }

    const form = new FormData(event.currentTarget);
    setBusy(true);

    try {
      stage.current = "intake";
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
            termsAccepted: form.get("termsAccepted") === "on",
            attribution: currentAttribution(),
          }),
        }),
      );

      stage.current = "upload";
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

      stage.current = "checkout";
      setStatus("Validating structured USD billing data before payment…");
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
      showError(
        caught instanceof Error
          ? caught.message
          : "Something went wrong. Please try again.",
      );
      if (stage.current === "upload") {
        void captureFunnelEvent("upload_failed", "/start");
      } else if (stage.current === "checkout") {
        void captureFunnelEvent("checkout_creation_failed", "/start");
      }
      stage.current = "idle";
      setStatus("Stopped before payment.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} onFocusCapture={markStarted}>
      <div className="form-grid">
        <div className="field full">
          <label htmlFor="company">Company</label>
          <input
            id="company"
            name="company"
            required
            minLength={2}
            autoComplete="organization"
            aria-describedby="intake-status"
          />
        </div>
        <div className="field full">
          <label htmlFor="email">Work email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            aria-describedby="intake-status"
          />
        </div>
        <div className="field">
          <label htmlFor="monthly3plSpend">Approx. monthly 3PL spend (USD)</label>
          <input
            id="monthly3plSpend"
            name="monthly3plSpend"
            type="number"
            min="0"
            step="100"
            inputMode="numeric"
            required
            aria-describedby="intake-status"
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
            aria-describedby="intake-status"
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
              aria-describedby="contract-help intake-status"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                if (file) {
                  try {
                    validateCsvFile(file);
                  } catch (caught) {
                    showError(
                      caught instanceof Error
                        ? caught.message
                        : "Use a supported CSV file.",
                    );
                    void captureFunnelEvent(
                      "unsupported_file_rejected",
                      "/start",
                    );
                    event.target.value = "";
                    setContractFile(null);
                    return;
                  }
                }
                setError(null);
                setContractFile(file);
              }}
            />
          </div>
          <span className="field-help" id="contract-help">
            Include a service/fee code and agreed unit rate. All monetary amounts must be USD. If the file contains a currency column, use USD. One file, up to 20 MB.
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
              aria-describedby="invoice-help intake-status"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                if (files.length > 10) {
                  showError("An audit can include at most 10 invoice CSV files.");
                  void captureFunnelEvent(
                    "unsupported_file_rejected",
                    "/start",
                  );
                } else {
                  try {
                    files.forEach(validateCsvFile);
                    setError(null);
                  } catch (caught) {
                    showError(
                      caught instanceof Error
                        ? caught.message
                        : "Use supported CSV files only.",
                    );
                    void captureFunnelEvent(
                      "unsupported_file_rejected",
                      "/start",
                    );
                  }
                }
                setInvoiceFiles(files.slice(0, 10));
              }}
            />
          </div>
          <span className="field-help" id="invoice-help">
            Best results include a reference/order ID, service code, quantity,
            unit rate, and line total. Monetary amounts must be USD; a declared
            non-USD currency is rejected before payment. All selected files
            combined must be 50 MB or less.
          </span>
        </div>
        <div className="field full">
          <label className="consent-row" htmlFor="termsAccepted">
            <input
              id="termsAccepted"
              name="termsAccepted"
              type="checkbox"
              required
              aria-describedby="intake-status"
            />
            <span>
              I confirm I am authorized to upload these business records, all
              monetary amounts submitted for this audit are USD, I agree to the{" "}
              <a href="/terms">BillGuarded Terms</a>, and I acknowledge the{" "}
              <a href="/privacy">Privacy Notice</a>.
            </span>
          </label>
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
      <p
        className={`status ${error ? "error" : ""}`}
        id="intake-status"
        ref={statusRef}
        role={error ? "alert" : "status"}
        tabIndex={-1}
      >
        {error || status}
      </p>
    </form>
  );
}
