#!/usr/bin/env bash
# Reproducible, isolated run of (part of) the browser regression against ONE source tree.
#
#   scripts/run-browser-chunk.sh <tree-root> <label> <steps-regex|ALL> <api-port> <web-port> <cdp-port> [pre-phase27-db]
#
# - <tree-root>   a checkout (e.g. a `git worktree` of the branch or of origin/master) whose node_modules, shared build and
#                 generated Prisma client belong to THAT tree. Never rebuild a tree while a chunk runs in it.
# - <steps-regex> passed as ONLY_STEPS (matches step names such as "knowledge ...", "nav ..."), or ALL for the whole suite.
# - ports         three free ports for this run (API, Vite dev server, Chrome DevTools); distinct per concurrent run.
# - [db]          optional: database to copy (default: <tree>/apps/server/prisma/dev.db). A DISPOSABLE copy is always used;
#                 TURSO_* / BLOB_* are cleared so the run can never reach a real service.
# Output: <out-dir>/browser.out (printed at the end together with the pass/fail line). out-dir = $OUT_DIR or a new temp dir.
# Requires Chromium (BROWSER_PATH, default /opt/pw-browsers/chromium-1194/chrome-linux/chrome) and Node >= 22.
set -u
TREE=$(cd "$1" && pwd); LABEL=$2; STEPS=$3; API_PORT=$4; WEB_PORT=$5; CDP_PORT=$6; DB_SRC=${7:-$TREE/apps/server/prisma/dev.db}
OUT=${OUT_DIR:-$(mktemp -d)}; mkdir -p "$OUT/shots"
cp "$DB_SRC" "$OUT/c.db"
PIDS=()
port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; } # true when something is listening (no ss/lsof needed)
# Each server runs in its OWN process group (setsid) and the whole group is killed: `tsx` starts the real server as a child process,
# and killing only the parent would leave that child holding the port, so the NEXT chunk would silently talk to a stale server.
cleanup() {
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill -9 -- "-$p" 2>/dev/null; done
  pkill -9 -f "remote-debugging-port=$CDP_PORT" 2>/dev/null
  for i in $(seq 1 20); do { port_open "$API_PORT" || port_open "$WEB_PORT"; } || break; sleep 0.5; done
  true
}
trap cleanup EXIT

# A Vite config that points the dev proxy at THIS run's API (the checked-in config hard-codes :4001). It lives outside the tree.
cat > "$OUT/vite.config.mjs" <<CFG
import react from "$TREE/node_modules/@vitejs/plugin-react/dist/index.js";
export default { root: "$TREE/apps/web", plugins: [react()], server: { port: $WEB_PORT, strictPort: true, proxy: { "/api": { target: "http://localhost:$API_PORT", changeOrigin: true } } } };
CFG

for port in $API_PORT $WEB_PORT; do
  if port_open "$port"; then echo "port $port is already in use - refusing to run against a stale server" >&2; exit 3; fi
done
cd "$TREE/apps/server"
setsid env -u TURSO_DATABASE_URL -u TURSO_AUTH_TOKEN BLOB_READ_WRITE_TOKEN= VERCEL= STORAGE_DIR="$OUT/files" DATABASE_URL="file:$OUT/c.db" \
  PORT=$API_PORT TRUST_PROXY=0 NODE_ENV=test SESSION_SECRET="browser-chunk-secret-$LABEL-0000000000" \
  node ../../node_modules/tsx/dist/cli.mjs src/index.ts > "$OUT/api.log" 2>&1 &
PIDS+=($!)
(cd "$TREE/apps/web" && exec setsid node "$TREE/node_modules/vite/bin/vite.js" --config "$OUT/vite.config.mjs" > "$OUT/web.log" 2>&1) &
PIDS+=($!)
for i in $(seq 1 80); do grep -q "listening on" "$OUT/api.log" 2>/dev/null && curl -s -o /dev/null "http://localhost:$WEB_PORT/" && break; sleep 0.5; done

SCRIPT=scripts/browser-regression.cjs
if ! grep -q "CDP_PORT" "$SCRIPT"; then # an older tree: patch a throw-away copy (untracked) so its DevTools port is ours
  sed "s|const PORT = 9334;|const PORT = $CDP_PORT;|" "$SCRIPT" > scripts/browser-regression.chunk-$CDP_PORT.tmp.cjs; SCRIPT=scripts/browser-regression.chunk-$CDP_PORT.tmp.cjs
fi
export BROWSER_PATH=${BROWSER_PATH:-/opt/pw-browsers/chromium-1194/chrome-linux/chrome} CDP_PORT K22_DB="$OUT/c.db"
[ "$STEPS" != "ALL" ] && export ONLY_STEPS="$STEPS"
node "$SCRIPT" "http://localhost:$WEB_PORT" "http://localhost:$API_PORT" "$OUT/shots" > "$OUT/browser.out" 2>&1
STATUS=$?
case "$SCRIPT" in *.tmp.cjs) rm -f "$SCRIPT";; esac
echo "OUT_DIR=$OUT"; grep -E "browser checks passed" "$OUT/browser.out" | tail -1
exit $STATUS
