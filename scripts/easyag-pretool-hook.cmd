@echo off
setlocal
set HOOK_DIR=%~dp0
"D:\node\node.exe" "%HOOK_DIR%easyag-pretool-hook.cjs"
