@echo off
cd /d "%~dp0"
where node >nul 2>&1 || (
  echo Install Node.js from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
where yt-dlp >nul 2>&1 || (
  echo Install yt-dlp and run this file again. The Add button needs it on this PC.
  pause
  exit /b 1
)
where ffmpeg >nul 2>&1 || (
  echo Install ffmpeg and run this file again. The Add button needs it on this PC.
  pause
  exit /b 1
)
if not exist ".env.txt" if not exist ".env" (
  echo Copy .env.txt into this folder. It is not stored on GitHub.
  pause
  exit /b 1
)
echo Desk: http://127.0.0.1:4173
echo Leave this window open while you use Add.
node dashboard\server.js
pause
