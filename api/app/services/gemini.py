"""Gemini-powered coaching text: weekly insights and group challenges.

Privacy: Gemini only ever receives aggregate numbers — no names, emails, usernames,
avatars, or video. Every response is parsed into a strict schema, range-checked,
and replaced by a clearly-labelled rule-based result if anything goes wrong.
"""
import asyncio
import json
import logging
import re
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from ..config import get_settings

log = logging.getLogger(__name__)

SAFETY_RULES = (
    "You write for Striqs, a social fitness app that tracks push-ups, squats and planks with "
    "on-device pose detection. Be warm, specific and brief. "
    "Never give medical, injury, diet or weight-loss advice, never diagnose, and never "
    "suggest training through pain. Recommend rest days as part of progress. "
    "Never suggest more than 100 reps of one exercise, or more than 5 minutes of planking, "
    "in a single day for one person. "
    "Only reference numbers present in the data you are given."
)
BANNED = re.compile(r"\b(diagnos\w*|injur\w*|cure\w*|calorie\w*|weight loss|lose weight|pain)\b", re.I)


class AIUnavailable(Exception):
    pass


# ---------- schemas Gemini must return ----------

class WeeklyInsight(BaseModel):
    headline: str = Field(min_length=3, max_length=90)
    summary: str = Field(min_length=10, max_length=420)
    highlights: list[str] = Field(min_length=1, max_length=3)
    next_steps: list[str] = Field(min_length=1, max_length=3)


class ChallengeDraft(BaseModel):
    title: str = Field(min_length=3, max_length=60)
    description: str = Field(min_length=10, max_length=400)
    goal_reps: int = Field(ge=10, le=20000)
    min_sessions_per_member: int = Field(ge=1, le=7)
    rationale: str = Field(min_length=5, max_length=300)


async def _generate(prompt: str, schema: type[BaseModel]) -> BaseModel:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise AIUnavailable("GEMINI_API_KEY not set")
    from google import genai
    from google.genai import errors, types

    client = genai.Client(api_key=settings.gemini_api_key)
    try:
        resp = await asyncio.wait_for(
            client.aio.models.generate_content(
                model=settings.gemini_model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=SAFETY_RULES,
                    response_mime_type="application/json",
                    response_schema=schema,
                    temperature=0.7,
                ),
            ),
            timeout=settings.gemini_timeout_s,
        )
    except TimeoutError as e:
        raise AIUnavailable("Gemini timed out") from e
    except errors.APIError as e:  # includes 429 rate limits
        log.warning("Gemini API error %s: %s", getattr(e, "code", "?"), e)
        raise AIUnavailable(f"Gemini error {getattr(e, 'code', '')}".strip()) from e

    try:
        parsed = resp.parsed if isinstance(resp.parsed, schema) else schema.model_validate_json(resp.text or "")
    except (ValidationError, json.JSONDecodeError) as e:
        raise AIUnavailable("Gemini returned output that failed validation") from e
    text = " ".join(str(v) for v in parsed.model_dump().values())
    if BANNED.search(text):
        raise AIUnavailable("Gemini output failed the content safety check")
    return parsed


# ---------- weekly insight ----------

async def weekly_insight(stats: dict[str, Any]) -> tuple[dict[str, Any], Literal["gemini", "rules"], str | None]:
    prompt = (
        "Write this user's weekly workout summary from these aggregate stats (JSON). Plank time is in seconds. "
        "Highlight real progress, note one positive trend, and suggest 1–3 small, sustainable next steps. "
        "If they were inactive, be encouraging and suggest an easy restart.\n\n"
        + json.dumps(stats)
    )
    try:
        out = await _generate(prompt, WeeklyInsight)
        return out.model_dump(), "gemini", get_settings().gemini_model
    except AIUnavailable as e:
        log.info("Weekly insight falling back to rules: %s", e)
        return rule_based_insight(stats), "rules", None


def _done_this_week(s: dict[str, Any]) -> str:
    parts = []
    ex = s.get("byExercise", {})
    if ex.get("pushup", {}).get("validReps"):
        parts.append(f"{ex['pushup']['validReps']} push-ups")
    if ex.get("squat", {}).get("validReps"):
        parts.append(f"{ex['squat']['validReps']} squats")
    if ex.get("plank", {}).get("holdSeconds"):
        secs = ex["plank"]["holdSeconds"]
        parts.append(f"{secs // 60}:{secs % 60:02d} of planking")
    if not parts:
        return "your sets"
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]


def rule_based_insight(s: dict[str, Any]) -> dict[str, Any]:
    sessions = s.get("sessionsThisWeek", 0)
    form = s.get("avgFormThisWeek")
    delta = s.get("formChangeVsLastWeek")
    if sessions == 0:
        lifetime = s.get("lifetimeSessions", 0)
        return {
            "headline": "A fresh week is a good week to start",
            "summary": "No tracked sets this week yet. One short session is enough to get going.",
            "highlights": [
                f"{lifetime} tracked session{'s' if lifetime != 1 else ''} so far" if lifetime
                else ("You're in a group — your crew will see your first set" if s.get("groupsJoined") else "Your account is set up and ready")
            ],
            "next_steps": ["Do one set of whatever feels comfortable — even 5 good reps or a 20-second plank counts."],
        }
    highlights = [f"{sessions} session{'s' if sessions != 1 else ''}: {_done_this_week(s)}"]
    if form is not None:
        highlights.append(f"Average form score {form:.0f}")
    if delta is not None and delta > 0:
        highlights.append(f"Form up {delta:.1f} points on last week")
    steps = ["Keep one rest day between harder sessions."]
    if form is not None and form < 75:
        steps.insert(0, "Try fewer, slower reps — or shorter planks — with cleaner form.")
    elif sessions < 3:
        steps.insert(0, "Add one more short session this week.")
    tried = [k for k, v in s.get("byExercise", {}).items() if v.get("sessions")]
    if len(tried) == 1:
        steps.append("Mix in a different exercise for variety.")
    return {
        "headline": "Solid week of showing up" if sessions >= 3 else "Good momentum this week",
        "summary": f"You logged {_done_this_week(s)} across {sessions} session{'s' if sessions != 1 else ''}.",
        "highlights": highlights[:3],
        "next_steps": steps[:3],
    }


# ---------- group challenge ----------

DIFFICULTY_MULTIPLIER = {"easy": 0.8, "moderate": 1.1, "hard": 1.4}


def challenge_bounds(group_stats: dict[str, Any], difficulty: str, days: int) -> tuple[int, int, int]:
    """A sensible goal range from the group's actual recent activity."""
    members = max(1, group_stats["memberCount"])
    recent_daily = group_stats["validRepsLast14Days"] / 14
    # Floor: a beginner-friendly 10 reps per member per 2 days.
    baseline = max(recent_daily * days, members * 5 * days)
    target = baseline * DIFFICULTY_MULTIPLIER[difficulty]
    return int(target * 0.7), int(target), int(target * 1.4)


async def group_challenge(
    group_stats: dict[str, Any], difficulty: str, days: int, exercise: str = "push-ups"
) -> tuple[dict[str, Any], Literal["gemini", "rules"], str | None]:
    lo, mid, hi = challenge_bounds(group_stats, difficulty, days)
    prompt = (
        f"Design one collective {exercise} challenge lasting {days} days for this group. "
        "Everyone's valid reps add to one shared total, so the goal must be reachable when "
        "every member contributes a modest amount — it must not depend on the strongest members. "
        f"Difficulty: {difficulty}. The goal_reps should be between {lo} and {hi} (suggested ~{mid}). "
        "Set min_sessions_per_member so participation matters more than volume. "
        "Give a short, upbeat title (no emoji) and explain in the rationale why the goal suits this group.\n\n"
        "Group stats (JSON): " + json.dumps(group_stats)
    )
    try:
        draft = await _generate(prompt, ChallengeDraft)
        data = draft.model_dump()
        # Never trust the model's arithmetic: clamp to the range computed from real data.
        data["goal_reps"] = max(lo, min(hi, data["goal_reps"]))
        data["min_sessions_per_member"] = max(1, min(days, data["min_sessions_per_member"]))
        return data, "gemini", get_settings().gemini_model
    except AIUnavailable as e:
        log.info("Challenge falling back to rules: %s", e)
        members = group_stats["memberCount"]
        return (
            {
                "title": f"{mid} {exercise} together in {days} days",
                "description": (
                    f"Every valid rep from every member counts toward {mid}. "
                    f"That's about {max(1, round(mid / max(1, members) / days))} per person per day — "
                    "and everyone logging at least two sessions matters more than any single big set."
                ),
                "goal_reps": mid,
                "min_sessions_per_member": min(2, days),
                "rationale": "Set from the group's last two weeks of activity.",
            },
            "rules",
            None,
        )
