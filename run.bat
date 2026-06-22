@echo off
setlocal

:: ── Default ports ────────────────────────────────────────────────────────────
set API_PORT=8000
set MCP_PORT=8002
set FRONTEND_PORT=5173

:: ── Parse named args: run.bat --api 8080 --mcp 8003 --frontend 3000 ─────────
:parse
if "%~1"=="" goto run
if /i "%~1"=="--api"      ( set API_PORT=%~2      & shift & shift & goto parse )
if /i "%~1"=="--mcp"      ( set MCP_PORT=%~2      & shift & shift & goto parse )
if /i "%~1"=="--frontend" ( set FRONTEND_PORT=%~2 & shift & shift & goto parse )
shift & goto parse

:run
echo.
echo  Ports:
echo    API       ^(FastAPI^)  : %API_PORT%
echo    MCP       ^(fastmcp^)  : %MCP_PORT%
echo    Frontend  ^(Vite dev^) : %FRONTEND_PORT%
echo.

:: ── Start FastAPI backend ────────────────────────────────────────────────────
echo Starting backend...
start "OneMCP - API" cmd /k "cd /d "%~dp0compiler" && venv\Scripts\activate && set API_PORT=%API_PORT% && python main.py"

timeout /t 2 /nobreak >nul

:: ── Start MCP server ─────────────────────────────────────────────────────────
echo Starting MCP server...
start "OneMCP - MCP" cmd /k "cd /d "%~dp0compiler" && venv\Scripts\activate && fastmcp run app/mcp_server.py --transport streamable-http --port %MCP_PORT%"

timeout /t 2 /nobreak >nul

:: ── Start Vite dev server ────────────────────────────────────────────────────
echo Starting frontend dev server...
start "OneMCP - Frontend" cmd /k "cd /d "%~dp0frontend" && set API_PORT=%API_PORT% && set FRONTEND_PORT=%FRONTEND_PORT% && npm run dev"

timeout /t 3 /nobreak >nul

echo.
echo ================================================
echo   API       : http://localhost:%API_PORT%
echo   MCP       : http://localhost:%MCP_PORT%/mcp
echo   Frontend  : http://localhost:%FRONTEND_PORT%
echo ================================================
echo.
pause
endlocal
