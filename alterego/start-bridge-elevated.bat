@echo off
REM AlterEgo bridge autostart (elevated task).
REM Guarded: refuses to start if a bridge already owns the port.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bridge-guard.ps1" -Check
if errorlevel 1 exit /b 1

cd /d "C:\Users\Cho-zen\secscan-rebuild-test\alterego"

REM Dont-ask posture: every tool executes without a prompt. This is the
REM owner's chosen default -- the event log still records every call.
set PC_BRIDGE_FULL_ACCESS=1
set PC_BRIDGE_FULL_ACCESS_CONFIRM=0
set PC_BRIDGE_PERMISSION_MODE=dontAsk

:loop
echo [%date% %time%] starting bridge server...
pc-agent\.venv\Scripts\python.exe pc-agent\server.py
echo [%date% %time%] bridge exited with code %errorlevel% - restarting in 5 seconds
ping -n 6 127.0.0.1 >nul
goto loop
