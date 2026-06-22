#!/usr/bin/env bash
# ── OneMCP — start all three services ────────────────────────────────────────
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Default ports ─────────────────────────────────────────────────────────────
API_PORT=8000
MCP_PORT=8002
FRONTEND_PORT=5173

# ── Parse named args: ./run.sh --api 8080 --mcp 8003 --frontend 3000 ─────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --api)      API_PORT="$2";      shift 2 ;;
    --mcp)      MCP_PORT="$2";      shift 2 ;;
    --frontend) FRONTEND_PORT="$2"; shift 2 ;;
    *) shift ;;
  esac
done

echo ""
echo " Ports:"
echo "   API       (FastAPI)  : $API_PORT"
echo "   MCP       (fastmcp)  : $MCP_PORT"
echo "   Frontend  (Vite dev) : $FRONTEND_PORT"
echo ""

# ── Start FastAPI backend ─────────────────────────────────────────────────────
cd "$SCRIPT_DIR/compiler"
API_PORT=$API_PORT ./venv/bin/python main.py &
API_PID=$!

# ── Start MCP server ──────────────────────────────────────────────────────────
./venv/bin/fastmcp run app/mcp_server.py --transport streamable-http --port "$MCP_PORT" --host 0.0.0.0 &
MCP_PID=$!

# ── Start Vite dev server ─────────────────────────────────────────────────────
cd "$SCRIPT_DIR/frontend"
API_PORT=$API_PORT FRONTEND_PORT=$FRONTEND_PORT npm run dev &
FRONTEND_PID=$!

trap "kill $API_PID $MCP_PID $FRONTEND_PID 2>/dev/null" EXIT

echo ""
echo "================================================"
echo "  API       : http://localhost:$API_PORT"
echo "  MCP       : http://localhost:$MCP_PORT/mcp"
echo "  Frontend  : http://localhost:$FRONTEND_PORT"
echo "================================================"
echo ""

wait
