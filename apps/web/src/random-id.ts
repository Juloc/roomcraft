export type RandomValuesSource = (target: Uint8Array<ArrayBuffer>) => void;

export function createRandomUuid(
  getRandomValues: RandomValuesSource = (target) => {
    crypto.getRandomValues(target);
  },
): string {
  const bytes = new Uint8Array(new ArrayBuffer(16));
  getRandomValues(bytes);

  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export function createEntityId(prefix: string): string {
  return `${prefix}_${createRandomUuid()}`;
}
