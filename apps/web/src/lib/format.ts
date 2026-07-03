const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "4m", "18h", "May 12" — compact relative time as in the mockups */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (diff < MIN) return "now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "Sent today, 09:41" / "Sent yesterday" / "Sent May 12" */
export function sentLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `today, ${time}`;
  const yesterday = new Date(now.getTime() - DAY);
  if (d.toDateString() === yesterday.toDateString()) return "yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function dateLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase();
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
