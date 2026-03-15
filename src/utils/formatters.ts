export function formatCurrency(value: number | string | null | undefined): string {
  const millions = Number(value || 0) / 1000000;
  return millions.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + "M";
}
