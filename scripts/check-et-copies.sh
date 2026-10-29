#!/usr/bin/env bash
# The three session scanners each deploy their own copy of et.ts (Edge Functions are separate bundles).
# They must stay byte-identical. Exit 1 on drift. Added Oct 29 2026 with the DST fix.
set -u
cd "$(dirname "$0")/../supabase/functions" || exit 2
ref=premarket-actives/et.ts; bad=0
for f in aftermarket-actives/et.ts overnight-actives/et.ts; do
  if ! cmp -s "$ref" "$f"; then echo "FAIL  $f differs from $ref"; bad=1; else echo "PASS  $f == $ref"; fi
done
exit $bad
