const USD_DECLARATIONS = new Set([
  "USD",
  "$",
  "US$",
  "US DOLLAR",
  "US DOLLARS",
  "UNITED STATES DOLLAR",
  "UNITED STATES DOLLARS",
]);

export function normalizeDeclaredCurrency(value: string | null | undefined) {
  if (!value?.trim()) return null;

  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/[^A-Z0-9$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);

  if (!normalized) return null;
  return USD_DECLARATIONS.has(normalized) ? "USD" : normalized;
}

export function isSupportedDeclaredCurrency(value: string | null | undefined) {
  const normalized = normalizeDeclaredCurrency(value);
  return normalized === null || normalized === "USD";
}
