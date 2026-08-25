export type CsvRow = Record<string, string>;

export type ParsedCsv = {
  headers: string[];
  rows: CsvRow[];
};

function parseCsvRecords(text: string) {
  const normalized = text.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let quoted = false;

  function pushValue() {
    record.push(value.trim());
    value = "";
  }

  function pushRecord() {
    pushValue();
    if (record.some((field) => field.length > 0)) records.push(record);
    record = [];
  }

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
      pushValue();
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      pushRecord();
      continue;
    }

    if ((char === "\n" || char === "\r") && quoted) {
      value += "\n";
      if (char === "\r" && next === "\n") index += 1;
      continue;
    }

    value += char;
  }

  if (quoted) {
    throw new Error("csv_unclosed_quote");
  }

  if (record.length > 0 || value.length > 0) pushRecord();
  return records;
}

export function parseCsvDocument(text: string): ParsedCsv {
  const records = parseCsvRecords(text);
  if (records.length < 2) return { headers: [], rows: [] };

  const headers = records[0].map((header) => normalizeHeader(header));
  if (headers.some((header) => header.length === 0)) {
    throw new Error("csv_blank_header");
  }

  const seen = new Set<string>();
  for (const header of headers) {
    if (seen.has(header)) throw new Error(`csv_duplicate_header:${header}`);
    seen.add(header);
  }

  const rows = records.slice(1).map((values) => {
    const row: CsvRow = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });

  return { headers, rows };
}

export function parseCsv(text: string): CsvRow[] {
  return parseCsvDocument(text).rows;
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
