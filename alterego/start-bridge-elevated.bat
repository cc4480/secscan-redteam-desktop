@echo off
cd /d "%USERPROFILE%\pc-mcp-bridge"
set PC_BRIDGE_FULL_ACCESS=1
set PC_BRIDGE_FULL_ACCESS_CONFIRM=0
:loop
echo [%date% %time%] starting bridge server...
pc-agent\.venv\Scripts\python pc-agent\server.py
echo [%date% %time%] bridge server exited with code %errorlevel% - restarting in 5 seconds
ping -n 6 127.0.0.1 >nul
goto loop

