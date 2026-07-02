export function formatCurrency(value) {
  const number = Number(value || 0);
  const safe = Number.isFinite(number) ? number : 0;
  return safe.toLocaleString("pt-PT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
