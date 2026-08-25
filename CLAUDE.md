# Vishvakarma

A Jira-like personal project-management tool. Swimlane boards with
drag-and-drop tickets, one board set per project. This is the source of truth
for what Frederik is working on across all his projects.

## Stack
- Next.js 15 (App Router) + TypeScript
- Prisma ORM + **Postgres (Neon)** — hosted on Vercel. The board is LIVE; the
  local SQLite `prisma/dev.db` is a retired legacy copy (kept for history, not
  the source of truth). Connect via `DATABASE_URL` (Neon pooled string), which
  the app reads on Vercel and local tooling reads from a gitignored repo-root
  `.env`.
- Custom Pointer-Events drag-and-drop (no extra deps) — VSK-14 replaced the
  original native HTML5 DnD so the dragged card is carried on the pointer at full
  opacity with a gap that opens at the drop position; Pointer Events are a
  browser primitive, so this keeps the "no extra deps" rule.
- Local dev: `npm run dev` → http://localhost:3000

## Data model (`prisma/schema.prisma`)
- **Project** — unique `key` (e.g. `VSK`, `VSH`, `GAN`), has many Columns.
- **Column** — a board swimlane. `board` field groups columns into one of three
  boards: `analysis` | `development` | `acceptance`. Ordered by `order`.
- **Ticket** — belongs to a Column, ordered within it. Has title + optional
  description.

New projects seed with the standard columns below.

### The three boards and their columns (default lane layout)
- **analysis**: Open → Analysing → Analysed
- **development**: To Develop → Developing → Developed → To Test → Tested
- **acceptance**: To Accept → Accepted → Closed

A ticket's current status = which column it sits in. "Closed" (acceptance) = done.

## Projects currently in Vishvakarma
- **VSK — Vishvakarma**: this board app itself.
- **VSH — Vishnu**: a unified personal calendar (Google Calendar events + native
  to-dos/recurring reminders), separate repo at `/mnt/c/Users/frede/Vishnu`.
- **GAN — Ganesh**: board created, no tickets yet (purpose TBD).

## Reading & writing the live board (do this — tickets change)
The board is the hosted Neon Postgres DB. Read and write it with the Node/Prisma
tool `scripts/board.ts` (VSK-38 cutover — it replaced the old Python `board.py`,
which wrote the now-retired local SQLite `dev.db`). It talks to whatever
`DATABASE_URL` points at, so set that to the live Neon **pooled** string in a
gitignored repo-root `.env` first (a live credential — never commit it or paste
it in chat/tickets).

```bash
cd /mnt/c/Users/frede/Vishvakarma
# read the current board (all projects, or one with --project VSK):
npx tsx scripts/board.ts list
# create / move tickets (writes the LIVE board):
npx tsx scripts/board.ts create --project VSK --title "..." [--column Open]
npx tsx scripts/board.ts edit VSK-12 --column Developing
```

Board pages render dynamically (`revalidate = 0`), so writes made this way show
up on the live site immediately — no redeploy needed. `python3 scripts/board.py`
is retired and will refuse to run.

## Board snapshot — 2026-08-19 (read the DB for current state)
**VSH — Vishnu**
- acceptance/Closed: Phase 1 — Scaffold, data model & deploy skeleton
- acceptance/Closed: Phase 2 — Calendar + agenda views, native entries
- development/To Test: Phase 3 — Google Calendar (read)
- analysis/Open: Phase 4 — Reminders to phone (PWA + Web Push + Vercel Cron)
- analysis/Open: Phase 5 — Google Calendar write-back (two-way sync)
- analysis/Open: Create Google Cloud project & enable Calendar API
- analysis/Open: Configure OAuth consent screen
- analysis/Open: Create OAuth Web client & register redirect URIs
- analysis/Open: Add Google client env vars locally
- analysis/Open: Add Google client env vars to Vercel & redeploy
- analysis/Open: Verify Google Calendar read (Phase 3 acceptance)
- analysis/Open: Build password/access gate (Phase 3.5)
- analysis/Open: Revoke pasted GitHub token
- analysis/Open: Rotate Neon database password
- analysis/Open: Push Phase 2 & 3 commits to deploy

**VSK — Vishvakarma**
- analysis/Analysing: Set up project board (swimlanes + tickets)
- analysis/Open: drag & drop to order lanes
- analysis/Open: Overall design / theming
- analysis/Open: better pop-ups
- analysis/Open: each claude session should start with being familiar with vishvakarma
- analysis/Open: possibility to open tickets to add more info / tags / labels
- analysis/Open: remember open/closed projects in left-hand hierarchy

**GAN — Ganesh**: no tickets.
