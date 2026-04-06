from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional


UTC = timezone.utc


def utc_now() -> datetime:
    return datetime.now(tz=UTC)


def isoformat(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat()


def parse_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


@dataclass
class ReviewState:
    reps: int = 0
    lapses: int = 0
    ease_factor: float = 2.5
    interval_days: float = 0.0
    due_at: Optional[str] = None
    last_reviewed_at: Optional[str] = None

    @classmethod
    def from_dict(cls, payload: Optional[Dict[str, object]]) -> "ReviewState":
        if not payload:
            return cls()
        return cls(
            reps=int(payload.get("reps", 0)),
            lapses=int(payload.get("lapses", 0)),
            ease_factor=float(payload.get("easeFactor", 2.5)),
            interval_days=float(payload.get("intervalDays", 0.0)),
            due_at=str(payload.get("dueAt")) if payload.get("dueAt") else None,
            last_reviewed_at=str(payload.get("lastReviewedAt")) if payload.get("lastReviewedAt") else None,
        )

    def to_dict(self) -> Dict[str, object]:
        return {
            "reps": self.reps,
            "lapses": self.lapses,
            "easeFactor": round(self.ease_factor, 3),
            "intervalDays": round(self.interval_days, 6),
            "dueAt": self.due_at,
            "lastReviewedAt": self.last_reviewed_at,
        }


def initial_due_at() -> str:
    return isoformat(utc_now())


def is_due(state: ReviewState, now: Optional[datetime] = None) -> bool:
    now = now or utc_now()
    due_at = parse_datetime(state.due_at)
    if due_at is None:
        return True
    return due_at <= now


def classify_queue(state: ReviewState, now: Optional[datetime] = None) -> str:
    if state.reps == 0:
        return "new"
    if state.interval_days < 1.0:
        return "learn"
    return "review"


def apply_review(state: ReviewState, ease: int, now: Optional[datetime] = None) -> ReviewState:
    now = now or utc_now()
    next_state = ReviewState.from_dict(state.to_dict())
    next_state.last_reviewed_at = isoformat(now)

    if ease == 1:
        next_state.lapses += 1
        next_state.reps = 0
        next_state.ease_factor = max(1.3, next_state.ease_factor - 0.2)
        next_state.interval_days = 5 / 1440
    elif ease == 2:
        next_state.reps = max(1, next_state.reps + 1)
        next_state.ease_factor = max(1.3, next_state.ease_factor - 0.05)
        if next_state.interval_days <= 0:
            next_state.interval_days = 10 / 1440
        else:
            next_state.interval_days = max(10 / 1440, next_state.interval_days * 1.2)
    elif ease == 3:
        next_state.reps += 1
        if next_state.reps == 1:
            next_state.interval_days = 1
        elif next_state.reps == 2:
            next_state.interval_days = 3
        else:
            next_state.interval_days = max(1.0, next_state.interval_days * next_state.ease_factor)
    elif ease == 4:
        next_state.reps += 1
        next_state.ease_factor = min(3.0, next_state.ease_factor + 0.1)
        if next_state.reps == 1:
            next_state.interval_days = 3
        elif next_state.reps == 2:
            next_state.interval_days = 7
        else:
            next_state.interval_days = max(2.0, next_state.interval_days * next_state.ease_factor * 1.3)
    else:
        raise ValueError("ease must be between 1 and 4")

    next_state.due_at = isoformat(now + timedelta(days=next_state.interval_days))
    return next_state
