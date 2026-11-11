"""Paths and settings for the multi-title CFR reader."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

APP_DIR = Path(__file__).resolve().parent
ROOT_DIR = APP_DIR.parent
STATIC_DIR = ROOT_DIR / "static"
DATA_DIR = ROOT_DIR / "data"

load_dotenv(ROOT_DIR / ".env")

DEFAULT_TITLE = 29
TITLE = 29
ECFR_BASE = "https://www.ecfr.gov"
ECFR_API = f"{ECFR_BASE}/api/versioner/v1"


def db_path(title: int = DEFAULT_TITLE) -> Path:
    """Return SQLite database path for a given CFR title."""
    std = DATA_DIR / f"title-{title}.sqlite3"
    if std.exists():
        return std
    if title == 29:
        legacy = DATA_DIR / "title29.sqlite3"
        if legacy.exists():
            return legacy
    return std


def tree_path(title: int = DEFAULT_TITLE) -> Path:
    """Return navigation tree JSON path for a given CFR title."""
    std = DATA_DIR / f"tree-{title}.json"
    if std.exists():
        return std
    if title == 29:
        legacy = DATA_DIR / "tree.json"
        if legacy.exists():
            return legacy
    return std


def installed_titles() -> list[int]:
    """Scan DATA_DIR for installed title SQLite databases."""
    titles = set()
    if not DATA_DIR.exists():
        return []
    for f in DATA_DIR.glob("title-*.sqlite3"):
        stem = f.stem.replace("title-", "")
        if stem.isdigit():
            titles.add(int(stem))
    if (DATA_DIR / "title29.sqlite3").exists():
        titles.add(29)
    return sorted(titles)


DB_PATH = db_path(29)
TREE_PATH = tree_path(29)


def anthropic_key() -> str | None:
    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    return key or None


def preferred_model() -> str | None:
    model = os.getenv("ANTHROPIC_MODEL", "").strip()
    return model or None
