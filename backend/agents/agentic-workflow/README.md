# Agentic Workflow Architecture

This folder contains the LangGraph-based backend orchestration layer for Canvas Copilot.

It is the part of the system that turns raw Canvas state, memory, telemetry, and performance signals into coordinated agent decisions such as:

- detect an important state change
- decide whether the student needs intervention
- ground newly posted material
- summarize content in the student’s preferred style
- generate flashcards, quizzes, study plans, and video-learning handoffs

The key design goal is separation of concerns:

- the runtime contract defines the shared state shape
- each agent owns one bounded responsibility
- the orchestrator owns execution order and handoff routing
- the frontend can consume one coherent workflow result instead of manually coordinating independent tools

## System Model

At runtime, the workflow is built around a shared LangGraph state object:

- `runtimeState`
  - the full normalized Canvas-centric state snapshot
- `options`
  - orchestration controls such as requested agents and injected dependencies
- `results`
  - per-agent outputs accumulated across the graph
- `orchestration`
  - the orchestrator’s own result envelope

The graph definition lives in [agent-6-orchestrator.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/agent-6-orchestrator.js).

The runtime state contract lives in [contracts/runtime-state-contract.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/contracts/runtime-state-contract.js).

The per-agent output contract lives in [contracts/agent-result-contract.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/contracts/agent-result-contract.js).

## Runtime Contract

Every agent assumes `runtimeState` has these top-level domains:

- `meta`
  - request metadata, user identity, runtime context
- `request`
  - current product request or workflow request
- `canvas`
  - normalized course state, selected course/module/topic, topic text, and Canvas-derived signals
- `memory`
  - persistent student preferences and learned behavior
- `telemetry`
  - recent global and course events
- `intelligence`
  - higher-level inferred performance state such as low scores and missing assignments
- `agentRegistry`
  - supported triggers, extension points, and feature metadata

This is validated by `assertRuntimeState(...)` before the graph begins.

The orchestrator also computes a reduced runtime summary through `summarizeRuntimeState(...)` so the workflow can expose a compact diagnostic view of what it is operating on.

## Agent Inventory

The active registry is exported from [index.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/index.js).

### Agent 1: Parse and Research

File: [agent-1-parse-and-research.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/agent-1-parse-and-research.js)

Responsibility:

- inspect the selected Canvas topic or newly posted material
- parse the content payload
- optionally fetch outside supporting context through injected dependencies

Inputs:

- `runtimeState.canvas.courseState.course`
- `runtimeState.canvas.selectedModule`
- `runtimeState.canvas.selectedTopic`
- `runtimeState.canvas.topicText`

Downstream impact:

- produces the grounded content package that later agents summarize and transform into learning assets

### Agent 2: Summarize by Preference

File: [agent-2-summarize-by-preference.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/agent-2-summarize-by-preference.js)

Responsibility:

- convert grounded source material into a student-tailored explanation
- adapt output shape to memory-backed preference signals such as `studyStyle`

Inputs:

- `runtimeState.memory.preferences`
- `previousResults.agent_1_parse_and_research`

Downstream impact:

- acts as the semantic hub for the fan-out stage
- flashcards, quizzes, study plans, and video plans are conceptually built on top of this summary layer

### Agent 3: Create Flashcards

File: [agent-3-create-flashcards.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/agent-3-create-flashcards.js)

Responsibility:

- convert the summarized learning package into compact recall units
- preserve important concept-answer pairs for short review loops

Inputs:

- `previousResults.agent_2_summarize_by_preference`

Downstream impact:

- provides retrieval-oriented practice artifacts
- currently sits directly before quiz generation in the graph

### Agent 4: Create Quizzes

File: [agent-4-create-quizzes.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/agent-4-create-quizzes.js)

Responsibility:

- generate checks-for-understanding from the summarized learning package
- produce assessment-style artifacts for reinforcement or recovery

Inputs:

- `previousResults.agent_2_summarize_by_preference`
- `previousResults.agent_3_create_flashcards`

Downstream impact:

- supplies structured practice to the UI and to follow-on learning loops

### Agent 5: Create Video Plan

File: [agent-5-create-video-plan.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/agent-5-create-video-plan.js)

Responsibility:

- prepare a teaching-oriented handoff for narrated or interactive lesson generation
- organize explanation cues, scenarios, and real-world anchors

Inputs:

- `previousResults.agent_2_summarize_by_preference`

Downstream impact:

- supports the video lesson path without forcing every workflow to generate full video output immediately

### Agent 6: Create Study Plan

File: [agent-6-create-study-plan.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/agent-6-create-study-plan.js)

Responsibility:

- build or refresh a study plan from course state, deadlines, and student preferences
- convert urgency signals into a prioritized session sequence

Inputs:

- `runtimeState.canvas.courseState.course`
- `runtimeState.canvas.signals.dueSoon`
- `runtimeState.memory.preferences.studyStyle`
- optionally prior diagnostic outputs from other agents

Downstream impact:

- ties autonomous recommendations to actual time allocation
- becomes especially important after a grade intervention

### Agent 7: State Change Decider

File: [agent-7-state-change-decider.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/agent-7-state-change-decider.js)

Responsibility:

- inspect telemetry, performance, and recent Canvas events
- determine whether there is an event that requires action
- compute a ranked set of decisions and recommend next agents

This is the workflow’s event-policy layer.

It currently reasons over:

- `grade_released`
- `assignment_marked_missing`
- `new_material_posted`
- `new_module_posted`
- `new_message_received`
- `message_reply_received`

It also creates decision bands for grades:

- `low_score`
- `medium_score`
- `high_score`

For each decision it emits:

- the decision type
- the recommended action mode
- a recommendation list
- the list of next agents that should be activated

### Agent 8: Grade Intervention

File: [agent-8-grade-intervention.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/agent-8-grade-intervention.js)

Responsibility:

- interpret performance state after grading events
- diagnose whether the student needs recovery, reinforcement, or advancement
- produce a structured intervention package

This package includes:

- diagnosis
- improvement areas
- study-plan adjustment
- curated video-learning brief
- recommended downstream agents

This is the workflow’s pedagogical control layer:

- Agent 7 answers: "Did something important happen?"
- Agent 8 answers: "What support should the student receive now?"

### Agent 9: Orchestrator

File: [agent-6-orchestrator.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/agent-6-orchestrator.js)

Responsibility:

- validate runtime state
- initialize result accumulation
- execute the LangGraph workflow
- collect per-agent outputs into one orchestration response

This is not a content-producing agent in the same sense as the others. It is the graph runtime boundary that coordinates execution, order, and final assembly.

## How the Agents Communicate

The agents do not communicate through direct function-to-function chatter or ad hoc callbacks.

They communicate through shared graph state.

That communication model has two layers:

### 1. Shared immutable context

All agents receive the same `runtimeState`, which is built by [langgraph-runtime.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/lib/langgraph-runtime.js).

This file constructs:

- normalized Canvas workspace entities
- course signals such as `dueSoon`, `lowScores`, `missingAssignments`, and `newContentCandidates`
- queue and event signals
- stored preferences
- recent workflow runs
- autonomous actions
- agent registry metadata

This means every agent starts from the same worldview.

### 2. Incremental result handoff

Each node returns into `state.results`, keyed by agent id.

That means downstream agents can read `previousResults` and condition their behavior on earlier agents.

Examples:

- Agent 8 can note that it consumed Agent 7’s decision output
- Agent 2 conceptually depends on Agent 1’s grounded material
- Agent 3, Agent 5, and Agent 6 fan out after Agent 2
- Agent 4 follows Agent 3, so quiz generation can build on flashcard-level concept extraction

This pattern gives us:

- deterministic state transitions
- auditable handoffs
- one result envelope per node
- the ability to replace a scaffolded agent with a production implementation without changing graph topology

## Graph Topology

The current execution order is:

1. `orchestrator_boot`
2. `agent_7_state_change_decider`
3. `agent_8_grade_intervention`
4. `agent_1_parse_and_research`
5. `agent_2_summarize_by_preference`
6. parallel fan-out:
   - `agent_3_create_flashcards`
   - `agent_5_create_video_plan`
   - `agent_6_create_study_plan`
7. `agent_4_create_quizzes` after flashcards
8. `orchestrator_finalize`

This topology encodes a specific philosophy:

- first understand the trigger
- then understand intervention urgency
- then ground the source material
- then create a student-tailored semantic layer
- then branch into product artifacts

## Event-Driven Behavior

### When a grade is released

The flow is:

1. Agent 7 detects the grade-related decision candidate
2. Agent 8 classifies the support mode:
   - recovery
   - reinforcement
   - advance or reinforce
3. the orchestration can then route into:
   - summary refresh
   - study-plan update
   - quiz generation
   - flashcards
   - video plan

Typical behavior by score band:

- below 70
  - recovery workflow
  - concept rebuild
  - video support
  - study-plan reprioritization
- 70 to 84
  - reinforcement workflow
  - summary plus practice
  - shorter plan adjustment
- 85 and above
  - maintain mastery
  - reduce intensity
  - reallocate effort to weaker topics

### When new material is posted

The flow is:

1. Agent 7 identifies `new_material_support`
2. Agent 1 prepares the grounding step
3. Agent 2 tailors the explanation to student preferences
4. downstream assets are prepared:
   - flashcards
   - quizzes
   - video plan
   - study plan

This is the proactive support path.

The student should not need to manually request help before the system has already assembled the first learning package.

## Status Semantics

Most worker files are still scaffolded intentionally.

You will see statuses such as:

- `pending_implementation`
- `ready_for_team_implementation`
- `running`

That is by design.

The architecture is already production-structured, even where some agents still return placeholder summaries.

The important part is that the contracts, ids, handoff shape, and graph topology are already stable enough for parallel team implementation.

## File Guide

- [agent-1-parse-and-research.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/agent-1-parse-and-research.js)
- [agent-2-summarize-by-preference.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/agent-2-summarize-by-preference.js)
- [agent-3-create-flashcards.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/agent-3-create-flashcards.js)
- [agent-4-create-quizzes.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/agent-4-create-quizzes.js)
- [agent-5-create-video-plan.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/agent-5-create-video-plan.js)
- [agent-6-create-study-plan.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/agent-6-create-study-plan.js)
- [agent-7-state-change-decider.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/agent-7-state-change-decider.js)
- [agent-8-grade-intervention.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/agent-8-grade-intervention.js)
- [agent-6-orchestrator.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/agent-6-orchestrator.js)
- [contracts/runtime-state-contract.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/contracts/runtime-state-contract.js)
- [contracts/agent-result-contract.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/contracts/agent-result-contract.js)
- [index.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/agents/agentic-workflow/index.js)
- [langgraph-runtime.js](/Users/ramreddy/Documents/github/hackathons/innovationHacks3April2026/sparkling_papaya/backend/lib/langgraph-runtime.js)

## How to Run the Project

### 1. Install dependencies

From the repo root:

```bash
npm run install:backend
npm run install:frontend
```

### 2. Configure environment

Create `backend/.env` with at least:

```env
CANVAS_BASE_URL=https://canvas.asu.edu/api/v1
OPENAI_API_KEY=your_openai_api_key_here
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:3001
```

The Canvas personal access token is provided through the frontend login flow, not stored statically in the backend env by default.

### 3. Start the backend

From the repo root:

```bash
npm run dev:backend
```

Or for a non-watch start:

```bash
npm run start:backend
```

### 4. Start the frontend

In a second terminal from the repo root:

```bash
npm run dev:frontend
```

### 5. Open the app

- frontend: `http://localhost:5173`
- backend: `http://localhost:3001`

## Helpful Commands

From the repo root:

```bash
npm run build
npm run lint
```

Backend only:

```bash
npm --prefix backend run dev
npm --prefix backend run start
npm --prefix backend run mcp
```

Frontend only:

```bash
npm --prefix frontend run dev
npm --prefix frontend run build
npm --prefix frontend run lint
```

## Implementation Guidance

If you are extending this workflow, keep these rules stable:

- do not change agent ids casually; downstream consumers may depend on them
- preserve the `createAgentResult(...)` envelope shape
- prefer adding richer `outputs` and `handoff` payloads instead of inventing parallel response formats
- treat `runtimeState` as the system of record
- treat `previousResults` as the dependency channel between agents
- keep orchestration logic in the graph, not hidden inside individual worker files

That separation is what allows the project to scale from scaffolded workers to a genuinely stateful multi-agent system.
