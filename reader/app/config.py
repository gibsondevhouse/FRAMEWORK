"""Paths and settings for the multi-title CFR reader."""
from __future__ import annotations

import os
import re
import tempfile
import threading
from pathlib import Path

from dotenv import load_dotenv

APP_DIR = Path(__file__).resolve().parent
ROOT_DIR = APP_DIR.parent
STATIC_DIR = ROOT_DIR / "static"
DATA_DIR = ROOT_DIR / "data"

load_dotenv(ROOT_DIR / ".env")

DEFAULT_TITLE = 29
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


def anthropic_key() -> str | None:
    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    return key or None


def dol_api_key() -> str | None:
    key = os.getenv("DOL_API_KEY", "").strip()
    return key or None


def news_agencies() -> list[str]:
    """Federal Register agency slugs to follow. Only OSHA is supported in this plan."""
    raw = os.getenv("NEWS_AGENCIES", "occupational-safety-and-health-administration")
    return [s.strip() for s in raw.split(",") if s.strip()]


def news_sync_enabled() -> bool:
    """False turns the background news worker off (tests, offline use)."""
    return os.getenv("NEWS_SYNC", "1").strip().lower() not in ("0", "false", "no", "off")


def preferred_model() -> str | None:
    model = os.getenv("ANTHROPIC_MODEL", "").strip()
    return model or None


ENV_SECRET_KEYS = ("DOL_API_KEY", "ANTHROPIC_API_KEY")
ENV_DEFAULTS = {
    "ANTHROPIC_MODEL": "claude-sonnet-5-5",
    "NEWS_AGENCIES": "occupational-safety-and-health-administration",
    "NEWS_SYNC": "1",
    "NEWS_RETENTION_DAYS": "365",
}
ENV_ALLOWED_KEYS = set(ENV_SECRET_KEYS) | set(ENV_DEFAULTS)
_ENV_LINE_RE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=")
_env_write_lock = threading.Lock()


def env_path() -> Path:
    return ROOT_DIR / ".env"


def env_example_path() -> Path:
    return ROOT_DIR / ".env.example"


def mask_secret(value: str | None) -> str | None:
    """Return a short masked preview of a secret key, never the full value."""
    v = (value or "").strip()
    if not v:
        return None
    if len(v) <= 6:
        return "••••"
    if v.startswith("sk-ant-") and len(v) > 12:
        return f"sk-ant-••••{v[-4:]}"
    return f"{v[:4]}••••{v[-4:]}" if len(v) >= 12 else f"••••{v[-4:]}"


def _retention_days_env() -> int:
    try:
        return max(1, int(os.getenv("NEWS_RETENTION_DAYS", "365").strip() or 365))
    except ValueError:
        return 365


def env_status() -> dict:
    """Read-only snapshot of reader/.env presence and masked/effective settings."""
    dol = dol_api_key()
    ant = anthropic_key()
    return {
        "env_exists": env_path().exists(),
        "env_file": "reader/.env",
        "keys": {
            "DOL_API_KEY": {"configured": dol is not None, "masked": mask_secret(dol)},
            "ANTHROPIC_API_KEY": {"configured": ant is not None, "masked": mask_secret(ant)},
            "ANTHROPIC_MODEL": {
                "value": os.getenv("ANTHROPIC_MODEL", "").strip(),
                "default": ENV_DEFAULTS["ANTHROPIC_MODEL"],
            },
            "NEWS_AGENCIES": {
                "value": os.getenv("NEWS_AGENCIES", ENV_DEFAULTS["NEWS_AGENCIES"]).strip()
                or ENV_DEFAULTS["NEWS_AGENCIES"],
                "default": ENV_DEFAULTS["NEWS_AGENCIES"],
            },
            "NEWS_SYNC": {
                "value": news_sync_enabled(),
                "raw": os.getenv("NEWS_SYNC", ENV_DEFAULTS["NEWS_SYNC"]).strip()
                or ENV_DEFAULTS["NEWS_SYNC"],
                "default": True,
            },
            "NEWS_RETENTION_DAYS": {
                "value": _retention_days_env(),
                "default": 365,
            },
        },
    }


def _format_env_value(value: str) -> str:
    if any(ch in value for ch in ("\r", "\n", "\x00")):
        raise ValueError("Environment values cannot contain newlines or null bytes.")
    if value == "":
        return ""
    if any(ch.isspace() for ch in value) or "#" in value or '"' in value or "'" in value:
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return value


def write_env_updates(updates: dict[str, str | None]) -> dict:
    """Create or update reader/.env atomically and apply changes to os.environ."""
    cleaned: dict[str, str | None] = {}
    for key, val in updates.items():
        if key not in ENV_ALLOWED_KEYS:
            raise ValueError(f"Unsupported environment key: {key}")
        if val is None:
            cleaned[key] = None
        else:
            s = val.strip()
            _format_env_value(s)
            cleaned[key] = s if s else None

    with _env_write_lock:
        target = env_path()
        seed = target if target.exists() else env_example_path()
        lines = seed.read_text(encoding="utf-8").splitlines() if seed.exists() else []

        seen: set[str] = set()
        out_lines: list[str] = []
        for line in lines:
            m = _ENV_LINE_RE.match(line)
            if m and m.group(1) in cleaned:
                k = m.group(1)
                seen.add(k)
                v = cleaned[k]
                out_lines.append(f"{k}={_format_env_value(v or '')}")
            else:
                out_lines.append(line)

        for k, v in cleaned.items():
            if k not in seen:
                out_lines.append(f"{k}={_format_env_value(v or '')}")

        target.parent.mkdir(parents=True, exist_ok=True)
        payload = "\n".join(out_lines).rstrip("\n") + "\n"
        fd, tmp_name = tempfile.mkstemp(prefix=".env.", suffix=".tmp", dir=target.parent)
        tmp_path = Path(tmp_name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(payload)
            try:
                os.chmod(tmp_path, 0o600)
            except OSError:
                pass
            os.replace(tmp_path, target)
        except Exception:
            tmp_path.unlink(missing_ok=True)
            raise

        for k, v in cleaned.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

        return env_status()
