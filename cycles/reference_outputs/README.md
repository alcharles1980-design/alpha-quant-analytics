# Reference outputs (from the kit, 1 Nov 2026)

The kit's own outputs for the lists of 2026-10-30, the one-day ranking of Fri 30 Oct, the week of 26-30 Oct
and the 52 weeks to 30 Oct. The .xlsx workbooks were left out (they hold the same tables as the .md files).
`samples/` holds the TQQQ bars that `example_run.py` reads.

**Use them to check the code, not as true figures.** The overnight file for the night before Fri 30 Oct
was pulled at 21:28 ET while that night was still trading: 275 names stop there and 24 are missing. The
day and week figures here are therefore low. Rebuilding that partial data state reproduces
`day_2026-10-30` exactly (319 of 319 rows); on complete data the lists' return at PT 0.5% is
$10bn 4.15% / $5bn 3.64% / $1bn 3.50% / $500m 3.69% instead of 3.73 / 3.27 / 3.27 / 3.52%.
See CLAUDE.md §9d and §5.1.

The lists are also tied to one Polygon pull: the grouped daily bars were revised later, so rebuilding
`lists_2026-10-30` today gives ADV values up to 1.9% different and drops VCSH from the $500m list.
