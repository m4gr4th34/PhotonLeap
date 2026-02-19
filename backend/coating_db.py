"""
Database schema and access for user-defined coatings.
Uses SQLite (built-in) for persistence.
"""

import json
import os
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional

# Database path: project root / data / coatings.db
_ROOT = Path(__file__).resolve().parent
_DATA_DIR = _ROOT.parent / "data"
_DB_PATH = _DATA_DIR / "coatings.db"

# Schema
SCHEMA = """
CREATE TABLE IF NOT EXISTS user_coating (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL DEFAULT 'Custom',
    data_type TEXT NOT NULL CHECK (data_type IN ('constant', 'table')),
    constant_value REAL,
    data_points TEXT,
    description TEXT DEFAULT '',
    is_hr INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_coating_name ON user_coating(name);
"""


def _get_conn() -> sqlite3.Connection:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def init_db() -> None:
    """Initialize database and create tables."""
    _get_conn().close()


def get_coating_by_name(name: str) -> Optional[Dict[str, Any]]:
    """Return a single user coating by name, or None if not found."""
    conn = _get_conn()
    try:
        cur = conn.execute(
            "SELECT id, name, category, data_type, constant_value, data_points, description, is_hr FROM user_coating WHERE name = ?",
            (name.strip(),),
        )
        r = cur.fetchone()
        if r is None:
            return None
        d: Dict[str, Any] = {
            "id": r["id"],
            "name": r["name"],
            "category": r["category"],
            "data_type": r["data_type"],
            "description": r["description"] or "",
            "is_hr": bool(r["is_hr"]),
        }
        if r["data_type"] == "constant":
            d["constant_value"] = r["constant_value"] if r["constant_value"] is not None else 0.04
        else:
            d["data_points"] = json.loads(r["data_points"]) if r["data_points"] else []
        return d
    finally:
        conn.close()


def get_all_user_coatings() -> List[Dict[str, Any]]:
    """Return all user-defined coatings."""
    conn = _get_conn()
    try:
        cur = conn.execute(
            "SELECT id, name, category, data_type, constant_value, data_points, description, is_hr FROM user_coating"
        )
        rows = cur.fetchall()
        result = []
        for r in rows:
            d: Dict[str, Any] = {
                "id": r["id"],
                "name": r["name"],
                "category": r["category"],
                "data_type": r["data_type"],
                "description": r["description"] or "",
                "type": "HR" if r["is_hr"] else "AR",
            }
            if r["data_type"] == "constant":
                d["constant_value"] = r["constant_value"] if r["constant_value"] is not None else 0.04
            else:
                d["data_points"] = json.loads(r["data_points"]) if r["data_points"] else []
            result.append(d)
        return result
    finally:
        conn.close()


def insert_user_coating(
    name: str,
    category: str,
    data_type: str,
    constant_value: Optional[float] = None,
    data_points: Optional[List[Dict[str, float]]] = None,
    description: str = "",
    is_hr: bool = False,
) -> Dict[str, Any]:
    """Insert a new user coating. Returns the created record."""
    conn = _get_conn()
    try:
        conn.execute(
            """
            INSERT INTO user_coating (name, category, data_type, constant_value, data_points, description, is_hr)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                name.strip(),
                category or "Custom",
                data_type,
                constant_value,
                json.dumps(data_points or []) if data_points else "[]",
                description or "",
                1 if is_hr else 0,
            ),
        )
        conn.commit()
        row_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        cur = conn.execute(
            "SELECT id, name, category, data_type, constant_value, data_points, description, is_hr FROM user_coating WHERE id = ?",
            (row_id,),
        )
        r = cur.fetchone()
        d: Dict[str, Any] = {
            "id": r["id"],
            "name": r["name"],
            "category": r["category"],
            "data_type": r["data_type"],
            "description": r["description"] or "",
            "type": "HR" if r["is_hr"] else "AR",
        }
        if r["data_type"] == "constant":
            d["constant_value"] = r["constant_value"] if r["constant_value"] is not None else 0.04
        else:
            d["data_points"] = json.loads(r["data_points"]) if r["data_points"] else []
        return d
    finally:
        conn.close()
