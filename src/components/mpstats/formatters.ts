export function formatCurrency(value: number | null | undefined) {
  if (!isFiniteNumber(value)) return "—";
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0
  }).format(value);
}

export function formatNumber(value: number | null | undefined) {
  if (!isFiniteNumber(value)) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}

export function formatPercent(value: number | null | undefined) {
  if (!isFiniteNumber(value)) return "—";
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(normalized)}%`;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export function formatMarketplace(value: string) {
  return value === "wb" ? "Wildberries" : "Ozon";
}

export function formatFulfillmentMode(value: string) {
  return value === "FBO_PLUS_FBS" ? "FBO + FBS" : "FBO";
}

export function maskId(value: string | null | undefined) {
  if (!value) return "—";
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
