const timestampPattern = /^(\d{1,2}:)?(\d{1,2}):(\d{2})([.,]\d{1,3})?$/;

export function parseTimestampToMs(value: string): number | null {
  const match = value.trim().match(timestampPattern);
  if (!match) return null;
  const hours = match[1] ? Number(match[1].slice(0, -1)) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes > 59 || seconds > 59) return null;
  const fraction = match[4] ? match[4].slice(1).padEnd(3, "0").slice(0, 3) : "0";
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + Number(fraction);
}

export function parseTimestampRange(value: string): { startTimeMs: number; endTimeMs: number } | null {
  const parts = value.split("-->");
  if (parts.length !== 2) return null;
  const startTimeMs = parseTimestampToMs(parts[0]);
  const endToken = parts[1].trim().split(/\s+/)[0];
  const endTimeMs = parseTimestampToMs(endToken);
  return startTimeMs == null || endTimeMs == null ? null : { startTimeMs, endTimeMs };
}
