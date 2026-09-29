"""Shared date helpers."""

from datetime import datetime, timezone


def today_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)
