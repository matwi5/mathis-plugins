@echo off
rem Controles d'un plugin sous Windows : scripts\check.cmd <plugin>... (detail : scripts\check.py).
python "%~dp0check.py" %*
