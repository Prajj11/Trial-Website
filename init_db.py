"""
CineVault database verifier.

The project currently ships with cinevault.db. This script keeps the documented
setup command useful by checking that the database exists, is readable, and has
the tables the Flask API expects.
"""

import os
import sqlite3
import sys


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "cinevault.db")
REQUIRED_TABLES = {"content", "genres"}


def main():
    if not os.path.exists(DB_PATH):
        print("cinevault.db was not found.")
        print("Restore the database file before starting the app.")
        return 1

    try:
        conn = sqlite3.connect(DB_PATH)
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            print(f"Database integrity check failed: {integrity}")
            return 1

        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        missing = REQUIRED_TABLES - tables
        if missing:
            print("Database is missing required table(s): " + ", ".join(sorted(missing)))
            return 1

        content_count = conn.execute("SELECT COUNT(*) FROM content").fetchone()[0]
        genre_count = conn.execute("SELECT COUNT(*) FROM genres").fetchone()[0]
        print("Database is ready.")
        print(f"content rows: {content_count}")
        print(f"genre rows: {genre_count}")
        return 0
    except sqlite3.Error as exc:
        print(f"Database check failed: {exc}")
        return 1
    finally:
        try:
            conn.close()
        except UnboundLocalError:
            pass


if __name__ == "__main__":
    sys.exit(main())
