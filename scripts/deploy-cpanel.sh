#!/usr/bin/env bash
# cPanel (Phusion Passenger) deploy — SSH থেকে একবার চালান:
#   cd ~/leadflow && bash scripts/deploy-cpanel.sh
# যা করে: Node version চেক -> dependencies install -> build -> data/ প্রস্তুত -> app restart।
# ডেটাবেস (data/leadflow.sqlite) কখনো মুছে বা ওভাররাইট করে না।
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"
echo "==> App dir: $APP_DIR"

# ১. Node version (node:sqlite এর জন্য 22.13+ বাধ্যতামূলক)
node -e '
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 13)) {
    console.error(`[X] Node ${process.version} — 22.13 বা নতুন দরকার। cPanel > Setup Node.js App এ version বদলে আবার চালান।`);
    process.exit(1);
  }
  console.log(`==> Node ${process.version} OK`);
'

# ২. Dependencies (build-এর জন্য devDependencies লাগবে, তাই --include=dev)
if [ -d node_modules ] && [ -f package-lock.json ]; then
  echo "==> npm install"
  npm install --include=dev --no-audit --no-fund
else
  echo "==> npm ci (first install)"
  if [ -f package-lock.json ]; then
    npm ci --include=dev --no-audit --no-fund
  else
    npm install --include=dev --no-audit --no-fund
  fi
fi

# ৩. UI build -> dist/
echo "==> npm run build"
npm run build

# ৪. data/ (SQLite) — থাকলে অক্ষত রাখুন, না থাকলে তৈরি করুন
mkdir -p data
if [ -f data/leadflow.sqlite ]; then
  echo "==> Database আছে, অক্ষত রাখা হলো ($(du -h data/leadflow.sqlite | cut -f1))"
else
  echo "==> নতুন database প্রথম boot-এ তৈরি হবে"
fi
chmod 755 data || true

# ৫. Passenger restart (tmp/restart.txt ছুঁলে app রিস্টার্ট হয়)
mkdir -p tmp
touch tmp/restart.txt
echo "==> Restarted. ব্রাউজারে ডোমেইন খুলে টেস্ট করুন।"
echo "==> লগ: ~/logs/$(basename "$APP_DIR").log (cPanel app পেজেও দেখা যায়)"
