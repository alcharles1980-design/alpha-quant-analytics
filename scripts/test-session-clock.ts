// Session-clock test for the scanners' et.ts (Oct 29 2026). Run: node --experimental-strip-types scripts/test-session-clock.ts
// Summer (EDT): every scheduled firing must behave EXACTLY like the old hard-coded-UTC code.
// Winter (EST): firings must land in the ET session, one UTC hour later. Plus both transitions.
import { premarketPlan, aftermarketPlan, overnightPlan, etDate, etMinute } from "../supabase/functions/premarket-actives/et.ts";
let fail = 0, n = 0;
const chk = (c: boolean, m: string) => { n++; if (!c) { fail++; if (fail < 25) console.log("FAIL", m); } };
const utcDate = (d: Date) => d.toISOString().slice(0, 10);
// cron "*/k H1-H2 * * dows" firings between two dates
function* fire(from: string, to: string, step: number, hours: number[], dows: number[]) {
  for (let t = Date.parse(from); t < Date.parse(to); t += 60e3) {
    const d = new Date(t);
    if (d.getUTCMinutes() % step === 0 && hours.includes(d.getUTCHours()) && dows.includes(d.getUTCDay())) yield d;
  }
}
const H = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const WK = [1, 2, 3, 4, 5], TUSA = [2, 3, 4, 5, 6], ALL = [0, 1, 2, 3, 4, 5, 6];
const SUMMER: [string, string] = ["2026-10-05T00:00:00Z", "2026-10-31T23:59:00Z"];
const WINTER: [string, string] = ["2026-11-02T00:00:00Z", "2026-11-28T23:59:00Z"];

// ── PRE-MARKET ── old: target=utcDate, 08:00-13:29:59Z, partial = same UTC date && utcMin < 810
let s1 = 0, s2 = 0, w1 = 0, w2 = 0;
for (const d of fire(...SUMMER, 3, H(8, 14), WK)) {
  const p = premarketPlan(d);
  if (d.getUTCHours() <= 13) {        // old cron fired here: new must behave identically
    const t = utcDate(d), um = d.getUTCHours() * 60 + d.getUTCMinutes();
    chk(p.skip === null && p.target === t && p.start === `${t}T08:00:00Z` && p.end === `${t}T13:29:59Z`
        && p.isPartial === (um < 810), `pre EDT ${d.toISOString()} ${JSON.stringify(p)}`); s1++;
  } else { chk(p.skip !== null, `pre EDT 14Z should skip ${d.toISOString()}`); s2++; }
}
for (const d of fire(...WINTER, 3, H(8, 14), WK)) {
  const p = premarketPlan(d), t = etDate(d), em = etMinute(d);
  if (d.getUTCHours() === 8) { chk(p.skip !== null, `pre EST 08Z should skip ${d.toISOString()}`); w2++; }
  else { chk(p.skip === null && p.target === t && p.start === `${t}T09:00:00Z` && p.end === `${t}T14:29:59Z`
      && p.isPartial === (em < 570), `pre EST ${d.toISOString()} ${JSON.stringify(p)}`); w1++; }
}
console.log(`pre-market: summer ${s1} identical to old + ${s2} new skips; winter ${w1} in-session + ${w2} skips`);

// ── AFTER-MARKET ── old: target=utcDate, 20:00-23:59:59Z, partial = same UTC date && 20<=h<24
s1 = s2 = w1 = w2 = 0;
const amFires = (r: [string, string]) => [...fire(...r, 3, H(20, 23), WK), ...fire(...r, 3, [0], TUSA)];
for (const d of amFires(SUMMER)) {
  const p = aftermarketPlan(d);
  if (d.getUTCHours() >= 20) { const t = utcDate(d);
    chk(p.skip === null && p.target === t && p.start === `${t}T20:00:00Z` && p.end === `${t}T23:59:59Z`
        && p.isPartial === true && p.closed === false, `am EDT ${d.toISOString()} ${JSON.stringify(p)}`); s1++; }
  else { chk(p.skip !== null, `am EDT 00Z should skip ${d.toISOString()}`); s2++; }
}
for (const d of amFires(WINTER)) {
  const p = aftermarketPlan(d), t = etDate(d);
  if (d.getUTCHours() === 20) { chk(p.skip !== null, `am EST 20Z should skip ${d.toISOString()}`); w2++; }
  else { const nx = new Date(Date.parse(t + "T12:00:00Z") + 864e5).toISOString().slice(0, 10);
    chk(p.skip === null && p.target === t && p.start === `${t}T21:00:00Z` && p.end === `${nx}T00:59:59Z`
        && p.isPartial === true, `am EST ${d.toISOString()} ${JSON.stringify(p)}`); w1++; }
}
console.log(`after-market: summer ${s1} identical to old + ${s2} new skips; winter ${w1} in-session + ${w2} skips`);
// settle: explicit session_date at 20:05 ET
for (const iso of ["2026-10-29T00:05:00Z", "2026-11-03T01:05:00Z"]) {
  const d = new Date(iso), sd = etDate(d); const p = aftermarketPlan(d, sd);
  chk(p.skip === null && p.isPartial === false && p.closed === true, `am settle ${iso}`);
}

// ── OVERNIGHT ── old: target = h>=8 ? utc+1 : utc; partial = h<8 && target==utc
s1 = s2 = w1 = w2 = 0;
for (const d of fire(...SUMMER, 5, H(0, 8), ALL)) {
  const p = overnightPlan(d), h = d.getUTCHours();
  if (h < 8) { const t = utcDate(d);
    chk(p.skip === null && p.target === t && p.isPartial === true, `on EDT ${d.toISOString()} ${JSON.stringify(p)}`); s1++; }
  else { chk(p.skip !== null, `on EDT 08Z should skip ${d.toISOString()}`); s2++; }
}
for (const d of fire(...WINTER, 5, H(0, 8), ALL)) {
  const p = overnightPlan(d);
  if (d.getUTCHours() === 0) { chk(p.skip !== null, `on EST 00Z should skip ${d.toISOString()}`); w2++; }
  else { chk(p.skip === null && p.target === utcDate(d) && p.isPartial === true
      && p.start === `${p.target}T01:00:00Z` && p.end === `${p.target}T08:59:59Z`, `on EST ${d.toISOString()} ${JSON.stringify(p)}`); w1++; }
}
console.log(`overnight: summer ${s1} identical to old + ${s2} new skips; winter ${w1} in-session + ${w2} skips`);
// settle at 04:05 ET with session_date = ET date: complete, not partial
for (const iso of ["2026-10-29T08:05:00Z", "2026-11-03T09:05:00Z", "2026-11-01T09:05:00Z"]) {
  const d = new Date(iso), p = overnightPlan(d, etDate(d));
  chk(p.isPartial === false && p.closed === true && p.target === utcDate(d), `on settle ${iso} ${JSON.stringify(p)}`);
}
// The fall-back night itself: Sat Oct 31 20:00 EDT -> Sun Nov 1 04:00 EST is a 9-hour session
const fb = overnightPlan(new Date("2026-11-01T06:30:00Z"));
chk(fb.target === "2026-11-01" && fb.start === "2026-11-01T00:00:00Z" && fb.end === "2026-11-01T08:59:59Z" && fb.isPartial, `fall-back night ${JSON.stringify(fb)}`);
// Explicit past dates are never partial and never skipped
for (const f of [premarketPlan, aftermarketPlan, overnightPlan]) {
  const p = f(new Date("2026-10-29T06:00:00Z"), "2026-10-20");
  chk(p.skip === null && p.isPartial === false && p.closed === true, `explicit past ${f.name}`);
}
// force bypasses the skip; a malformed session_date is ignored rather than trusted
chk(premarketPlan(new Date("2026-10-29T18:00:00Z"), undefined, true).skip === null, "force");
chk(premarketPlan(new Date("2026-10-29T18:00:00Z"), "tomorrow").skip !== null, "bad session_date ignored");
console.log(fail ? `\n${fail} of ${n} FAILED` : `\nALL ${n} PASS`);
