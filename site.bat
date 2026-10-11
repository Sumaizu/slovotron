@echo off
chcp 65001 >nul
title Словотрон
cd /d "%~dp0"
set PYTHONUTF8=1

where python >nul 2>nul
if errorlevel 1 goto try_py
python tools\serve.py
goto done

:try_py
where py >nul 2>nul
if errorlevel 1 goto no_python
py -3 tools\serve.py
goto done

:no_python
echo.
echo Не найден Python. Поставь его с https://www.python.org/downloads/
echo При установке отметь галочку "Add python.exe to PATH", потом запусти этот файл снова.
echo.
pause
exit /b 1

:done
if errorlevel 1 pause
