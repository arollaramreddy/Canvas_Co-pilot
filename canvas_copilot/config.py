from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def load_env_file(path: str | Path = ".env") -> None:
    env_path = Path(path)
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def normalize_canvas_base_url(raw_url: str | None) -> str:
    fallback = "https://canvas.asu.edu/api/v1"
    value = (raw_url or fallback).strip().rstrip("/")
    if not value:
        return fallback
    if value.endswith("/api/v1") or "/api/" in value:
        return value
    return f"{value}/api/v1"


@dataclass(frozen=True)
class Settings:
    secret_key: str
    canvas_base_url: str
    data_dir: Path
    host: str
    port: int
    demo_mode: bool

    @classmethod
    def from_env(cls) -> "Settings":
        load_env_file()
        data_dir = Path(os.getenv("DATA_DIR", "data")).resolve()
        return cls(
            secret_key=os.getenv("APP_SECRET_KEY", "dev-only-change-me"),
            canvas_base_url=normalize_canvas_base_url(os.getenv("CANVAS_BASE_URL")),
            data_dir=data_dir,
            host=os.getenv("HOST", "127.0.0.1"),
            port=int(os.getenv("PORT", "8000")),
            demo_mode=os.getenv("DEMO_MODE", "false").lower() in {"1", "true", "yes"},
        )
