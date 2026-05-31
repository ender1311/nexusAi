export const formatDateTime = (dateStr: string): string =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(dateStr));

export const formatDateGroup = (dateStr: string): string =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(dateStr));

export const toDateKey = (dateStr: string): string => new Date(dateStr).toLocaleDateString("en-CA");

/**
 * Formats the scheduled local delivery time as a short string like "8am" or "12pm".
 * scheduledFor is stored as UTC but represents the user's local delivery hour
 * because Braze uses in_local_time=true — so we read the UTC hour directly.
 */
export function formatShortTime(isoStr: string): string {
  const h = new Date(isoStr).getUTCHours();
  const m = new Date(isoStr).getUTCMinutes();
  const suffix = h >= 12 ? "pm" : "am";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, "0")}${suffix}`;
}

/**
 * Formats scheduled delivery as "May 10, 8am" — used for scheduled future sends
 * where the date matters.
 */
export function formatScheduledDelivery(isoStr: string): string {
  const d = new Date(isoStr);
  const month = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate();
  return `${month} ${day}, ${formatShortTime(isoStr)}`;
}
