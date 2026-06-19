#!/usr/bin/env bash
# ── MCP Workflow Proxy — run both servers (macOS / Linux) ─────────────────────
set -e
cd "$(dirname "$0")/compiler"

# FastAPI (REST API + serves the built UI) on :8000
./venv/bin/python main.py &
API_PID=$!
trap "kill $API_PID 2>/dev/null" EXIT

sleep 2
echo "FastAPI: http://localhost:8000"
echo "MCP (SSE): http://localhost:8002/sse"

# MCP server (workflow-level tools) on :8002 — runs in the foreground
exec ./venv/bin/fastmcp run app/mcp_server.py --transport sse --port 8002
