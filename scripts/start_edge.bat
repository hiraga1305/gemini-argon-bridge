@echo off
chcp 65001 >nul
echo =======================================================
echo KHOI DONG MICROSOFT EDGE VOI CONG REMOTE DEBUGGING 9222
echo =======================================================

powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:9222/json/version' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }"
if %errorlevel% equ 0 (
    echo [OK] Trinh duyet CDP da mo san o cong 9222!
    exit /b 0
)

set EDGE_PATH=""
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    set EDGE_PATH="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
) else if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
    set EDGE_PATH="C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)

if %EDGE_PATH%=="" (
    echo [LOI] Khong tim thay Microsoft Edge tren may!
    pause
    exit /b 1
)

echo Dang khoi dong Microsoft Edge...
start "" %EDGE_PATH% --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\Microsoft\Edge\ArgonProfile" "https://gemini.google.com/app"
echo [OK] Da bat Microsoft Edge! Hay dang nhap va chon Argon voi muc Cao.
