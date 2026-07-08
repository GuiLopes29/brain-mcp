@echo off
cd /d "%~dp0.."
"C:\nvm4w\nodejs\node.exe" "packages\mcp-server\dist\backup.js" >> "backups\backup.log" 2>&1
