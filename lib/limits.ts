// Shared input length caps, enforced on the server (authoritative) and mirrored
// as `maxLength` on the client inputs so users don't hit a 400.
export const LIMITS = {
  ticketTitle: 200,
  ticketDescription: 50000,
  columnName: 60,
  labelName: 40,
  projectName: 80,
  projectKey: 10,
} as const;

// True when `value` (after trimming) is within `max`.
export function withinLimit(value: string, max: number): boolean {
  return value.trim().length <= max;
}
