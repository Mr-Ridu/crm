#!/usr/bin/env bash
# লোকাল মেশিন (Git Bash) থেকে cPanel-এ এক কমান্ডে ডিপ্লয়।
#
# ব্যবহার:
#   HOST=yourdomain.com PORT=2222 USER=cpaneluser bash scripts/deploy-over-ssh.sh
#   (আপনার DB-ও পাঠাতে চাইলে) ... bash scripts/deploy-over-ssh.sh backup.sqlite
#   শুধু কী হবে দেখতে: DRY_RUN=1 HOST=x USER=y bash scripts/deploy-over-ssh.sh
#
# HOST/USER/PORT ছাড়া আর কিছু লাগে না; APP_DIR দিয়ে সার্ভারের ফোল্ডার বদলানো যায়।
set -euo pipefail

: "${HOST:?HOST=yourdomain.com দিন}"
: "${USER:?USER=cpaneluser দিন}"
PORT="${PORT:-22}"
APP_DIR="${APP_DIR:-leadflow}"
REMOTE="$USER@$HOST"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ARCHIVE="${TMPDIR:-/tmp}/leadflow-deploy.tar.gz"
DB_FILE="${1:-}"

run() {
  echo "+ $*"
  if [ "${DRY_RUN:-0}" = "1" ]; then return 0; fi
  "$@"
}

echo "==> প্যাকেজ তৈরি (node_modules/data/dev.log বাদ)"
tar -czf "$ARCHIVE" server src public scripts dist index.html package.json \
  package-lock.json vite.config.ts tsconfig.json start.cjs
echo "    $(du -h "$ARCHIVE" | cut -f1) -> $ARCHIVE"

echo "==> সার্ভারে আপলোড"
run scp -P "$PORT" "$ARCHIVE" "$REMOTE:~/"

if [ -n "$DB_FILE" ]; then
  if [ ! -f "$DB_FILE" ]; then echo "[X] DB ফাইল পাওয়া যায়নি: $DB_FILE"; exit 1; fi
  echo "==> Database আপলোড ($DB_FILE)"
  run ssh -p "$PORT" "$REMOTE" "mkdir -p ~/$APP_DIR/data"
  run scp -P "$PORT" "$DB_FILE" "$REMOTE:~/$APP_DIR/data/leadflow.sqlite"
fi

echo "==> আনপ্যাক + install + build + restart"
run ssh -p "$PORT" "$REMOTE" "
  set -e
  mkdir -p ~/$APP_DIR
  tar -xzf ~/leadflow-deploy.tar.gz -C ~/$APP_DIR
  cd ~/$APP_DIR
  bash scripts/deploy-cpanel.sh
"

echo "==> সার্ভার সাইড চেক"
run ssh -p "$PORT" "$REMOTE" "
  cd ~/$APP_DIR
  echo \"node: \$(node -v)\"
  echo \"dist: \$(ls dist | wc -l) items\"
  echo \"db:   \$(ls -l data/leadflow.sqlite 2>/dev/null | awk '{print \$5\" bytes\"}' || echo 'নতুন DB তৈরি হবে')\"
  echo \"port: \${PORT:-<cPanel নিজে দেয়>}\"
  (curl -s -o /dev/null -w 'root=%{http_code} ' http://127.0.0.1:\$PORT/ || true)
  (curl -s -o /dev/null -w 'api=%{http_code}\n' http://127.0.0.1:\$PORT/api/leads || true)
"
echo "==> শেষ। 503 এলে: ~/leadflow/tmp/restart.txt এবং ~/logs/ এর লগ দেখুন।"
