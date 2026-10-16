#!/usr/bin/env bash
# Lanceur de la barre d'état Claude Code (clé statusLine de settings.json).
# Lance statusline.py, à côté de ce fichier, avec le premier Python trouvé :
# python3 (macOS, Linux) puis python (Windows). Sous Windows, le python3 de
# WindowsApps n'est qu'un raccourci vers le Microsoft Store : on l'ignore.
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for candidate in python3 python; do
  py="$(command -v "$candidate")" || continue
  case "$py" in *WindowsApps*) continue ;; esac
  exec "$py" "$dir/statusline.py"
done
echo "statusline: Python introuvable"
