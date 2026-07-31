#!/bin/bash
# Handoff gap check — versions that shipped with no §9 entry. §9 is a rolling log,
# so only the recent window is checked. Run from the repo root.
WINDOW=${1:-25}
git log --format='%s' | grep -oE '^v[0-9]+' | tr -d v | sort -n -u > /tmp/_ship
# Normalise en-dash to hyphen FIRST (it is multi-byte; awk -F mishandles it),
# then expand heading ranges like "### v648-v650" into 648 649 650.
# Scan the handoff AND the archive: entries older than ~15 versions live in
# docs/CHANGELOG-ARCHIVE.md, and reading only CLAUDE.md would report every archived
# version as a gap — a check that cries wolf gets ignored (§5.6a).
cat CLAUDE.md docs/CHANGELOG-ARCHIVE.md 2>/dev/null \
 | grep -oE '^### v[0-9]+(–|-)?v?[0-9]*' \
 | sed 's/–/-/g; s/^### v//; s/-v/-/' \
 | awk -F- '{ if (NF>1 && $2!="") { for(i=$1+0;i<=$2+0;i++) print i } else print $1+0 }' \
 | sort -n -u > /tmp/_doc
awk 'NR==FNR{doc[$1];next}{ship[FNR]=$1;n=FNR}
     END{ max=ship[n]; lo=max-'"$WINDOW"'; bad=0;
          printf "current: v%d   window v%d..v%d\n", max, lo, max;
          for(i=1;i<=n;i++) if(ship[i]>=lo && !(ship[i] in doc)){
            if(!bad)print "HANDOFF GAPS (shipped, no section 9 entry):"; bad++; printf "  v%d\n", ship[i];}
          if(!bad) print "no handoff gaps in window"; }' /tmp/_doc /tmp/_ship
