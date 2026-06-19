#!/usr/bin/env bash
# Launches both services inside the container.
set -e
# FastAPI (REST API + built UI) on :8000
python main.py &
# MCP server (workflow-level tools over SSE) on :8002
exec fastmcp run app/mcp_server.py --transport sse --port 8002 --host 0.0.0.0
