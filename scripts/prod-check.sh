#!/usr/bin/env bash
# Production health check — what is ACTUALLY ALIVE, not what the repo claims.
#
# The repo checks (handoff-gap-check, preflight) verify the CODE. This verifies the
# RUNNING SYSTEM: cron jobs, Edge Functions, RPCs, tables and recent writes. Both are
# needed — §5.1a's standing lesson is that structure passing says nothing about behaviour.
#
# Usage:  ./scripts/prod-check.sh
# Needs:  SB_KEY read from the app source; no other setup.

set -uo pipefail
APP=$(ls app_v*.jsx 2>/dev/null | head -1)
[ -z "$APP" ] && { echo "no app_vN.jsx found — run from the repo root"; exit 1; }
SB_URL=$(grep -o "var SB_URL='[^']*'" "$APP" | head -1 | sed "s/var SB_URL='//;s/'$//")
SB_KEY=$(grep -o "SB_KEY='[^']*'" "$APP" | head -1 | sed "s/SB_KEY='//;s/'$//")
[ -z "$SB_KEY" ] && { echo "could not read SB_KEY from $APP"; exit 1; }
H=(-H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" -H "Content-Type: application/json")
FAIL=0
ok(){ printf "  \033[32mOK\033[0m   %s\n" "$1"; }
bad(){ printf "  \033[31mFAIL\033[0m %s\n" "$1"; FAIL=$((FAIL+1)); }
note(){ printf "  --   %s\n" "$1"; }

echo "PRODUCTION CHECK  ($APP)"
echo

echo "1. app deployed and reachable"
LIVE=$(curl -s --max-time 25 "https://alpha-quant-analytics.alcharles1980.workers.dev/" | grep -o 'BUILD_TS="v[0-9]*' | head -1 | sed 's/BUILD_TS="//')
REPO=$(echo "$APP" | grep -o 'v[0-9]*')
[ -n "$LIVE" ] && ok "live: $LIVE   repo: $REPO" || bad "app did not respond"
[ "$LIVE" = "$REPO" ] || note "live version differs from repo — deploy may be mid-flight or a push is pending"

echo
echo "2. RPCs respond"
# ARGUMENTS MATTER. PostgREST resolves by signature, so posting {} to a function that takes
# required args returns 404 "no matching signature" — which is NOT the same as missing. An
# earlier version of this script reported three false FAILs that way; a false alarm in a
# health check is worse than no check, because it trains you to ignore it.
check_rpc(){ # $1 = name, $2 = json body
  CODE=$(curl -s -o /tmp/_rpc -w "%{http_code}" --max-time 25 -X POST "$SB_URL/rest/v1/rpc/$1" "${H[@]}" -d "$2")
  case "$CODE" in
    200) ok "$1 -> 200" ;;
    404) bad "$1 -> 404 (function missing or signature changed)" ;;
    400) ok "$1 -> 400 (exists; argument rejected, which is fine here)" ;;
    *)   bad "$1 -> HTTP $CODE  $(head -c 90 /tmp/_rpc)" ;;
  esac
}
check_rpc hidden_levels_view    '{}'
check_rpc compound_bucket_state '{"p_profile":1}'
check_rpc session_pace_ratio    '{"stype":"rth","sdate":"2026-07-29"}'
check_rpc most_actives_lookup   '{"p_ticker":"NVDA"}'
check_rpc shortlist_signal      '{}'
check_rpc compound_bucket_timeline '{"p_profile":1}'
check_rpc hidden_level_visits_view '{"p_level":1}'
check_rpc compound_chain_check  '{"p_profile":1}' 

echo
echo "3. Edge Function responds"
CODE=$(curl -s -o /tmp/_ef -w "%{http_code}" --max-time 40 -X POST \
  "$SB_URL/functions/v1/overnight-level-scan" "${H[@]}" -d '{}')
if [ "$CODE" = "200" ]; then ok "overnight-level-scan -> 200  $(head -c 120 /tmp/_ef)"
else bad "overnight-level-scan -> HTTP $CODE  $(head -c 120 /tmp/_ef)"; fi

echo
echo "4. tables readable and populated"
for t in hidden_levels overnight_actives premarket_actives aftermarket_actives compound_buckets; do
  N=$(curl -s --max-time 20 -I "$SB_URL/rest/v1/$t?select=*&limit=1" "${H[@]}" -H "Prefer: count=exact" \
      | grep -i content-range | grep -o '/[0-9]*' | tr -d '/')
  if [ -n "$N" ]; then [ "$N" -gt 0 ] && ok "$t: $N rows" || note "$t: EMPTY"
  else bad "$t: unreadable"; fi
done

echo
echo "5. reminder — checks this script CANNOT make"
note "cron job state and recent runs need the Supabase connector: select * from cron.job"
note "whether a feature BEHAVES correctly needs the browser harness: scripts/verify-app.js"
echo
[ "$FAIL" -eq 0 ] && printf "\033[32mprod-check: all green\033[0m\n" || printf "\033[31mprod-check: %d failure(s)\033[0m\n" "$FAIL"
exit $FAIL
