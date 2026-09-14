export type RecoveryPacketFinding = {
  findingType: string;
  severity: string;
  sourceFile: string;
  sourceRow: number | null;
  serviceCode: string | null;
  description: string;
  billedAmountCents: number | null;
  expectedAmountCents: number | null;
  potentialRecoveryCents: number;
};

type RecoveryPacketInput = {
  company: string;
  generatedAt: string;
  findings: RecoveryPacketFinding[];
  potentialRecoveryCents: number;
};

function plainText(value: string | null | undefined) {
  return (value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

function inlineText(value: string | null | undefined) {
  return plainText(value).replace(/\s+/g, " ").replace(/\|/g, "\\|");
}

function titleCase(value: string) {
  return inlineText(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function dollars(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "Not quantified";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function sourceReference(finding: RecoveryPacketFinding) {
  const sourceFile = inlineText(finding.sourceFile) || "Source file unavailable";
  return finding.sourceRow === null
    ? sourceFile
    : `${sourceFile}, row ${finding.sourceRow}`;
}

export function buildRecoveryPacket(input: RecoveryPacketInput) {
  const company = inlineText(input.company) || "Customer";
  const generatedAt = new Date(input.generatedAt);
  if (!Number.isFinite(generatedAt.getTime())) {
    throw new Error("Recovery packet generatedAt must be a valid timestamp.");
  }

  const quantifiedFindings = input.findings.filter(
    (finding) => finding.potentialRecoveryCents > 0,
  );
  const potentialRecoveryCents = Math.max(0, input.potentialRecoveryCents);
  const unquantifiedCount = input.findings.length - quantifiedFindings.length;

  const lines = [
    `# BillGuarded Recovery Review Draft — ${company}`,
    "",
    `Generated: ${generatedAt.toISOString()}`,
    "",
    "> HUMAN REVIEW REQUIRED — This draft was generated from customer-supplied structured data. It has not been submitted or sent. A qualified, authorized person must verify every cited source row, commercial term, unit, prior credit, and operational fact before contacting a 3PL or relying on any amount.",
    "",
    "## Conservative audit summary",
    "",
    `- Evidence-linked findings: ${input.findings.length}`,
    `- Quantified findings above $0: ${quantifiedFindings.length}`,
    `- Conservative potential recovery: ${dollars(potentialRecoveryCents)}`,
    `- Findings requiring review without a quantified recovery: ${unquantifiedCount}`,
    "",
    "Potential recovery is not a refund, credit, receivable, or guarantee. Multiple findings tied to the same source charge must not be counted twice.",
    "",
    "## Draft billing-review request",
    "",
    `Subject: Billing review request — ${company}`,
    "",
    "Hello —",
    "",
    "We reviewed the invoice rows listed below against the commercial terms and structured billing data available to us. Please review each cited item and confirm whether a credit, correction, or supporting explanation is appropriate.",
    "",
    "No amount in this draft should be treated as agreed or owed until both parties verify the underlying contract, units, invoice context, and any credits already issued.",
    "",
  ];

  if (input.findings.length === 0) {
    lines.push(
      "No supported discrepancy pattern was detected by the current deterministic checks. This does not prove the billing is error-free.",
      "",
    );
  } else {
    lines.push(
      "| # | Finding | Severity | Service code | Source | Billed | Expected | Potential recovery |",
      "| ---: | --- | --- | --- | --- | ---: | ---: | ---: |",
    );

    input.findings.forEach((finding, index) => {
      lines.push(
        `| ${index + 1} | ${titleCase(finding.findingType)} | ${titleCase(finding.severity)} | ${inlineText(finding.serviceCode) || "—"} | ${sourceReference(finding)} | ${dollars(finding.billedAmountCents)} | ${dollars(finding.expectedAmountCents)} | ${dollars(finding.potentialRecoveryCents)} |`,
      );
    });

    lines.push("", "### Finding notes", "");
    input.findings.forEach((finding, index) => {
      lines.push(
        `${index + 1}. **${titleCase(finding.findingType)} — ${sourceReference(finding)}:** ${inlineText(finding.description)}`,
      );
    });
    lines.push("");
  }

  lines.push(
    "Please reply with the disposition of each item and any source records that change the calculation.",
    "",
    "Regards,",
    company,
    "",
    "## Approval checklist",
    "",
    "- [ ] Confirm every source file and row against the original record.",
    "- [ ] Confirm the governing contract or rate-card version and effective date.",
    "- [ ] Confirm currency, quantity, unit of measure, minimums, tiers, and taxes.",
    "- [ ] Remove any item already credited, reversed, waived, or otherwise resolved.",
    "- [ ] Confirm that quantified findings do not double count the same source charge.",
    "- [ ] Add missing operational context and supporting documents.",
    "- [ ] Obtain approval from a person authorized to contact the 3PL about billing.",
    "",
    "## Control boundary",
    "",
    "BillGuarded identifies potential discrepancies and prepares this review draft. It does not determine liability, provide legal or financial advice, or submit a dispute. External communication remains a human-controlled action.",
    "",
  );

  return lines.join("\n");
}
