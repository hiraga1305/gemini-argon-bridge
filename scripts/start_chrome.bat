@echo off
chcp 65001 >nul
echo =======================================================
echo KHOI DONG GOOGLE CHROME VOI CONG REMOTE DEBUGGING 9222
echo =======================================================

powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:9222/json/version' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }"
if %errorlevel% equ 0 (
    echo [OK] Trinh duyet CDP da mo san o cong 9222!
    exit /b 0
)

set CHROME_PATH=""
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set CHROME_PATH="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
) else if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    set CHROME_PATH="%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
)

if %CHROME_PATH%=="" (
    echo [LOI] Khong tim thay Google Chrome tren may!
    pause
    exit /b 1
)

echo Dang khoi dong Google Chrome...
start "" %CHROME_PATH% --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\Google\Chrome\ArgonProfile" "https://gemini.google.com/app"
echo [OK] Da bat Google Chrome! Hay dang nhap va chon Argon voi muc Cao.
