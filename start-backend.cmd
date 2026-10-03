@echo off
rem Pasugun backend (dev mode API on http://127.0.0.1:8000). Close this window to stop it.
cd /d "%~dp0backend"
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
pause
