# Agentic Workflow Workspace

This folder is a clean workspace for the next phase of the product.

Purpose:
- keep the agent implementation separate from the existing backend flow
- let the team work on each agent independently
- provide one orchestrator entrypoint that runs a full agentic workflow from the shared LangGraph runtime state

Agents:
- `agent-1-parse-and-research.js`
  - parse professor-posted material
  - fetch relevant supporting context from the web or other tools later
- `agent-2-summarize-by-preference.js`
  - create a student-tailored summary from source material + context
- `agent-3-create-flashcards.js`
  - generate flashcards from the summarized learning package
- `agent-4-create-quizzes.js`
  - generate quizzes from the summarized learning package
- `agent-5-create-video-plan.js`
  - prepare a video/interactive lesson payload for the video teammate to complete
- `agent-6-create-study-plan.js`
  - generate a study plan from course state, deadlines, and student preferences
- `agent-7-state-change-decider.js`
  - monitor Canvas state changes and performance signals
  - decide whether the student needs recovery, reinforcement, advancement, or message support
  - recommend the next agents to run when a grade, missing assignment, message, or new material appears
- `agent-8-grade-intervention.js`
  - react to assignment or exam score changes
  - explain what likely went wrong and where the student can improve
  - generate a curated video-learning brief and automatic study-plan adjustment
- `agent-6-orchestrator.js`
  - LangGraph orchestrator for the full workflow

Shared files:
- `contracts/runtime-state-contract.js`
  - documents the expected runtime state shape agents can depend on
- `contracts/agent-result-contract.js`
  - helper utilities for building consistent agent outputs
- `index.js`
  - registry + execution entrypoint

Expected runtime input:
- use the existing `buildLangGraphRuntimeState(...)` output from `backend/lib/langgraph-runtime.js`

Current status:
- scaffolding is production-structured
- logic is intentionally lightweight so each teammate can implement their own agent in isolation
