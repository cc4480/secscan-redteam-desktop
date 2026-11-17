@echo off
REM AlterEgo bridge autostart (elevated task).
REM Guarded: refuses to start if a bridge already owns the port.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bridge-guard.ps1" -Check
if errorlevel 1 exit /b 1

cd /d "C:\Users\Cho-zen\secscan-rebuild-test\alterego"

REM Graded posture: writes and destructive actions still ask. Full access is
REM NOT forced here -- the previous version set PC_BRIDGE_FULL_ACCESS=1, which
REM silently disabled every approval prompt.
set PC_BRIDGE_PERMISSION_MODE=acceptEdits
set PC_BRIDGE_FULL_ACCESS=
set PC_BRIDGE_FULL_ACCESS_CONFIRM=

:loop
echo [%date% %time%] starting bridge server...
pc-agent\.venv\Scripts\python.exe pc-agent\server.py
echo [%date% %time%] bridge exited with code %errorlevel% - restarting in 5 seconds
ping -n 6 127.0.0.1 >nul
goto loop
