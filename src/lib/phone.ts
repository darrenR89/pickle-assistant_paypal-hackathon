/** A phone number in E.164 (+15551234567), or undefined if it doesn't look like one. US numbers may skip the +1. */
export function normalizePhone(raw?: string) {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : undefined;
}
