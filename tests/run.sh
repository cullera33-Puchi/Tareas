#!/bin/bash
# Runs the regression suite against the repository copy of the app, one script at a time (each has its own fixed ports),
# and prints one line per test. A failing test is run a second time to absorb timing flakes; the retry is reported.
# Exit code: 0 when every test passes (on the first run or on the retry), 1 otherwise.
#
# Usage: tests/run.sh [test ...]      (no arguments: the whole suite; npm test does the same)
# Needs: npm ci (playwright, @electric-sql/pglite, web-push, http_ece), the Chromium of Playwright
# (npx playwright install chromium) and Deno for rm-P and rm-AT (deno on PATH, or the DENO variable with its path).
# Outputs: tests/out/ (screenshots and downloads) and tests/out/logs/<test>.txt (full output of each run). Gitignored.
cd "$(dirname "$0")/.." || exit 1
ROOT=$(pwd)
OUT=$ROOT/tests/out; LOGS=$OUT/logs; mkdir -p "$LOGS"
# index.html loads an optional config.js (gitignored; the Pages workflow writes it from the secrets). A missing file is a 404
# in the console, which most tests count as an error. Locally it holds nulls, exactly what the workflow writes without
# secrets: the app stays local only. rm-S serves its own 404 for it to cover the missing case.
[ -f "$ROOT/config.js" ] || echo 'window.TAREAS_CONFIG = {"url":null,"anonKey":null};' > "$ROOT/config.js"
ALL="smoke voice swipe roll spaces settings rowbg update features batch34 batch5 batch6 swiperight links multi four desk mock rm-A rm-B rm-C rm-D rm-E rm-F rm-G rm-H rm-I-vn rm-I-kb2 rm-I-guard rm-I-repro rm-J rm-S rm-P rm-Q rm-Q2 rm-AT rm-R rm-RF rm-ST rm-NP rm-LOG rm-DL rm-RP rm-RH rm-VN2 rm-NS rm-M4 rm-EP rm-COL rm-PIT rm-PF rm-LH rm-SI rm-RC rm-FR rm-E2E rm-NV rm-PP rm-TM rm-AV rm-QT"
TESTS=${*:-$ALL}
LIMIT=${TEST_TIMEOUT:-300}
if [[ " $TESTS " =~ " rm-P "|" rm-AT "|" rm-SI "|" rm-TM " ]] && ! command -v "${DENO:-deno}" >/dev/null 2>&1; then echo "Warning: Deno not found (set DENO or put deno on PATH): rm-P, rm-AT, rm-SI and rm-TM will fail"; fi
pass=0; failed=(); retried=(); start=$(date +%s)
for t in $TESTS; do
  if [ ! -f "$ROOT/tests/$t.js" ]; then echo "$t: FAIL no such test"; failed+=("$t"); continue; fi
  t0=$(date +%s)
  timeout "$LIMIT" node "$ROOT/tests/$t.js" > "$LOGS/$t.txt" 2>&1; code=$?
  res=$(node "$ROOT/tests/lib/check.js" "$t" "$LOGS/$t.txt" "$code"); ok=$?
  if [ $ok -ne 0 ]; then
    cp "$LOGS/$t.txt" "$LOGS/$t.first.txt"
    timeout "$LIMIT" node "$ROOT/tests/$t.js" > "$LOGS/$t.txt" 2>&1; code=$?
    res2=$(node "$ROOT/tests/lib/check.js" "$t" "$LOGS/$t.txt" "$code"); ok=$?
    if [ $ok -eq 0 ]; then retried+=("$t"); res="$res2 (passed on retry; first run: $res)"; else res="$res2 (failed twice; first run in logs/$t.first.txt)"; fi
  fi
  printf '%-11s %4ss  %s\n' "$t" "$(( $(date +%s) - t0 ))" "$res"
  if [ $ok -eq 0 ]; then pass=$((pass+1)); else failed+=("$t"); fi
done
echo "----"
echo "$pass passed, ${#failed[@]} failed, ${#retried[@]} passed on retry, $(( $(date +%s) - start ))s. Logs in tests/out/logs"
[ ${#retried[@]} -gt 0 ] && echo "Retried: ${retried[*]}"
[ ${#failed[@]} -gt 0 ] && { echo "Failed: ${failed[*]}"; exit 1; }
exit 0
