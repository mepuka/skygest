const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const months = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
] as const;

export function relativeTime(epochMs: number): string {
  const delta = Date.now() - epochMs;
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`;
  if (delta < WEEK) return `${Math.floor(delta / DAY)}d`;
  if (delta < 4 * WEEK) return `${Math.floor(delta / WEEK)}w`;

  const d = new Date(epochMs);
  const now = new Date();
  if (d.getFullYear() === now.getFullYear()) {
    return `${months[d.getMonth()]} ${d.getDate()}`;
  }
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function isoTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

export function atUriToBlueskyUrl(uri: string, handle: string | null): string | null {
  const match = uri.match(/^at:\/\/(did:[^/]+)\/app\.bsky\.feed\.post\/(.+)$/);
  if (!match) return null;
  const [, did, rkey] = match;
  const authority = handle ?? did;
  return `https://bsky.app/profile/${authority}/post/${rkey}`;
}
