export type CsvRow = Record<string, string>;

function parseCsvRecords(text: string) {
  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      record.push(value.trim());
      value = "";
      continue;
    }

    if (char === "\n" && !quoted) {
      record.push(value.trim());
      value = "";
      if (record.some((cell) => cell.length > 0)) records.push(record);
      record = [];
      continue;
    }

    value += char;
  }

  if (quoted) throw new Error("csv_unclosed_quote");

  record.push(value.trim());
  if (record.some((cell) => cell.length > 0)) records.push(record);
  return records;
}

export function parseCsv(text: string): CsvRow[] {
  const records = parseCsvRecords(text);
  if (records.length < 2) return [];

  const headers = records[0].map((header) => normalizeHeader(header));
  if (headers.some((header) => !header) || new Set(headers).size !== headers.length) {
    throw new Error("csv_headers_invalid");
  }

  return records.slice(1).map((values) => {
    const row: CsvRow = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

export function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function firstValue(row: CsvRow, aliases: string[]) {
  for (const alias of aliases) {
    const value = row[normalizeHeader(alias)];
    if (value !== undefined && value !== "") return value;
  }
  return null;
}

export function normalizeCode(value: string | null) {
  if (!value) return null;
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function parseMoneyToCents(value: string | null) {
  if (!value) return null;
  const cleaned = value
    .replace(/[$,\s]/g, "")
    .replace(/^\((.*)\)$/, "-$1");
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100);
}

export function parseNumber(value: string | null) {
  if (!value) return null;
  const numeric = Number(value.replace(/[,\s]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}
