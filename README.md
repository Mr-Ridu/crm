# LeadFlow CRM

A team lead & lot management web app for local-business outreach. Admins upload lead lists (**lots**) as XLSX/CSV, assign them to team members, and everyone works their leads with comments, color tags, WhatsApp outreach, and reminders — all fully responsive (desktop + mobile, installable as a PWA).

## Features

- **Role-based access** — Admins upload lots and control which team members can see them; members only see their assigned lots.
- **Spreadsheet import** — `.xlsx`, `.csv`, `.xls`, `.ods` with automatic column mapping (15 columns), duplicate detection, and a built-in sample file.
- **Lead workspace** — column selector, filters (color tag, status, city, niche, source, handled-by, rating), color-coded statuses, and an append-only comment timeline per lead.
- **1-click outreach** — call, WhatsApp with templates (normalized numbers, `wa.me` links), email, messenger, and customized message per lead.
- **Reminders** — in-app alerts with sound, Google Calendar deep-links, `.ics` download, Telegram bot push, and email reminders (SMTP/Resend/SendGrid via Settings).
- **Team analytics** — per-member stats: leads contacted, comments, meetings booked; **lots** management with per-member access toggles.
- **Fully responsive** — mobile-optimized tables, bottom-sheet style modals, touch-friendly targets.

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS 4, lucide-react |
| Backend | Express 4 (TypeScript, `tsx`), Node.js ≥ 22.13 |
| Data | SQLite (`data/leadflow.sqlite`, auto-created) |
| Import | `xlsx` (SheetJS) |

## Quick Start

```bash
npm install
npm run dev        # server + client together
```

Open http://127.0.0.1:5173 — the database file `data/leadflow.sqlite` is created automatically.

### Demo accounts (local seed)

| Role | Email | Password |
|---|---|---|
| Admin | `admin@leadflow.io` | `admin123` |
| Member (Sarah / Rahul / Elena) | `sarah@leadflow.io` | `member123` |

There's also a **Role Preview Switcher** bar in the UI for one-click testing without logging in.

### Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run server (tsx watch) + client (Vite) |
| `npm run build` | Typecheck + production client build |
| `npm run start` | Start the production server |
| `npm run typecheck` | TypeScript check only |
| `npm run admin:create` | Create an admin account |
| `npm run db:fresh` | Reset the database |

## Project Structure

```
├── src/                    # React client
│   ├── components/         # Views & UI components (table, modals, buttons…)
│   ├── utils/              # api client, helpers, theme, spreadsheet import
│   ├── App.tsx             # shell, tabs, toolbar, notifications
│   └── types.ts
├── server/                 # Express API (auth, leads, lots, reminders, settings)
├── scripts/                # deploy + admin/db helpers
├── public/                 # PWA manifest, icons
└── data/                   # SQLite database (git-ignored)
```

## Deployment

The production instance runs on cPanel with a Node 24 app. Deployment is done with:

```bash
bash scripts/deploy-sftp.sh   # typecheck → build → SFTP upload → restart.txt → live check
```

`data/`, the SQLite file, API tokens, SSH keys, and `.env*` files are git-ignored and never pushed.

## Notifications Setup

All external credentials are configured in **Settings → Phone Alerts & Settings** in the app (not in code):

- **Telegram** — add a bot token + chat ID for instant phone push alerts.
- **Email** — SMTP / Resend / SendGrid options.
- **Google Calendar & `.ics`** — work without API keys.

## License

Private/internal project — not open-source licensed.
