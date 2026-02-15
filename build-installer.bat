@echo off
echo Building Printer Agent Installer...
echo.

REM Clean previous builds
if exist dist rmdir /s /q dist
if exist build rmdir /s /q build

REM Install dependencies
echo Installing dependencies...
call npm install

REM Build the installer
echo Building installer...
call npm run build:installer

echo.
echo Build complete!
echo Installer location: dist\Printer Dashboard Agent Setup.exe
echo.
pause