export function parseNumberInput(input: string): number | null {
  const normalized = input.trim().replace(",", ".");
  if (normalized.length === 0) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function formatNumberInput(value: number, maximumFractionDigits = 3): string {
  if (!Number.isFinite(value)) throw new Error("Number must be finite.");
  return value.toLocaleString(undefined, {
    useGrouping: false,
    maximumFractionDigits,
  });
}
