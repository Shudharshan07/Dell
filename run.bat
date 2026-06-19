@echo off
echo Building frontend...
cd /d "%~dp0frontend"
call npm run build
if %errorlevel% neq 0 (
    echo Frontend build failed. Aborting.
    pause
    exit /b 1
)

echo.
echo Starting backend...
cd /d "%~dp0compiler"
start "API Proxy - FastAPI" cmd /k "venv\Scripts\activate && python main.py"

timeout /t 2 /nobreak >nul

echo.
echo Starting MCP server...
start "API Proxy - MCP" cmd /k "venv\Scripts\activate && fastmcp run app/mcp_server.py --transport sse --port 8002"

timeout /t 2 /nobreak >nul

echo.
echo ================================
echo  FastAPI:   http://localhost:8000
echo  MCP (SSE): http://localhost:8002/sse
echo ================================
echo.
pause