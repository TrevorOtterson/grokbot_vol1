export function parseMoney(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") {
    throw new Error("Cost is required.");
  }
  const amount = typeof value === "number" ? value : Number.parseFloat(String(value).trim());
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Cost must be a number 0 or greater.");
  }
  return amount;
}

export function formatMoney(value: string | number, currency = "USD"): string {
  const amount = typeof value === "number" ? value : parseMoney(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}

export function roundMoney(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function moneyString(value: number): string {
  return roundMoney(value).toFixed(4);
}
