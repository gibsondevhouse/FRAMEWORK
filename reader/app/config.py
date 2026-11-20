"""Paths and settings for the multi-title CFR reader."""
from __future__ import annotations

import logging
import os
import re
import stat
import tempfile
import threading
import traceback
from pathlib import Path
from urllib.parse import quote

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


def fr_corpus_titles() -> list[int] | None:
    """CFR titles whose Federal Register documents the FR corpus collects
    (`FR_CORPUS_TITLES`, comma-separated). None = the installed titles."""
    raw = os.getenv("FR_CORPUS_TITLES", "").strip()
    out: list[int] = []
    for tok in raw.split(","):
        tok = tok.strip()
        if tok.isdigit() and 1 <= int(tok) <= 50 and int(tok) not in out:
            out.append(int(tok))
    return out or None


def fr_corpus_years() -> int:
    """How many years back the FR corpus reaches (`FR_CORPUS_YEARS`, default 5, 1-30)."""
    try:
        return max(1, min(30, int(os.getenv("FR_CORPUS_YEARS", "5").strip() or 5)))
    except ValueError:
        return 5


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


def secure_env_file(path: Path | None = None) -> None:
    """Make reader/.env readable and writable by its owner only (register SEC-004). The app
    writes the file that way itself; this covers one made by hand (`cp .env.example .env`
    leaves it readable by everyone on the machine). Windows has no such file modes: there the
    file is protected by the permissions of the folder it is in."""
    target = path or env_path()
    if os.name != "posix":
        return
    try:
        mode = stat.S_IMODE(target.stat().st_mode)
        if mode & 0o077:
            os.chmod(target, mode & 0o700)
    except OSError:
        pass


def write_env_updates(updates: dict[str, str | None]) -> dict:
    """Create or update reader/.env atomically and apply changes to os.environ. The file is
    written owner-only: `mkstemp` creates the temporary file with mode 0600 before any key is
    in it, and that file then replaces reader/.env, so the keys are never readable by anyone
    else, not even for a moment, whatever mode the old file had."""
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


# --- Keys never reach a log (register SEC-004) ----------------------------------------------
#
# The DOL and GovInfo APIs take their key as a query parameter, and the HTTP client logs every
# request address at INFO ("HTTP Request: GET https://…?X-API-KEY=…"). Nothing prints that by
# default, but one `logging.basicConfig(level=logging.INFO)` anywhere would. So every log
# record made in this process has its keys removed before any handler sees it.

LOG_SECRET_KEYS = (*ENV_SECRET_KEYS, "GOVINFO_API_KEY")
REDACTED = "[redacted]"
MIN_SECRET_CHARS = 8          # shorter values are not keys, and replacing them would mangle text
# The lookahead skips a value that is already the marker, so redacting twice changes nothing
# more: `_redact_record` relies on that to tell a cleaned record from one that still has a key.
_SECRET_PARAM_RE = re.compile(r"(?i)\b((?:x-api-key|api[_-]?key)=)(?!\[redacted\])[^&\s\"'<>)\]]+")


def redact_secrets(text: str) -> str:
    """`text` without any API key: the value of a key-carrying query parameter (`X-API-KEY=`,
    `api_key=`), and every configured key wherever it appears, plain or URL-encoded."""
    out = _SECRET_PARAM_RE.sub(lambda m: m.group(1) + REDACTED, text)
    for name in LOG_SECRET_KEYS:
        value = os.environ.get(name, "").strip()
        if len(value) < MIN_SECRET_CHARS:
            continue
        for form in {value, quote(value, safe="")}:
            if form in out:
                out = out.replace(form, REDACTED)
    return out


def _clean_log_arg(arg):
    if arg is None or isinstance(arg, (bool, int, float)):
        return arg
    try:
        text = arg if isinstance(arg, str) else str(arg)
    except Exception:
        return arg
    clean = redact_secrets(text)
    return arg if clean == text else clean


def _redact_record(record: logging.LogRecord) -> None:
    try:
        message = record.getMessage()
    except Exception:
        return                                      # a malformed record: logging reports it itself
    if redact_secrets(message) != message:
        # Clean the arguments in place first, so a formatter that reads `record.args` (the
        # server's access log does) still finds them; flatten only if a key is still there.
        args = record.args
        if isinstance(args, dict):
            record.args = {k: _clean_log_arg(v) for k, v in args.items()}
        elif isinstance(args, tuple):
            record.args = tuple(_clean_log_arg(a) for a in args)
        if isinstance(record.msg, str):
            record.msg = redact_secrets(record.msg)
        try:
            still = record.getMessage()
        except Exception:
            still = message
        if redact_secrets(still) != still:
            record.msg, record.args = redact_secrets(message), None
    if record.exc_info and record.exc_info[0] is not None and not record.exc_text:
        text = "".join(traceback.format_exception(*record.exc_info)).rstrip("\n")
        if redact_secrets(text) != text:
            record.exc_text = redact_secrets(text)  # formatters use this instead of re-formatting


def install_log_redaction() -> None:
    """Wrap the process's log-record factory so that no record carries an API key. Safe to
    call more than once."""
    current = logging.getLogRecordFactory()
    if getattr(current, "redacts_secrets", False):
        return

    def factory(*args, **kwargs) -> logging.LogRecord:
        record = current(*args, **kwargs)
        _redact_record(record)
        return record

    factory.redacts_secrets = True  # type: ignore[attr-defined]
    logging.setLogRecordFactory(factory)


secure_env_file()
install_log_redaction()
