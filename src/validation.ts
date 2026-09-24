export const MAX_DATA_BYTES = 1024 * 1024;

export function limit(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 0) throw new RangeError(`Invalid ${name}`);
  return result;
}

export function validateResource(id: string, mime: string): void {
  if (!/^[A-Za-z0-9_.\-/]+$/.test(id)) throw new Error("Invalid resource id");
  if (!/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+(?:;[^\r\n\0]*)?$/.test(mime)) throw new Error("Invalid resource MIME type");
}
