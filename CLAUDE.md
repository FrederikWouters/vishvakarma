# Vishvakarma

A Jira-like personal project-management tool. Swimlane boards with
drag-and-drop tickets, one board set per project. This is the source of truth
for what Frederik is working on across all his projects.

## Stack
- Next.js 15 (App Router) + TypeScript
- Prisma ORM + SQLite at `prisma/dev.db`
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

## Reading the live board (do this — tickets change)
The ticket list below is a dated snapshot. For the *current* state, read the DB.
`sqlite3` CLI is not installed; use Python:

```bash
cd /mnt/c/Users/frede/Vishvakarma && python3 - <<'PY'
import sqlite3
c=sqlite3.connect('prisma/dev.db'); c.row_factory=sqlite3.Row
rows=c.execute('''select p.key,t.number,col.board,col.name col,t.title,t.description
  from Ticket t join "Column" col on col.id=t.columnId
  join Project p on p.id=col.projectId
  order by p.key,col."order",t."order"''').fetchall()
for r in rows:
    print(f'{r["key"]}-{r["number"]:<3}| {r["board"]:11}| {r["col"]:11}| {r["title"]}')
PY
```

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
