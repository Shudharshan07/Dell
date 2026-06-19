@echo off
REM ── MCP Workflow Proxy — one-command setup (Windows) ──────────────────────────
echo === MCP Workflow Proxy setup ===

cd /d "%~dp0compiler"
if not exist venv (
    echo Creating Python venv...
    python -m venv venv
)
echo Installing backend dependencies...
call venv\Scripts\python -m pip install --quiet --upgrade pip
call venv\Scripts\pip install --quiet -r requirements.txt
if not exist .env (
    copy .env.example .env >nul
    echo Created compiler\.env  --  add your API keys before running.
)

cd /d "%~dp0frontend"
echo Installing + building frontend...
call npm install
call npm run build

echo.
echo ============================================================
echo  Setup complete. Add keys to compiler\.env, then run:
echo     run.bat
echo  App:  http://localhost:8000     MCP (SSE): http://localhost:8002/sse
echo ============================================================
pause
