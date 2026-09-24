@echo off
set CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" (
    echo Error: csc.exe not found at %CSC%
    exit /b 1
)

echo Compiling EasyAG-Resident.exe...
"%CSC%" /nologo /out:"%~dp0resident\EasyAG-Resident.exe" /target:winexe /r:System.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Xaml.dll /lib:"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\WPF" /r:PresentationCore.dll /r:PresentationFramework.dll /r:WindowsBase.dll "%~dp0resident\EasyAG-Resident.cs"
if %ERRORLEVEL% equ 0 (
    echo Success: Compiled %~dp0resident\EasyAG-Resident.exe
    if not exist "%~dp0..\assets" mkdir "%~dp0..\assets"
    copy /Y "%~dp0resident\EasyAG-Resident.exe" "%~dp0..\assets\EasyAG-Resident.exe"
) else (
    echo Failed to compile.
    exit /b %ERRORLEVEL%
)
