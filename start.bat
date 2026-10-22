@echo off
chcp 65001 >nul
TITLE PBS Employee House Loan Management System
echo ====================================================================
echo   PBS Employee House Construction Loan Management System
echo   (PBS House Loan Management System)
echo ====================================================================
echo.
echo Starting the server. The browser will open automatically; please wait...
echo.

cd /d "%~dp0"
node server.js

pause
