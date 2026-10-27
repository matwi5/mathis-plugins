#!/bin/sh
# Contrôles d'un plugin : scripts/check.sh <plugin>... (détail : scripts/check.py).
# Sous Windows : scripts\check.cmd <plugin>...
dir=$(dirname "$0")
if command -v python3 >/dev/null 2>&1 && python3 -c "" >/dev/null 2>&1; then
  exec python3 "$dir/check.py" "$@"
fi
exec python "$dir/check.py" "$@"
