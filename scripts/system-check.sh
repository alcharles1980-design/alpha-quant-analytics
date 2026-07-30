#!/usr/bin/env bash
# Whole-system check for a cold start. The repo checks (handoff-gap-check, preflight) verify the
# CODE; this verifies the LIVE SYSTEM — deployed version, database objects, scheduled jobs, and
# the Edge Function. Several failures this project has hit were invisible to repo-level checks:
# a cron with a NULL auth header, two overloads of one function, a dead admin button.
#
#   ./scripts/system-check.sh
set -uo pipefail
SBURL="https://haeqzegdlwryvaecanrn.supabase.co"
APP="https://alpha-quant-analytics.alcharles1980.workers.dev"
FAIL=0; WARN=0
ok(){ printf "  \033[32mOK\033[0m    %s\n" "$1"; }
bad(){ printf "  \033[31mFAIL\033[0m  %s\n" "$1"; FAIL=$((FAIL+1)); }
warn(){ printf "  \033[33mWARN\033[0m  %s\n" "$1"; WARN=$((WARN+1)); }

KEY=$(grep -o "SB_KEY='[^']*'" app_v*.jsx 2>/dev/null | head -1 | sed "s/.*SB_KEY='//;s/'$//")
[ -z "$KEY" ] && { echo "cannot read SB_KEY from app source"; exit 2; }
SBH=(-H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json")

echo; echo "== code =="
LOCAL=$(ls app_v*.jsx 2>/dev/null | sed 's/app_v//;s/\.jsx//')
[ -n "$LOCAL" ] && ok "repo app version v$LOCAL" || bad "no app_vN.jsx found"
DEPLOYED=$(curl -s --max-time 25 "$APP/" | grep -o 'BUILD_TS="v[0-9]*' | head -1 | sed 's/BUILD_TS="v//')
if [ -n "$DEPLOYED" ]; then
  if [ "$DEPLOYED" = "$LOCAL" ]; then ok "deployed matches repo (v$DEPLOYED)"
  else bad "deployed v$DEPLOYED but repo is v$LOCAL — a push may have failed"; fi
else warn "could not read deployed version"; fi

echo; echo "== database objects =="
for fn in register_level hidden_levels_view hidden_level_visits_view most_actives_lookup \
          compound_bucket_state compound_reset compound_add_bucket; do
  N=$(curl -s --max-time 20 "${SBH[@]}" -X POST "$SBURL/rest/v1/rpc/pg_function_signature_count" \
       -d "{\"p_name\":\"$fn\"}" 2>/dev/null)
  case "$N" in
    1) ok "$fn — one signature" ;;
    "") warn "$fn — could not check (helper RPC missing?)" ;;
    0) bad "$fn — MISSING" ;;
    *) bad "$fn — $N SIGNATURES. create-or-replace across a differing signature ADDS an overload; PostgREST then returns PGRST203" ;;
  esac
done

echo; echo "== scheduled jobs =="
CRON=$(curl -s --max-time 20 "${SBH[@]}" -X POST "$SBURL/rest/v1/rpc/cron_job_status" -d '{}' 2>/dev/null)
if [ -n "$CRON" ] && [ "$CRON" != "null" ]; then
  # Report only what is WRONG. An active job that never runs, or whose last run failed, is the
  # dangerous case — it looks scheduled and does nothing. That is what a NULL auth header did.
  echo "$CRON" | python3 -c '
import sys,json
try: rows=json.load(sys.stdin)
except Exception: print("  WARN  cron status unreadable"); sys.exit(0)
bad=[];quiet=[]
def daily(sched):
    # Only expect a run in the last 24h if the job fires at least daily. A weekly vacuum
    # (dow restricted) or monthly job being quiet is correct, not a fault — flagging those
    # buried the one line that matters under eleven that do not.
    f=(sched or "").split()
    if len(f)<5: return False
    return f[2]=="*" and f[4]=="*"
for r in rows:
    if not r.get("active"): continue
    st=(r.get("last_status") or "").lower()
    if st and st!="succeeded": bad.append(r)
    elif not r.get("last_run"): quiet.append(r)
    elif (r.get("runs_24h") or 0)==0 and daily(r.get("schedule","")): quiet.append(r)
print(f"  {len(rows)} jobs, {sum(1 for r in rows if r.get("active"))} active")
for r in bad:   print(f"  FAIL  job {r["jobid"]} {r["jobname"]}: last run {r.get("last_status")}")
for r in quiet: print(f"  WARN  job {r["jobid"]} {r["jobname"]}: active but no run in 24h (may be correct if out of season)")
key=[r for r in rows if r["jobname"]=="overnight-level-scan"]
if not key: print("  FAIL  overnight-level-scan NOT SCHEDULED")
else:
    r=key[0]
    print(f"  OK    overnight-level-scan [{r["schedule"]}] active={r["active"]} last={r.get("last_status")} runs24h={r.get("runs_24h")}")
if not bad and not quiet: print("  OK    every active job ran successfully in the last 24h")
'
else warn "could not read cron status (helper RPC missing?)"; fi

echo; echo "== edge function =="
EF=$(curl -s --max-time 40 -X POST "$SBURL/functions/v1/overnight-level-scan?force=1" -H "Content-Type: application/json")
if echo "$EF" | grep -q '"ok":true'; then ok "overnight-level-scan responds: $(echo "$EF" | head -c 150)"
else bad "overnight-level-scan: $(echo "$EF" | head -c 200)"; fi

echo; echo "== repo checks =="
./scripts/handoff-gap-check.sh | sed 's/^/  /'
if [ -d node_modules ]; then npm run preflight 2>&1 | tail -2 | sed 's/^/  /'
else warn "node_modules absent — run npm install, then npm run preflight"; fi
UNPUSHED=$(git log origin/main..HEAD --oneline 2>/dev/null | wc -l)
[ "$UNPUSHED" -eq 0 ] && ok "nothing unpushed" || bad "$UNPUSHED unpushed commit(s)"
DIRTY=$(git status --short | wc -l)
[ "$DIRTY" -eq 0 ] && ok "working tree clean" || warn "$DIRTY uncommitted change(s)"

echo
printf "system-check: \033[31m%d failure(s)\033[0m, \033[33m%d warning(s)\033[0m\n" "$FAIL" "$WARN"
exit $(( FAIL > 0 ? 1 : 0 ))
