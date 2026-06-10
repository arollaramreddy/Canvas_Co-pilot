from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Storage:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.data_dir / "copilot.db"
        self.init_db()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def init_db(self) -> None:
        with self.connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    name TEXT,
                    email TEXT,
                    avatar_url TEXT,
                    last_login_at TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT,
                    canvas_base_url TEXT,
                    access_token TEXT,
                    login_at TEXT,
                    logout_at TEXT,
                    FOREIGN KEY(user_id) REFERENCES users(id)
                );

                CREATE TABLE IF NOT EXISTS workflow_runs (
                    id TEXT PRIMARY KEY,
                    user_id TEXT,
                    course_id TEXT,
                    workflow_type TEXT,
                    title TEXT,
                    summary TEXT,
                    result_json TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS preferences (
                    user_id TEXT PRIMARY KEY,
                    preferences_json TEXT,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS activity_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT,
                    event_type TEXT,
                    detail_json TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                );
                """
            )

    def upsert_user(self, user: dict[str, Any]) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO users (id, name, email, avatar_url, last_login_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    email = excluded.email,
                    avatar_url = excluded.avatar_url,
                    last_login_at = excluded.last_login_at
                """,
                (
                    str(user["id"]),
                    user.get("name", ""),
                    user.get("email", ""),
                    user.get("avatar_url", ""),
                    utc_now(),
                ),
            )

    def create_session(self, user: dict[str, Any], canvas_base_url: str, access_token: str) -> str:
        session_id = uuid.uuid4().hex
        self.upsert_user(user)
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO sessions (id, user_id, canvas_base_url, access_token, login_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (session_id, str(user["id"]), canvas_base_url, access_token, utc_now()),
            )
        return session_id

    def get_session(self, session_id: str | None) -> dict[str, Any] | None:
        if not session_id:
            return None
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT s.*, u.name, u.email, u.avatar_url
                FROM sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.id = ? AND s.logout_at IS NULL
                """,
                (session_id,),
            ).fetchone()
        return dict(row) if row else None

    def end_session(self, session_id: str | None) -> None:
        if not session_id:
            return
        with self.connect() as conn:
            conn.execute("UPDATE sessions SET logout_at = ? WHERE id = ?", (utc_now(), session_id))

    def save_workflow_run(self, user_id: str, result: dict[str, Any], course_id: str | None = None) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO workflow_runs
                (id, user_id, course_id, workflow_type, title, summary, result_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    result["run_id"],
                    str(user_id),
                    str(course_id) if course_id else None,
                    result.get("workflow_type", ""),
                    result.get("title", ""),
                    result.get("overview", ""),
                    json.dumps(result),
                ),
            )

    def workflow_runs(self, user_id: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
        query = "SELECT * FROM workflow_runs"
        params: tuple[Any, ...] = ()
        if user_id:
            query += " WHERE user_id = ?"
            params = (str(user_id),)
        query += " ORDER BY created_at DESC LIMIT ?"
        params = (*params, limit)
        with self.connect() as conn:
            rows = conn.execute(query, params).fetchall()
        return [self._decode_run(dict(row)) for row in rows]

    def get_workflow_run(self, run_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM workflow_runs WHERE id = ?", (run_id,)).fetchone()
        return self._decode_run(dict(row)) if row else None

    def save_preferences(self, user_id: str, preferences: dict[str, Any]) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO preferences (user_id, preferences_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    preferences_json = excluded.preferences_json,
                    updated_at = excluded.updated_at
                """,
                (str(user_id), json.dumps(preferences), utc_now()),
            )

    def get_preferences(self, user_id: str) -> dict[str, Any]:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT preferences_json FROM preferences WHERE user_id = ?",
                (str(user_id),),
            ).fetchone()
        if not row:
            return {}
        try:
            return json.loads(row["preferences_json"])
        except json.JSONDecodeError:
            return {}

    def log_event(self, user_id: str | None, event_type: str, detail: dict[str, Any]) -> None:
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO activity_events (user_id, event_type, detail_json) VALUES (?, ?, ?)",
                (str(user_id) if user_id else None, event_type, json.dumps(detail)),
            )

    def activity_summary(self, user_id: str | None = None) -> dict[str, Any]:
        params: tuple[Any, ...] = ()
        where = ""
        if user_id:
            where = "WHERE user_id = ?"
            params = (str(user_id),)
        with self.connect() as conn:
            events = conn.execute(f"SELECT COUNT(*) AS count FROM activity_events {where}", params).fetchone()
            runs = conn.execute(f"SELECT COUNT(*) AS count FROM workflow_runs {where}", params).fetchone()
        return {"events": events["count"], "workflow_runs": runs["count"]}

    @staticmethod
    def _decode_run(row: dict[str, Any]) -> dict[str, Any]:
        try:
            row["result"] = json.loads(row.pop("result_json"))
        except (KeyError, json.JSONDecodeError, TypeError):
            row["result"] = {}
        return row
