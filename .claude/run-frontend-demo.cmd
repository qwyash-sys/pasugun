@echo off
rem Demo-mode preview: a process env var overrides .env.local in Vite.
set "PATH=C:\Program Files\nodejs;%PATH%"
set "VITE_RESPONSE_SOURCE=demo"
cd /d "%~dp0..\frontend"
call npx vite --port 5174 --strictPort
