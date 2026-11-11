# cPanel-এ Live করার গাইড (LeadFlow CRM)

একটাই Node প্রসেস UI + API দুটোই চালায়। কোনো native module নেই (DB হলো Node-এর built-in `node:sqlite`), তাই shared hosting-এ `npm install` সহজে হয়ে যায়।

## ১. Requirements (আগে হোস্টিং provider-কে জিজ্ঞেস করুন)

- **Node.js 22.13 বা নতুন** — cPanel → *Setup Node.js App* → Application version-এ 22.13+ আছে কি না দেখুন। না থাকলে provider-কে বলুন `alt-nodejs22+` enable করতে। (22.5–22.12-তে app চলবে না — `start.cjs` পরিষ্কার error দিয়ে বন্ধ হয়ে যাবে।)
- `data/` ফোল্ডারে write permission + local disk storage (SQLite WAL-এর জন্য দরকার)।

## ২. ফাইল আপলোড

Application root-এ (যেমন `leadflow-crm/`) এগুলো আপলোড করুন:

- `server/`, `src/`, `public/`, `scripts/`, `index.html`, `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`, `start.cjs`
- **বাদ দিন:** `node_modules/`, `dist/` (সার্ভারে বানানো হবে), `data/` (প্রোডাকশন DB আলাদা হবে), `.tmp-*/`, `dev.log`, `dev.pid`

## ৩. Setup Node.js App

| Setting | Value |
|---|---|
| Application version | 22.13+ (যেটা সবচেয়ে নতুন পান) |
| Application root | `leadflow-crm` |
| Application startup file | `start.cjs` |
| Application URL | আপনার domain/subdomain |

তারপর SSH বা Terminal-এ:

```bash
cd ~/leadflow-crm
npm install          # devDeps সহ লাগবে (vite দিয়ে build হবে)
npm run build        # dist/ তৈরি হবে
```

প্রথমবার চালু হলে DB auto-seed হবে। **ডিফল্ট admin `admin@leadflow.io` / `admin123` — সাথে সাথে লগইন করে পাসওয়ার্ড বদলান!** (সার্ভার লগেও warning দেখাবে।)

Shell access না থাকলে প্রথম boot-এর *আগে* Environment variables-এ দিন:

```
SEED_ADMIN_EMAIL=you@company.com
SEED_ADMIN_PASSWORD=কমপক্ষে-৮-অক্ষর
```

পরে admin বানাতে: `node scripts/make-admin.cjs "Name" "email" "pass"` (সার্ভার বন্ধ রেখে)।

## ৪. নিয়মিত রক্ষণাবেক্ষণ

- **Backup:** Admin → `/api/admin/backup` থেকে যেকোনো সময় SQLite snapshot ডাউনলোড করা যায় (live চলাকালেও safe)। এছাড়া cPanel Backup + `data/leadflow.sqlite*` কপি রাখুন।
- **Login brute-force:** 10 বার ভুল → 10 মিনিট block (IP+email ভিত্তিতে)।
- **Import সীমা:** একবারে সর্বোচ্চ 25,000 row; বড় ফাইল ভাগ করে আনুন।
- **Dispatch log:** 5000 row / 90 দিনের পুরনো auto-delete হয়।

## ৫. সমস্যা হলে

| লক্ষণ | করণীয় |
|---|---|
| 503 / app শুরু হয় না | Node version 22.13+ কি না দেখুন; `start.cjs` লগে কারণ লেখা থাকে |
| সাদা পেজ / পুরনো UI | `npm run build` আবার চালিয়ে Restart করুন |
| `SQLITE_BUSY` / DB lock | একসাথে দুই প্রসেস একই `data/` খুলবেন না; Passenger instance 1 রাখুন |
| Telegram/Email যায় না | My Alerts-এ নিজের bot/key বসান; Admin → dispatch logs (30টা) দেখুন |

## ৬. অডিটে পাওয়া শক্তিশালী দিক

- Same-origin UI+API, Bearer session token (30 দিন, DB-তে), scrypt password hash, login rate-limit।
- সব list/detail/mutation lot-access + reminder-ownership চেক করে; secrets (bot token, API key) member browser-এ যায় না।
- `dist` cache headers: `index.html`/`sw.js` no-cache, hashed assets 1 বছর immutable।
