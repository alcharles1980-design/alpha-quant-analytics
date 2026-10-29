// et.ts: Eastern-time session clock for the three session scanners (added Oct 29 2026).
//
// IDENTICAL COPIES of this file live in premarket-actives/, aftermarket-actives/ and
// overnight-actives/, because each Edge Function deploys as its own bundle.
// scripts/check-et-copies.sh fails if the copies drift. Edit one, copy it to the other two, run it.
//
// WHY. The scanners used to hard-code UTC hours that are only right in summer (EDT, UTC-4):
// pre-market as 08:00-13:29:59Z, after-market as 20:00-23:59:59Z, and the overnight rollover at
// 08:00Z. From the first Sunday in November to the second Sunday in March the market runs on EST
// (UTC-5). On EST those windows would have dropped the last hour of pre-market (08:30-09:30 ET)
// and of after-market (19:00-20:00 ET), scanned 03:00-04:00 ET when SIP has no session, rolled
// the overnight session at 03:00 ET with an hour still to trade, and flagged sessions complete an
// hour early. Every window is now an ET wall-clock time, converted with the IANA zone, so the
// same code is right in both seasons and needs no change at either switch.
//
// The summer windows are byte-identical to the old strings: verified for every session.

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

export function etParts(d: Date): Record<string, number> {
  const p: Record<string, number> = {};
  for (const x of ET_FMT.formatToParts(d)) if (x.type !== "literal") p[x.type] = Number(x.value);
  return p;
}
const p2 = (n: number) => String(n).padStart(2, "0");
/** ET calendar date, YYYY-MM-DD. */
export function etDate(d: Date): string { const p = etParts(d); return `${p.year}-${p2(p.month)}-${p2(p.day)}`; }
/** Minutes since ET midnight, 0..1439. */
export function etMinute(d: Date): number { const p = etParts(d); return p.hour * 60 + p.minute; }
/** Day of week of the ET date, 0 = Sunday .. 6 = Saturday. */
export function etWeekday(d: Date): number { return new Date(etDate(d) + "T12:00:00Z").getUTCDay(); }
/** Calendar arithmetic on a YYYY-MM-DD string (anchored at noon UTC, so no DST effect). */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
/** The UTC instant of an ET wall-clock time on an ET calendar date. */
export function etToUtc(dateStr: string, hh: number, mm: number, ss = 0): Date {
  const wall = Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10), hh, mm, ss);
  let t = wall + 5 * 3600e3;                      // first guess: EST
  for (let i = 0; i < 3; i++) {
    const p = etParts(new Date(t));
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    if (shown === wall) break;
    t += wall - shown;                            // EDT: corrects by -1 hour
  }
  return new Date(t);
}
/** ISO timestamp without milliseconds, e.g. 2026-11-02T09:00:00Z (the format Alpaca was always sent). */
export function isoZ(d: Date): string { return d.toISOString().replace(/\.\d{3}Z$/, "Z"); }
export function etStamp(d: Date): string { const m = etMinute(d); return `${etDate(d)} ${p2(Math.floor(m / 60))}:${p2(m % 60)} ET`; }

export type Plan = {
  target: string;       // session_date written to the table
  start: string;        // session start, ISO UTC
  end: string;          // last second of the session, ISO UTC (Alpaca bars `end` is inclusive)
  isPartial: boolean;   // the session is still trading
  closed: boolean;      // the session is over
  skip: string | null;  // a scheduled call (no session_date) outside its hours does nothing
  etNow: string;
};

function isDate(s: unknown): s is string { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }

/** Pre-market 04:00-09:30 ET. Scheduled calls run 04:00-10:00 ET on weekdays; the half hour after
 *  the bell lets the newest minute bars settle, as the old 08:00-13:57Z cron did in summer. */
export function premarketPlan(now: Date, sessionDate?: unknown, force = false): Plan {
  const explicit = isDate(sessionDate);
  const target = explicit ? sessionDate : etDate(now);
  const open = etToUtc(target, 4, 0), close = etToUtc(target, 9, 30);
  const m = etMinute(now), wd = etWeekday(now);
  const skip = explicit || force ? null
    : wd === 0 || wd === 6 ? "weekend (ET)"
    : m < 240 || m >= 600 ? "outside pre-market scan hours (04:00-10:00 ET)" : null;
  return { target, start: isoZ(open), end: isoZ(new Date(close.getTime() - 1000)),
    isPartial: etDate(now) === target && now < close, closed: now >= close, skip, etNow: etStamp(now) };
}

/** After-market 16:00-20:00 ET, same ET date as the regular session it follows. */
export function aftermarketPlan(now: Date, sessionDate?: unknown, force = false): Plan {
  const explicit = isDate(sessionDate);
  const target = explicit ? sessionDate : etDate(now);
  const open = etToUtc(target, 16, 0), close = etToUtc(target, 20, 0);
  const m = etMinute(now), wd = etWeekday(now);
  const skip = explicit || force ? null
    : wd === 0 || wd === 6 ? "weekend (ET)"
    : m < 960 || m >= 1200 ? "outside after-market hours (16:00-20:00 ET)" : null;
  return { target, start: isoZ(open), end: isoZ(new Date(close.getTime() - 1000)),
    isPartial: now >= open && now < close, closed: now >= close, skip, etNow: etStamp(now) };
}

/** Overnight 20:00-04:00 ET. BOATS stamps the session that begins at 20:00 ET with the NEXT
 *  calendar date, so before 04:00 ET the live session is today's date and from 04:00 ET on it is
 *  tomorrow's. */
export function overnightPlan(now: Date, sessionDate?: unknown, force = false): Plan {
  const explicit = isDate(sessionDate);
  const m = etMinute(now);
  const target = explicit ? sessionDate : m < 240 ? etDate(now) : addDays(etDate(now), 1);
  const open = etToUtc(addDays(target, -1), 20, 0), close = etToUtc(target, 4, 0);
  const skip = explicit || force ? null
    : m >= 240 && m < 1200 ? "outside overnight session (20:00-04:00 ET)" : null;
  return { target, start: isoZ(open), end: isoZ(new Date(close.getTime() - 1000)),
    isPartial: now >= open && now < close, closed: now >= close, skip, etNow: etStamp(now) };
}
