#!/usr/bin/env python3
"""RETIRED — see scripts/board.ts.

VSK-38 cutover moved the board to the hosted Neon Postgres instance. This
script used to write the local SQLite prisma/dev.db, which is now a stale
legacy copy. Writing it would silently diverge from the live board, so this
shim refuses to run and points at the replacement.

Use the Node/Prisma tool, which talks to the live board via DATABASE_URL:

  npx tsx scripts/board.ts create --project VSK --title "..." [--column Open]
  npx tsx scripts/board.ts edit VSK-12 [--column Developing]
"""
import sys

sys.exit(
    "scripts/board.py is retired (VSK-38 cutover). The board now lives on "
    "hosted Neon Postgres, not local prisma/dev.db.\n"
    "Use:  npx tsx scripts/board.ts {create|edit} ...\n"
    "(set DATABASE_URL to the live Neon URL, e.g. in a gitignored repo-root .env)"
)
