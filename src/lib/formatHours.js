export function truncateDecimal(value, decimals = 2) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  const factor = 10 ** decimals;
  return Math.trunc(number * factor) / factor;
}

export function formatHours(value, decimals = 2) {
  return truncateDecimal(value, decimals).toFixed(decimals);
}
