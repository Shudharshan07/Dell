#!/usr/bin/env bash
# ── MCP Workflow Proxy — one-command setup (macOS / Linux) ────────────────────
set -e
cd "$(dirname "$0")/compiler"

if [ ! -d venv ]; then
  echo "Creating Python venv..."
  python3 -m venv venv
fi
echo "Installing backend dependencies..."
./venv/bin/python -m pip install --quiet --upgrade pip
./venv/bin/pip install --quiet -r requirements.txt
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created compiler/.env -- add your API keys before running."
fi

cd ../frontend
echo "Installing + building frontend..."
npm install
npm run build

echo
echo "============================================================"
echo " Setup complete. Add keys to compiler/.env, then run:"
echo "    ./run.sh"
echo " App: http://localhost:8000   MCP (SSE): http://localhost:8002/sse"
echo "============================================================"
