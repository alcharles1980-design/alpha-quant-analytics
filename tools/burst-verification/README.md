# Burst Verification

Independently confirm a burst the overnight scanner claims, using the FINRA TRF batch as a
second witness. Answers three questions the register cannot answer on its own:

1. **Did the burst really happen?** Not "did the scanner think so" — did a second feed see it.
2. **When did the off-venue flow at this price actually execute?**
3. **Was this flow visible in real time, or invisible until 04:00 ET?**

## Why it is not obvious

BOATS prints carry nanosecond **execution** timestamps. TRF prints carry **report** timestamps:
an entire overnight session lands in a ~5 minute burst at 04:00 ET, with **no out-of-sequence
marker**. So the feeds cannot be joined on time, which is what makes this look impossible.

**The size multiset survives the reporting delay.** A group of
`{550x1, 180x1, 93x1, 100x3, 50x6, 2x3, 1x58}` is a fingerprint. Match it against BOATS prints at
the same price and the execution window is recovered to the second — from data that appears to have
had its clock erased.

## Two methods, different jobs. Do not substitute one for the other.

| | `classify()` — contiguous fingerprint | `size_excess()` — per-size excess |
|---|---|---|
| finds | exact multiset match in a time-contiguous window | TRF count above BOATS count, per price per size |
| recovers execution time | **yes** | no |
| valid on | **isolated bursts only** | any price, including ones recurring all night |
| failure mode | false INTERNALISED when a price's TRF group merges several echoes | undercounts: internalised flow matching a BOATS size is invisible |

`size_excess()` is a **lower bound** on internalised flow.

> **The scaling trap, learned the hard way.** `classify()` first reported SOXL as 99.2%
> internalised against a count-based 5.3%, and a 332-minute median reporting delay for NVDA.
> Both were false. It demands ONE contiguous window matching the ENTIRE TRF group at a price;
> SOXL at 93.00 has BOATS prints across **60 distinct minutes**, so no single window can match and
> everything read as internalised. **A method validated on clean isolated cases can fail silently
> at scale, producing plausible numbers rather than errors** — the §5.1a signature.

## Validation cases — re-run these before trusting any change

| case | expected | why it is ground truth |
|---|---|---|
| `U` 2026-07-29 @ 31.95 | ECHO, exec 07:46:06Z, delay 18.9min | user sold this on BOATS |
| `U` 2026-07-29 @ 31.88 | INTERNALISED, 73 unmatched prints | user bought this from a wholesaler |
| `HOOD` 2026-07-31 @ 87.28 | ECHO, exec 07:25:20–40Z, delay 38.4min | 73/73 prints, identical multiset |
| `HOOD` 2026-07-31 @ 87.31 | INTERNALISED (no echo) | the 524-print burst has no TRF counterpart |

The U case is the only **labelled** ground truth in existence for this system: the user was the
counterparty and knows which side he was on. Everything else is inference.

## Usage

```bash
export ALPACA_KEY=... ALPACA_SECRET=...          # never commit these
python3 fetch.py 2026-07-31 HOOD U SOXL          # session date FIRST, then symbols
SESSION=2026-07-31 python3 fingerprint.py HOOD U SOXL
```

`fetch.py` paginates to exhaustion and prints `*** TRUNCATED ***` if it hits its page budget.
**Check that line.** An unpaginated fetch returned 10,000 of SOXL's 183,511 prints — 5% of the
tape, with a 200 and no error.

## Gotchas that will silently break a matcher

- **Session dating.** The overnight session beginning 20:00 ET on day D-1 is stamped day D, and its
  TRF batch lands 04:00 ET on day D. Fetching the adjacent session returns perfectly valid data for
  the wrong night — it cost one failed validation before it was caught.
- **Condition codes are tape-dependent.** Regular sale is `"@"` on BOATS but a literal space `" "`
  on some TRF records. The same security reports `z:"N"` on BOATS and `z:"A"` on the TRF.
- **Trade IDs are not globally unique.** HOOD's TRF batch ran IDs 1–837 across 1,349 records, with
  collisions; U's were full-width and unique. Format varies by reporting firm. **Never join on `i`.**
- **Reporting delay is not a constant** — 18.9 min for U, 38.4 min for HOOD. It cannot be used to
  align feeds.

## What this does NOT establish

**Which side the hidden order was on.** Three approaches have failed on the same root cause: the
tape carries no aggressor flag, and the TRF carries no execution time. Cross-venue price
competition (BOATS higher ⟹ better bid ⟹ hidden buyer) is sound reasoning that cannot be executed,
because the overnight SIP is closed by construction — it returns `trades: null` during the BOATS
session, so there is no contemporaneous off-venue print to compare against.

A price-distribution version of the same test came out at **chance: 13 agree / 16 disagree across 31
levels, 44.8%**; high-confidence levels alone, 50.0%. Not inversion — inversion would show ~80–90%
consistent disagreement. Noise, from 8-hour drift that a price band cannot control for.

**The user's own fills remain the only source carrying both side and execution time.**

## Unverified assumption

That Blue Ocean is an ATS and therefore re-reports its executions to a TRF. This is inferred from
the 71/71 and 73/73 matches, **not confirmed against FINRA's ATS list**. FINRA OTC Transparency
(https://www.finra.org/filing-reporting/otc-transparency) publishes weekly per-ATS volume by MPID
on a 2–4 week delay and would settle it. Worth doing before this assumption is built into a page.
