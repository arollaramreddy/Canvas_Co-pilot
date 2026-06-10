from __future__ import annotations

from pathlib import Path
from typing import Any

import uvicorn
from fastapi import Depends, FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

from .agents import compute_intervention, run_workflow
from .canvas_client import (
    CanvasClient,
    CanvasError,
    demo_assignments,
    demo_courses,
    demo_files,
    demo_modules,
)
from .config import Settings, normalize_canvas_base_url
from .storage import Storage


settings = Settings.from_env()
storage = Storage(settings.data_dir)
PACKAGE_DIR = Path(__file__).resolve().parent
app = FastAPI(title="Canvas Co-Pilot", version="1.0.0")
app.add_middleware(SessionMiddleware, secret_key=settings.secret_key)
app.mount("/static", StaticFiles(directory=str(PACKAGE_DIR / "static")), name="static")
templates = Jinja2Templates(directory=str(PACKAGE_DIR / "templates"))


def template(request: Request, name: str, context: dict[str, Any] | None = None) -> HTMLResponse:
    session = storage.get_session(request.session.get("session_id"))
    base_context = {
        "request": request,
        "session": session,
        "demo_mode": settings.demo_mode,
        "summary": storage.activity_summary(session["user_id"]) if session else {"events": 0, "workflow_runs": 0},
    }
    base_context.update(context or {})
    return templates.TemplateResponse(request, name, base_context)


def require_session(request: Request) -> dict[str, Any]:
    session = storage.get_session(request.session.get("session_id"))
    if not session:
        raise HTTPException(status_code=401, detail="Login required")
    return session


def redirect(path: str) -> RedirectResponse:
    return RedirectResponse(path, status_code=303)


def client_from_session(session: dict[str, Any]) -> CanvasClient:
    return CanvasClient(
        access_token=session["access_token"],
        base_url=session["canvas_base_url"],
    )


@app.get("/", response_class=HTMLResponse)
def home(request: Request) -> HTMLResponse:
    runs = []
    session = storage.get_session(request.session.get("session_id"))
    if session:
        runs = storage.workflow_runs(session["user_id"], limit=5)
    return template(request, "index.html", {"runs": runs})


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request) -> HTMLResponse:
    return template(request, "login.html", {"canvas_base_url": settings.canvas_base_url})


@app.post("/login")
def login(
    request: Request,
    canvas_base_url: str = Form(default=""),
    access_token: str = Form(default=""),
) -> RedirectResponse:
    base_url = normalize_canvas_base_url(canvas_base_url or settings.canvas_base_url)
    token = access_token.strip()

    if settings.demo_mode and token.lower() in {"", "demo"}:
        user = {"id": "demo-user", "name": "Demo Student", "email": "demo@example.com", "avatar_url": ""}
        session_id = storage.create_session(user, base_url, "demo")
        request.session["session_id"] = session_id
        storage.log_event(user["id"], "demo_login", {"base_url": base_url})
        return redirect("/courses")

    if not token:
        raise HTTPException(status_code=400, detail="Canvas access token is required.")

    try:
        user = CanvasClient(token, base_url).current_user()
    except CanvasError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    session_id = storage.create_session(user, base_url, token)
    request.session["session_id"] = session_id
    storage.log_event(user["id"], "login", {"base_url": base_url})
    return redirect("/courses")


@app.get("/logout")
def logout(request: Request) -> RedirectResponse:
    storage.end_session(request.session.get("session_id"))
    request.session.clear()
    return redirect("/")


@app.get("/courses", response_class=HTMLResponse)
def courses_page(request: Request, session: dict[str, Any] = Depends(require_session)) -> HTMLResponse:
    if session["access_token"] == "demo":
        courses = demo_courses()
        error = None
    else:
        try:
            courses = client_from_session(session).courses()
            error = None
        except CanvasError as exc:
            courses = []
            error = str(exc)
    storage.log_event(session["user_id"], "view_courses", {"count": len(courses)})
    return template(request, "courses.html", {"courses": courses, "error": error})


@app.get("/courses/{course_id}", response_class=HTMLResponse)
def course_detail(
    request: Request,
    course_id: str,
    session: dict[str, Any] = Depends(require_session),
) -> HTMLResponse:
    if session["access_token"] == "demo":
        assignments = demo_assignments()
        modules = demo_modules()
        files = demo_files()
        error = None
    else:
        client = client_from_session(session)
        try:
            assignments = client.assignments(course_id)
            modules = client.modules(course_id)
            files = client.files(course_id)
            error = None
        except CanvasError as exc:
            assignments, modules, files = [], [], []
            error = str(exc)

    intervention = compute_intervention(assignments)
    storage.log_event(session["user_id"], "view_course", {"course_id": course_id})
    return template(
        request,
        "course_detail.html",
        {
            "course_id": course_id,
            "assignments": assignments,
            "modules": modules,
            "files": files,
            "intervention": intervention,
            "error": error,
        },
    )


@app.get("/workspace", response_class=HTMLResponse)
def workspace_page(request: Request, session: dict[str, Any] = Depends(require_session)) -> HTMLResponse:
    return template(request, "workspace.html", {"result": None})


@app.post("/workspace", response_class=HTMLResponse)
def workspace_submit(
    request: Request,
    title: str = Form(default="Manual workflow"),
    workflow_type: str = Form(default="agentic"),
    course_id: str = Form(default=""),
    source_text: str = Form(default=""),
    session: dict[str, Any] = Depends(require_session),
) -> HTMLResponse:
    result = run_workflow(source_text, workflow_type, title=title)
    storage.save_workflow_run(session["user_id"], result, course_id=course_id or None)
    storage.log_event(
        session["user_id"],
        "workflow_run",
        {"workflow_type": workflow_type, "course_id": course_id, "run_id": result["run_id"]},
    )
    return template(request, "workspace.html", {"result": result})


@app.get("/history", response_class=HTMLResponse)
def history_page(request: Request, session: dict[str, Any] = Depends(require_session)) -> HTMLResponse:
    runs = storage.workflow_runs(session["user_id"], limit=30)
    return template(request, "history.html", {"runs": runs})


@app.get("/api/auth/me")
def api_me(request: Request) -> dict[str, Any]:
    session = storage.get_session(request.session.get("session_id"))
    return {"authenticated": bool(session), "user": session}


@app.get("/api/courses")
def api_courses(session: dict[str, Any] = Depends(require_session)) -> dict[str, Any]:
    if session["access_token"] == "demo":
        return {"courses": demo_courses()}
    return {"courses": client_from_session(session).courses()}


@app.get("/api/courses/{course_id}/assignments")
def api_assignments(course_id: str, session: dict[str, Any] = Depends(require_session)) -> dict[str, Any]:
    if session["access_token"] == "demo":
        assignments = demo_assignments()
    else:
        assignments = client_from_session(session).assignments(course_id)
    return {"assignments": assignments, "intervention": compute_intervention(assignments)}


@app.post("/api/agentic-workflow")
async def api_agentic_workflow(
    request: Request,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    payload = await request.json()
    result = run_workflow(
        payload.get("source_text") or payload.get("text") or payload.get("topic") or "",
        payload.get("workflow_type") or "agentic",
        title=payload.get("title") or "API workflow",
    )
    storage.save_workflow_run(session["user_id"], result, course_id=payload.get("course_id"))
    return result


@app.post("/api/study-plan")
async def api_study_plan(
    request: Request,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    payload = await request.json()
    result = run_workflow(payload.get("source_text") or payload.get("text") or "", "study_plan", title="Study plan")
    storage.save_workflow_run(session["user_id"], result, course_id=payload.get("course_id"))
    return result


@app.post("/api/quizzes/generate")
async def api_quiz(
    request: Request,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    payload = await request.json()
    result = run_workflow(payload.get("source_text") or payload.get("text") or "", "quiz", title="Generated quiz")
    storage.save_workflow_run(session["user_id"], result, course_id=payload.get("course_id"))
    return result


@app.get("/api/workflow-runs")
def api_workflow_runs(session: dict[str, Any] = Depends(require_session)) -> dict[str, Any]:
    return {"runs": storage.workflow_runs(session["user_id"], limit=50)}


def main() -> None:
    uvicorn.run("canvas_copilot.app:app", host=settings.host, port=settings.port, reload=True)


if __name__ == "__main__":
    main()
