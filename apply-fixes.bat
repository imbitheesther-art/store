@echo off
REM ===========================================================================
REM  POS repair + hardening patch.
REM
REM  Run this ONCE (double-click). It will:
REM    1. Ask Windows for administrator rights (needed to edit Program Files).
REM    2. Close any running copy of POS.
REM    3. Delete leftover NeDB ".db~" scratch files that wedge the server.
REM    4. Back up the original files next to themselves (*.bak).
REM    5. Copy in the fixed versions:
REM         start.js            - single-instance lock + server closes on quit
REM         api\dbpath.js       - cleans stale NeDB temp files
REM         index.html          - M-Pesa / Split payment modal, keypad buttons
REM         assets\js\pos.js    - payment handling, labels, receipt, retry gate
REM         assets\js\product-filter.js - keypad targets the visible pay field
REM         assets\js\receipt.js - footer from settings + payment details row
REM         assets\css\core.css / pages.css - offline fonts, readable text
REM    6. Start POS again.
REM
REM  Your data is never touched - only these code files are replaced.
REM ===========================================================================

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator rights...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

setlocal
set "INSTALL=C:\Program Files\POS"
set "APP=%INSTALL%\resources\app"
set "SRC=%~dp0"

echo.
echo === 1. Closing any running POS ===
taskkill /IM POS.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul

echo === 2. Removing stale database scratch files ^(.db~^) ===
powershell -NoProfile -Command "Get-ChildItem \"$env:APPDATA\POS\server\databases\" -Filter '*.db~' -ErrorAction SilentlyContinue | Remove-Item -Force"

echo === 3. Backing up originals ===
copy /y "%APP%\start.js"                     "%APP%\start.js.bak"                     >nul
copy /y "%APP%\api\dbpath.js"                "%APP%\api\dbpath.js.bak"                >nul
copy /y "%APP%\index.html"                   "%APP%\index.html.bak"                   >nul
copy /y "%APP%\assets\js\pos.js"             "%APP%\assets\js\pos.js.bak"             >nul
copy /y "%APP%\assets\js\product-filter.js"  "%APP%\assets\js\product-filter.js.bak"  >nul
copy /y "%APP%\assets\js\receipt.js"         "%APP%\assets\js\receipt.js.bak"         >nul
copy /y "%APP%\assets\css\core.css"          "%APP%\assets\css\core.css.bak"          >nul
copy /y "%APP%\assets\css\pages.css"         "%APP%\assets\css\pages.css.bak"         >nul

echo === 4. Installing fixed files ===
copy /y "%SRC%start.js"                     "%APP%\start.js"                     >nul
if errorlevel 1 goto copyfail
copy /y "%SRC%api\dbpath.js"                "%APP%\api\dbpath.js"                >nul
if errorlevel 1 goto copyfail
copy /y "%SRC%index.html"                   "%APP%\index.html"                   >nul
if errorlevel 1 goto copyfail
copy /y "%SRC%assets\js\pos.js"             "%APP%\assets\js\pos.js"             >nul
if errorlevel 1 goto copyfail
copy /y "%SRC%assets\js\product-filter.js"  "%APP%\assets\js\product-filter.js"  >nul
if errorlevel 1 goto copyfail
copy /y "%SRC%assets\js\receipt.js"         "%APP%\assets\js\receipt.js"         >nul
if errorlevel 1 goto copyfail
copy /y "%SRC%assets\css\core.css"          "%APP%\assets\css\core.css"          >nul
if errorlevel 1 goto copyfail
copy /y "%SRC%assets\css\pages.css"         "%APP%\assets\css\pages.css"         >nul
if errorlevel 1 goto copyfail
goto installed

:copyfail
echo.
echo ERROR: could not copy the fixed files. Make sure this batch file sits
echo in the same folder as your POS source ^(where start.js lives^), and that
echo %APP% exists.
pause
exit /b 1

:installed

echo === 5. Starting POS ===
start "" "%INSTALL%\POS.exe"

echo.
echo Done. POS is starting up. If a Windows SmartScreen prompt appears, allow it.
pause
