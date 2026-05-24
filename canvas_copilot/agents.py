from __future__ import annotations

import re
import uuid
from collections import Counter
from datetime import date, timedelta
from typing import Any


STOP_WORDS = {
    "about",
    "after",
    "again",
    "also",
    "because",
    "before",
    "between",
    "course",
    "from",
    "have",
    "into",
    "that",
    "their",
    "there",
    "these",
    "this",
    "with",
    "would",
    "your",
}


def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def split_sentences(text: str) -> list[str]:
    normalized = clean_text(text)
    if not normalized:
        return []
    parts = re.split(r"(?<=[.!?])\s+", normalized)
    return [part.strip() for part in parts if len(part.strip()) > 12]


def keywords(text: str, limit: int = 8) -> list[str]:
    words = re.findall(r"[A-Za-z][A-Za-z\-]{3,}", text.lower())
    filtered = [word for word in words if word not in STOP_WORDS]
    return [word for word, _count in Counter(filtered).most_common(limit)]


def best_sentences(text: str, limit: int = 5) -> list[str]:
    sentences = split_sentences(text)
    if len(sentences) <= limit:
        return sentences

    key_terms = set(keywords(text, limit=12))
    scored = []
    for index, sentence in enumerate(sentences):
        sentence_words = set(re.findall(r"[A-Za-z][A-Za-z\-]{3,}", sentence.lower()))
        score = len(sentence_words & key_terms) + max(0, 4 - index) * 0.15
        scored.append((score, index, sentence))
    selected = sorted(scored, reverse=True)[:limit]
    return [sentence for _score, _index, sentence in sorted(selected, key=lambda item: item[1])]


def build_summary(text: str) -> dict[str, Any]:
    selected = best_sentences(text, limit=6)
    terms = keywords(text, limit=10)
    return {
        "title": "Study Summary",
        "overview": selected[0] if selected else "Add course content to generate a useful summary.",
        "key_points": selected or ["Paste notes, assignment text, or Canvas material into the workspace."],
        "key_terms": terms,
        "next_step": "Review the key points, then test recall with flashcards or a quiz.",
    }


def build_flashcards(text: str) -> list[dict[str, str]]:
    terms = keywords(text, limit=8)
    sentences = split_sentences(text)
    cards = []
    for term in terms:
        support = next((sentence for sentence in sentences if term in sentence.lower()), "")
        cards.append(
            {
                "front": f"What should you remember about {term.replace('-', ' ')}?",
                "back": support or f"{term.replace('-', ' ').title()} is an important concept from this material.",
            }
        )
    if not cards:
        cards.append(
            {
                "front": "What is the main idea of this material?",
                "back": "Add more source text to generate targeted flashcards.",
            }
        )
    return cards


def build_quiz(text: str, count: int = 5) -> list[dict[str, Any]]:
    cards = build_flashcards(text)
    questions = []
    for index, card in enumerate(cards[:count], start=1):
        answer = card["back"]
        questions.append(
            {
                "question": f"{index}. {card['front']}",
                "choices": [
                    answer,
                    "A detail unrelated to the selected course material.",
                    "A reminder to skip the topic until the exam.",
                    "A definition from a different module.",
                ],
                "answer": answer,
                "explanation": "The correct answer is grounded in the source material you provided.",
            }
        )
    return questions


def build_study_plan(text: str, days: int = 5) -> list[dict[str, Any]]:
    terms = keywords(text, limit=max(5, days))
    summary_points = best_sentences(text, limit=days)
    start = date.today()
    sessions = []
    for offset in range(days):
        topic = terms[offset % len(terms)].replace("-", " ").title() if terms else f"Review block {offset + 1}"
        goal = summary_points[offset % len(summary_points)] if summary_points else "Review the course material and write down questions."
        sessions.append(
            {
                "day": (start + timedelta(days=offset)).isoformat(),
                "title": f"Session {offset + 1}: {topic}",
                "duration_minutes": 45 if offset < days - 1 else 60,
                "goal": goal,
                "tasks": [
                    "Read or skim the source material.",
                    "Write a short explanation in your own words.",
                    "Answer practice questions without looking at notes.",
                ],
            }
        )
    return sessions


def build_lesson(text: str) -> dict[str, Any]:
    summary = build_summary(text)
    flashcards = build_flashcards(text)[:4]
    return {
        "title": "Guided Lesson",
        "opening": summary["overview"],
        "sections": [
            {"heading": "Core idea", "talk_track": point}
            for point in summary["key_points"][:4]
        ],
        "checks_for_understanding": [card["front"] for card in flashcards],
        "closing": "Replay the hard parts, then generate a quiz to confirm recall.",
    }


def compute_intervention(assignments: list[dict[str, Any]]) -> dict[str, Any]:
    scored = []
    missing = 0
    for assignment in assignments:
        points = assignment.get("points_possible")
        score = assignment.get("score")
        if assignment.get("missing"):
            missing += 1
        if points and score is not None:
            try:
                scored.append(float(score) / float(points) * 100)
            except (TypeError, ValueError, ZeroDivisionError):
                continue

    average = sum(scored) / len(scored) if scored else None
    risk = 0
    if average is not None:
        risk += max(0, 80 - average)
    risk += missing * 15
    risk = min(100, round(risk))
    if risk >= 60:
        level = "high"
    elif risk >= 30:
        level = "medium"
    else:
        level = "low"
    return {
        "score": risk,
        "level": level,
        "average": round(average, 2) if average is not None else None,
        "missing_assignments": missing,
        "recommendation": "Start with low-score assignments, schedule a review block, and generate a focused quiz.",
    }


def run_workflow(
    source_text: str,
    workflow_type: str,
    *,
    title: str = "Manual workflow",
    assignments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    text = clean_text(source_text)
    workflow_type = workflow_type or "summary"
    assets: dict[str, Any] = {}

    if workflow_type in {"summary", "agentic"}:
        assets["summary"] = build_summary(text)
    if workflow_type in {"flashcards", "agentic"}:
        assets["flashcards"] = build_flashcards(text)
    if workflow_type in {"quiz", "agentic"}:
        assets["quiz"] = build_quiz(text)
    if workflow_type in {"study_plan", "agentic"}:
        assets["study_plan"] = build_study_plan(text)
    if workflow_type in {"lesson", "agentic"}:
        assets["lesson"] = build_lesson(text)
    if workflow_type == "intervention":
        assets["intervention"] = compute_intervention(assignments or [])

    if not assets:
        assets["summary"] = build_summary(text)

    return {
        "run_id": uuid.uuid4().hex,
        "title": title,
        "workflow_type": workflow_type,
        "overview": assets.get("summary", {}).get("overview", "Workflow generated successfully."),
        "assets": assets,
    }
