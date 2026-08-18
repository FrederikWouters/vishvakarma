# Vishvakarma

A Jira-like project management tool: swimlane boards with drag-and-drop tickets, one board per project.

## Stack

- **Next.js 15** (App Router) + **TypeScript**
- **Prisma** ORM + **SQLite** (`prisma/dev.db`)
- Native HTML5 drag-and-drop (no extra dependencies)

## Data model

- **Project** — has a unique `key` (e.g. `VSK`) and many columns
- **Column** — a board swimlane (To Do / In Progress / Done), ordered
- **Ticket** — belongs to a column, ordered within it

New projects are seeded with three default columns.

## Getting started

```bash
npm install
npx prisma generate
npx prisma migrate dev      # creates dev.db and applies schema
npm run db:seed             # optional: sample VSK project
npm run dev                 # http://localhost:3000
```

## Routes

| Path | Purpose |
|------|---------|
| `/` | Projects list + create form |
| `/projects/[id]/board` | Swimlane board for a project |
| `POST /api/projects` | Create project (+ default columns) |
| `POST /api/columns` | Add a column to a project |
| `POST /api/tickets` | Create a ticket |
| `PATCH /api/tickets/[id]` | Move/edit a ticket (used by drag-and-drop) |
| `DELETE /api/tickets/[id]` | Delete a ticket |
