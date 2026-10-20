#!/usr/bin/env bash
# macOS / Linux CDP launcher for Chrome/Chromium/Edge

PORT=${PORT:-9222}
URL="https://gemini.google.com/app"

# Check if port is already open
if curl -s "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
    echo "[OK] Browser CDP is already running on port ${PORT}!"
    exit 0
fi

# Detect OS and browser binary
BROWSER_BIN=""
PROFILE_DIR="${HOME}/.gemini-argon-profile"

if [[ "$OSTYPE" == "darwin"* ]]; then
    if [ -d "/Applications/Google Chrome.app" ]; then
        BROWSER_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    elif [ -d "/Applications/Microsoft Edge.app" ]; then
        BROWSER_BIN="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    fi
else
    # Linux
    for bin in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge; do
        if command -v "$bin" >/dev/null 2>&1; then
            BROWSER_BIN="$bin"
            break
        fi
    done
fi

if [ -z "$BROWSER_BIN" ]; then
    echo "[Error] No compatible Chromium-based browser found!"
    exit 1
fi

echo "Launching browser: ${BROWSER_BIN} on port ${PORT}..."
"$BROWSER_BIN" --remote-debugging-port="${PORT}" --user-data-dir="${PROFILE_DIR}" "${URL}" >/dev/null 2>&1 &
echo "[OK] Browser launched. Please log in and select Gemini 4 Argon."
