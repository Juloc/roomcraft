export function parseLengthInput(input: string): number | null {
  const normalized = input.trim().toLowerCase().replace(",", ".");
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(mm|cm|m)?$/.exec(normalized);
  if (!match) return null;

  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) return null;

  const unit = match[2] ?? "mm";
  const factor = unit === "m" ? 1000 : unit === "cm" ? 10 : 1;
  const millimetres = Math.round(numeric * factor);
  return Number.isSafeInteger(millimetres) ? millimetres : null;
}

export function formatLengthInput(valueMm: number): string {
  if (!Number.isFinite(valueMm)) throw new Error("Length must be finite.");
  return `${Math.round(valueMm)} mm`;
}
