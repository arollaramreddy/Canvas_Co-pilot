# Canvas Study Assistant

Canvas Study Assistant is a full-stack project that connects to Canvas, lets a student browse their courses, and uses AI to turn course PDFs into summaries, study notes, module overviews, agent-driven study plans, and narrated lesson slides.

## What the project does

- Connects to Canvas with a personal access token
- Lists active courses as clickable cards
- Opens each course in its own detail view
- Shows modules, assignments, and uploaded files
- Extracts text from PDF files
- Summarizes individual PDFs and full modules
- Runs an AI agent that explores modules and assignments before answering
- Generates lesson-slide JSON that the frontend plays as a narrated mini lesson

## Project structure

```text
frontend/   React + Vite UI
backend/    Express API for Canvas + AI features
```

## Environment setup

Create `backend/.env` with:

```env
CANVAS_TOKEN=your_canvas_token_here
CANVAS_BASE_URL=https://canvas.asu.edu/api/v1
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

If you already keep secrets in the repo-root `.env`, make sure the backend env matches the values you want to use at runtime.

## Install

From the repo root:

```bash
npm run install:backend
npm run install:frontend
```

## Run locally

Use two terminals from the repo root:

Terminal 1:

```bash
npm run dev:backend
```

Terminal 2:

```bash
npm run dev:frontend
```

App URLs:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3001`

## Available root scripts

```bash
npm run dev:frontend
npm run dev:backend
npm run start:backend
npm run build
npm run lint
```

## Notes

- The root `package.json` is just a workspace-style command wrapper; frontend and backend dependencies still live in their own folders.
- PDF extraction works best on text-based PDFs. Scanned/image PDFs may return little or no text.
- AI-powered features require a valid Anthropic API key in `backend/.env`.

## Verification

The frontend production build and linting are expected to run from the repo root with:

```bash
npm run build
npm run lint
```
