#!/usr/bin/env bash
# cPanel-এ shell বন্ধ থাকলেও (SFTP খোলা) কোড পুশ + Passenger রিস্টার্ট।
# এখানে যা হয়: লোকালি build -> SFTP দিয়ে ফাইল আপলোড -> tmp/restart.txt লেখা
# (Passenger ওটা দেখে অ্যাপ রিস্টার্ট করে) -> লাইভ চেক।
# ডেটাবেস (data/) কখনো আপলোড বা ওভাররাইট হয় না — মাইগ্রেশন অ্যাপ চালু হওয়ার সময় চলে।
#
# ব্যবহার: bash scripts/deploy-sftp.sh
set -euo pipefail

SSH_HOST="${SSH_HOST:-151.158.44.116}"
SSH_USER="${SSH_USER:-growingi}"
APP_DIR="${APP_DIR:-leadflow-crm}"
SSH_KEY="${SSH_KEY:-.deploy-ssh/leadflow_deploy}"
SITE="${SITE:-https://crm.growingitagency.com}"

cd "$(dirname "${BASH_SOURCE[0]}")/.."

[ -f "$SSH_KEY" ] || { echo "[X] key পাওয়া যায়নি: $SSH_KEY"; exit 1; }

echo "==> typecheck + build"
npm run typecheck
npm run build

BATCH="$(mktemp)"
RESTART_SRC="$(mktemp)"
trap 'rm -f "$BATCH" "$RESTART_SRC"' EXIT

for f in index.html package.json start.cjs vite.config.ts tsconfig.json; do
  echo "put $f $APP_DIR/$f" >> "$BATCH"
done
while IFS= read -r f; do
  echo "put $f $APP_DIR/$f" >> "$BATCH"
done < <(find server src public dist scripts -type f)

# শেষ ধাপে restart.txt — তখনই অ্যাপ নতুন কোড লোড করে
printf 'restart %s\n' "$(date)" > "$RESTART_SRC"
echo "put $RESTART_SRC $APP_DIR/tmp/restart.txt" >> "$BATCH"

echo "==> $(($(wc -l < "$BATCH") - 1)) ফাইল আপলোড (data/ বাদ)"
sftp -i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
  -b "$BATCH" "$SSH_USER@$SSH_HOST" > /tmp/leadflow-sftp.log 2>&1 || {
    echo "[X] SFTP ব্যর্থ"; tail -20 /tmp/leadflow-sftp.log; exit 1; }
if grep -qiE "not found|No such|Permission denied" /tmp/leadflow-sftp.log; then
  echo "[!] কিছু ফাইলে সমস্যা:"; grep -iE "not found|No such|Permission denied" /tmp/leadflow-sftp.log | head
fi

echo "==> রিস্টার্টের অপেক্ষা"
sleep 12

echo "==> লাইভ চেক"
code_root=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SITE/")
code_api=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SITE/api/leads")
echo "    $SITE  root=$code_root  api=$code_api  (root 200 + api 401 = ঠিক)"
curl -s --max-time 15 "$SITE/" | grep -oE 'assets/[^"]+\.js' | head -1 | sed 's/^/    বান্ডল: /'
