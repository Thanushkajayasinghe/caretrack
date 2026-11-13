import sqlite3
import json

def inspect_db(db_path):
    print("==================================================")
    print("INSPECTING:", db_path)
    print("==================================================")
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    tables = [t[0] for t in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    print("Tables:", tables)
    for t in tables:
        rows = cur.execute("SELECT * FROM " + t).fetchall()
        print(f"\n--- Table '{t}' ({len(rows)} rows) ---")
        col_names = [d[0] for d in cur.description]
        print("Columns:", col_names)
        for r in rows:
            print(r)

inspect_db("child_offline.db")
inspect_db("child_RKStorage.db")
