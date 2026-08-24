#!/usr/bin/env python3
"""Create or edit Vishvakarma tickets from the CLI.

The Next.js app uses Prisma, whose @default(cuid()/now()/autoincrement-ish)
values are applied in the client layer, not the DB. Raw SQLite writes must
therefore supply id / number / order / createdAt themselves — this script does.

Usage:
  python3 scripts/board.py create --project VSK --title "..." \
      [--description "..."] [--column Open]
  python3 scripts/board.py edit VSK-12 [--title "..."] \
      [--description "..."] [--column Developing]

`--column` takes a column NAME (unique per project, e.g. Open, Developing,
Closed). On create it defaults to "Open". On edit, giving --column MOVES the
ticket to that column (i.e. changes its status). Tickets are referenced as
KEY-NUMBER (e.g. VSK-12).
"""
import argparse
import os
import re
import secrets
import sqlite3
import sys
import time

DB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                  "prisma", "dev.db")


def gen_id():
    # Opaque unique string PK; app treats id as opaque. cuid-ish shape.
    return "c" + secrets.token_hex(12)


def connect():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c


def find_project(c, key):
    r = c.execute("select id, key from Project where key=?", (key.upper(),)).fetchone()
    if not r:
        sys.exit(f"error: no project with key {key!r}")
    return r


def find_column(c, project_id, name):
    r = c.execute(
        'select id, name, board from "Column" where projectId=? and name=? collate nocase',
        (project_id, name)).fetchone()
    if not r:
        sys.exit(f"error: no column named {name!r} in this project")
    return r


def find_ticket(c, ref):
    m = re.fullmatch(r"([A-Za-z]+)-(\d+)", ref.strip())
    if not m:
        sys.exit(f"error: ticket ref must be KEY-NUMBER (e.g. VSK-12), got {ref!r}")
    key, num = m.group(1).upper(), int(m.group(2))
    proj = find_project(c, key)
    r = c.execute("select * from Ticket where projectId=? and number=?",
                  (proj["id"], num)).fetchone()
    if not r:
        sys.exit(f"error: no ticket {key}-{num}")
    return proj, r


def next_number(c, project_id):
    r = c.execute("select coalesce(max(number),0)+1 n from Ticket where projectId=?",
                  (project_id,)).fetchone()
    return r["n"]


def next_order(c, column_id):
    r = c.execute('select coalesce(max("order"),-1)+1 o from Ticket where columnId=?',
                  (column_id,)).fetchone()
    return r["o"]


def cmd_create(a):
    c = connect()
    try:
        proj = find_project(c, a.project)
        col = find_column(c, proj["id"], a.column)
        num = next_number(c, proj["id"])
        order = next_order(c, col["id"])
        tid = gen_id()
        c.execute(
            'insert into Ticket (id, title, description, "order", number, columnId, projectId, createdAt) '
            'values (?,?,?,?,?,?,?,?)',
            (tid, a.title, a.description, order, num, col["id"], proj["id"],
             int(time.time() * 1000)))
        c.commit()
        print(f"created {proj['key']}-{num}  [{col['board']}/{col['name']}]  {a.title}")
    finally:
        c.close()


def cmd_edit(a):
    c = connect()
    try:
        proj, t = find_ticket(c, a.ref)
        sets, vals, notes = [], [], []
        if a.title is not None:
            sets.append("title=?"); vals.append(a.title); notes.append("title")
        if a.description is not None:
            sets.append("description=?"); vals.append(a.description); notes.append("description")
        if a.column is not None:
            col = find_column(c, proj["id"], a.column)
            sets.append("columnId=?"); vals.append(col["id"])
            sets.append('"order"=?'); vals.append(next_order(c, col["id"]))
            notes.append(f"moved to {col['board']}/{col['name']}")
        if not sets:
            sys.exit("error: nothing to edit (give --title, --description, and/or --column)")
        vals.append(t["id"])
        c.execute(f"update Ticket set {', '.join(sets)} where id=?", vals)
        c.commit()
        print(f"edited {proj['key']}-{t['number']}  ({'; '.join(notes)})")
    finally:
        c.close()


def main():
    p = argparse.ArgumentParser(description="Create or edit Vishvakarma tickets.")
    sub = p.add_subparsers(dest="cmd", required=True)

    pc = sub.add_parser("create", help="create a new ticket")
    pc.add_argument("--project", required=True, help="project key, e.g. VSK")
    pc.add_argument("--title", required=True)
    pc.add_argument("--description", default=None)
    pc.add_argument("--column", default="Open", help="column name (default: Open)")
    pc.set_defaults(func=cmd_create)

    pe = sub.add_parser("edit", help="edit an existing ticket (KEY-NUMBER)")
    pe.add_argument("ref", help="ticket ref, e.g. VSK-12")
    pe.add_argument("--title", default=None)
    pe.add_argument("--description", default=None)
    pe.add_argument("--column", default=None, help="move ticket to this column (name)")
    pe.set_defaults(func=cmd_edit)

    a = p.parse_args()
    a.func(a)


if __name__ == "__main__":
    main()
