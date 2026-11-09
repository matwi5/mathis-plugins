"""Claude Code statusLine renderer.

Reads the JSON payload Claude Code pipes on stdin and prints a compact
one-line status: dir | model (effort) | exp | ctx % | 5h % | wk %.

exp is the server-side experiment ID that Claude Code caches per model in
~/.claude.json (clientDataCacheSlots[].data.atis) and forwards as the
x-cc-atis request header: its first 3 characters in yellow, or "exp:none"
dimmed when the newest CLI slot of the model has none. Nothing shows when the
file, the slot or a field is missing.

The 5-hour quota shows only from 1 % used. The Ultra plan has no 5-hour limit:
Claude Code then omits the window or reports it near 0 %, and neither the payload nor
~/.claude.json names an Ultra plan (checked on Claude Code 2.1.316). Pro and
Max, which keep the limit, see it again as soon as it reaches 1 %.
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone

# Force UTF-8 on stdout (Windows defaults to cp1252 which chokes on block chars).
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def dig(obj, path, default=None):
    for key in path:
        if not isinstance(obj, dict) or key not in obj or obj[key] is None:
            return default
        obj = obj[key]
    return obj


FULL = "█"
EMPTY = "░"

RESET = "\033[0m"


def _color(v):
    if v is None:
        return "\033[90m"  # grey
    if v < 50:
        return "\033[32m"  # green
    if v < 80:
        return "\033[33m"  # yellow
    return "\033[31m"      # red


def _num(data, path):
    v = dig(data, path)
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def bar(value, step=5):
    """step = percent per block; width = 100/step blocks."""
    width = 100 // step
    if value is None:
        return f"{_color(None)}{EMPTY * width}{RESET}"
    p = max(0.0, min(100.0, float(value)))
    filled = min(int(p // step), width)
    chars = FULL * filled + EMPTY * (width - filled)
    return f"{_color(p)}{chars}{RESET}"


def label(tag, value, step=5):
    pct_str = f"{value:2.0f}%" if value is not None else "--%"
    return f"{tag} {bar(value, step)} {pct_str}"


def last_sunday(year, month):
    if month == 12:
        d = datetime(year, 12, 31, tzinfo=timezone.utc)
    else:
        d = datetime(year, month + 1, 1, tzinfo=timezone.utc) - timedelta(days=1)
    while d.weekday() != 6:
        d -= timedelta(days=1)
    return d


def paris_time_now():
    now_utc = datetime.now(timezone.utc)
    y = now_utc.year
    dst_start = last_sunday(y, 3).replace(hour=1)
    dst_end = last_sunday(y, 10).replace(hour=1)
    offset_h = 2 if dst_start <= now_utc < dst_end else 1
    return (now_utc + timedelta(hours=offset_h)).strftime("%H:%M")


def experiment(model_id):
    """Indicator of the cached experiment ID for this model, or "" if unknown."""
    if not model_id:
        return ""
    if model_id.endswith("[1m]"):
        model_id = model_id[: -len("[1m]")]
    try:
        with open(os.path.join(os.path.expanduser("~"), ".claude.json"), encoding="utf-8") as f:
            conf = json.load(f)
    except Exception:
        return ""
    org = dig(conf, ["oauthAccount", "organizationUuid"])
    slots = conf.get("clientDataCacheSlots") if isinstance(conf, dict) else None
    if isinstance(slots, dict):
        slots = list(slots.values())
    if not org or not isinstance(slots, list):
        return ""
    matching = [
        s for s in slots
        if isinstance(s, dict)
        and s.get("model") == model_id
        and s.get("entrypoint") == "cli"
        and s.get("org") == org
        and isinstance(s.get("at"), (int, float))
    ]
    if not matching:
        return ""
    newest = max(matching, key=lambda s: s["at"])
    atis = dig(newest, ["data", "atis"])
    if isinstance(atis, str) and atis:
        return f"\033[33mexp:{atis[:3]}{RESET}"
    return f"\033[2mexp:none{RESET}"


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        data = {}

    cwd = dig(data, ["workspace", "current_dir"]) or data.get("cwd") or ""
    dir_name = os.path.basename(cwd.rstrip("/\\")) if cwd else ""

    model = dig(data, ["model", "display_name"]) or ""
    if model.startswith("Claude "):
        model = model[len("Claude "):]
    effort = dig(data, ["effort", "level"])
    if model and effort:
        model = f"{model} ({effort})"

    ctx = _num(data, ["context_window", "used_percentage"])
    five = _num(data, ["rate_limits", "five_hour", "used_percentage"])
    week = _num(data, ["rate_limits", "seven_day", "used_percentage"])

    parts = [
        f"\033[1;36m{dir_name}{RESET}" if dir_name else "",
        f"\033[35m{model}{RESET}" if model else "",
        experiment(dig(data, ["model", "id"])),
        label("🧠", ctx, step=5),
        label("⏱️", five, step=10) if five is not None and five >= 1 else "",
        label("📅", week, step=10),
    ]
    print(" | ".join(p for p in parts if p))


if __name__ == "__main__":
    main()
