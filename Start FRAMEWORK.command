#!/bin/bash
# Double-click to start the FRAMEWORK reader and open it in your browser.
# Close this window (or press Ctrl+C) to stop the server.

ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT=8000
URL="http://127.0.0.1:$PORT"

# Already running? Just open it.
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "FRAMEWORK is already running on $URL"
  open "$URL"
  exit 0
fi

# First run: create the virtualenv and install dependencies.
if [ ! -x "$ROOT/.venv/bin/python" ]; then
  PY="$(command -v python3.12 || command -v python3.11 || command -v python3.10)"
  if [ -z "$PY" ]; then
    echo "Python 3.10+ is required. Install it with: brew install python@3.12"
    read -n 1 -s -r -p "Press any key to close."
    exit 1
  fi
  echo "First run: setting up Python environment (one time)..."
  "$PY" -m venv "$ROOT/.venv" &&
    "$ROOT/.venv/bin/pip" install fastapi "uvicorn[standard]" httpx anthropic python-dotenv pytest || {
      echo "Setup failed."
      read -n 1 -s -r -p "Press any key to close."
      exit 1
    }
fi

cd "$ROOT/reader" || exit 1

# Open the browser once the server answers (first run may download Title 29, which can take a while).
(
  for _ in $(seq 1 300); do
    if curl -s -o /dev/null "$URL/"; then open "$URL"; exit 0; fi
    sleep 1
  done
) &

echo "Starting FRAMEWORK on $URL  (Ctrl+C or close this window to stop)"
exec "$ROOT/.venv/bin/python" -m uvicorn app.main:app --host 127.0.0.1 --port $PORT
