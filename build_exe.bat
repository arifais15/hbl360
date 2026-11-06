@echo off
chcp 65001 >nul
TITLE PBS House Loan Management System - Exe Builder
echo ====================================================================
echo   PBS House Loan Management System
echo  Creating Standalone Offline Single Executable (.exe)
echo ====================================================================
echo.
echo Building PBS_House_Loan_System.exe ...
echo Please wait...
echo.

cd /d "%~dp0"
call npm run build:exe

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ====================================================================
    echo [SUCCESS] Single executable created successfully!
    echo File: PBS_House_Loan_System.exe
    echo.
    echo You can copy PBS_House_Loan_System.exe to any Windows computer.
    echo It runs 100%% offline without installing Node.js or any software.
    echo ====================================================================
) else (
    echo.
    echo [ERROR] Build failed. Please check the logs above.
)

echo.
pause
