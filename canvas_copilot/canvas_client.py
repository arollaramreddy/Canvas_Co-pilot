from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import requests

from .config import normalize_canvas_base_url


class CanvasError(RuntimeError):
    """Raised when Canvas returns an error or an unexpected response."""


@dataclass
class CanvasClient:
    access_token: str
    base_url: str
    timeout_seconds: int = 20

    def __post_init__(self) -> None:
        self.base_url = normalize_canvas_base_url(self.base_url)

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.access_token}"}

    def _url(self, path: str) -> str:
        return f"{self.base_url}/{path.lstrip('/')}"

    def _get_page(self, path: str, params: dict[str, Any] | None = None) -> requests.Response:
        response = requests.get(
            self._url(path),
            headers=self.headers,
            params=params,
            timeout=self.timeout_seconds,
        )
        if response.status_code >= 400:
            raise CanvasError(f"Canvas request failed: {response.status_code} {response.text[:240]}")
        return response

    def _get_json(self, path: str, params: dict[str, Any] | None = None) -> Any:
        response = self._get_page(path, params=params)
        try:
            return response.json()
        except ValueError as exc:
            raise CanvasError("Canvas returned non-JSON data") from exc

    def _get_paginated(self, path: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        next_url: str | None = self._url(path)
        page_params = {"per_page": 100, **(params or {})}

        while next_url:
            response = requests.get(
                next_url,
                headers=self.headers,
                params=page_params if next_url == self._url(path) else None,
                timeout=self.timeout_seconds,
            )
            if response.status_code >= 400:
                raise CanvasError(f"Canvas request failed: {response.status_code} {response.text[:240]}")
            payload = response.json()
            if isinstance(payload, list):
                items.extend(payload)
            else:
                items.append(payload)
            next_url = response.links.get("next", {}).get("url")
            page_params = None

        return items

    def current_user(self) -> dict[str, Any]:
        user = self._get_json("users/self/profile")
        return {
            "id": str(user.get("id", "canvas-user")),
            "name": user.get("name") or user.get("short_name") or "Canvas Student",
            "email": user.get("primary_email") or user.get("login_id") or "",
            "avatar_url": user.get("avatar_url") or "",
        }

    def courses(self) -> list[dict[str, Any]]:
        courses = self._get_paginated(
            "courses",
            {
                "enrollment_state": "active",
                "include[]": ["term", "total_scores"],
            },
        )
        return [
            {
                "id": str(course.get("id")),
                "name": course.get("name") or course.get("course_code") or "Untitled course",
                "course_code": course.get("course_code") or "",
                "workflow_state": course.get("workflow_state") or "",
            }
            for course in courses
            if course.get("id")
        ]

    def assignments(self, course_id: str) -> list[dict[str, Any]]:
        assignments = self._get_paginated(
            f"courses/{course_id}/assignments",
            {"include[]": ["submission"]},
        )
        normalized = []
        for assignment in assignments:
            submission = assignment.get("submission") or {}
            normalized.append(
                {
                    "id": str(assignment.get("id")),
                    "name": assignment.get("name") or "Assignment",
                    "due_at": assignment.get("due_at"),
                    "points_possible": assignment.get("points_possible"),
                    "score": submission.get("score"),
                    "grade": submission.get("grade"),
                    "submitted_at": submission.get("submitted_at"),
                    "missing": bool(submission.get("missing")),
                    "html_url": assignment.get("html_url"),
                }
            )
        return normalized

    def modules(self, course_id: str) -> list[dict[str, Any]]:
        modules = self._get_paginated(f"courses/{course_id}/modules")
        return [
            {
                "id": str(module.get("id")),
                "name": module.get("name") or "Module",
                "position": module.get("position"),
                "published": module.get("published"),
            }
            for module in modules
        ]

    def module_items(self, course_id: str, module_id: str) -> list[dict[str, Any]]:
        return self._get_paginated(f"courses/{course_id}/modules/{module_id}/items")

    def files(self, course_id: str) -> list[dict[str, Any]]:
        files = self._get_paginated(f"courses/{course_id}/files")
        return [
            {
                "id": str(file_item.get("id")),
                "display_name": file_item.get("display_name") or file_item.get("filename") or "File",
                "content_type": file_item.get("content-type") or file_item.get("content_type") or "",
                "url": file_item.get("url"),
                "size": file_item.get("size"),
            }
            for file_item in files
        ]

    def download_text(self, download_url: str) -> str:
        response = requests.get(download_url, headers=self.headers, timeout=self.timeout_seconds)
        if response.status_code >= 400:
            raise CanvasError(f"File download failed: {response.status_code}")
        content_type = response.headers.get("content-type", "")
        if "pdf" in content_type.lower():
            return "PDF text extraction is not enabled in this lightweight Python version. Paste text into the workspace instead."
        return response.content.decode("utf-8", errors="replace")


def demo_courses() -> list[dict[str, Any]]:
    return [
        {"id": "demo-101", "name": "Data Engineering Foundations", "course_code": "CSE 101", "workflow_state": "available"},
        {"id": "demo-205", "name": "Applied Machine Learning", "course_code": "AML 205", "workflow_state": "available"},
    ]


def demo_assignments() -> list[dict[str, Any]]:
    return [
        {
            "id": "a1",
            "name": "ETL pipeline reflection",
            "due_at": "2026-06-01T23:59:00Z",
            "points_possible": 100,
            "score": 82,
            "grade": "82%",
            "submitted_at": None,
            "missing": False,
            "html_url": "",
        },
        {
            "id": "a2",
            "name": "Quiz 3 recovery practice",
            "due_at": "2026-06-04T23:59:00Z",
            "points_possible": 50,
            "score": 31,
            "grade": "62%",
            "submitted_at": None,
            "missing": False,
            "html_url": "",
        },
    ]


def demo_modules() -> list[dict[str, Any]]:
    return [
        {"id": "m1", "name": "Module 1: Data Pipelines", "position": 1, "published": True},
        {"id": "m2", "name": "Module 2: Model Evaluation", "position": 2, "published": True},
    ]


def demo_files() -> list[dict[str, Any]]:
    return [
        {"id": "f1", "display_name": "lecture-notes.txt", "content_type": "text/plain", "url": "", "size": 1280},
        {"id": "f2", "display_name": "exam-review.pdf", "content_type": "application/pdf", "url": "", "size": 83210},
    ]
