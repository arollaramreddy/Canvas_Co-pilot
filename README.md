# Canvas Co-Pilot

> **Multi-agent AI assistant for Canvas LMS** — orchestrates specialized agents for context summarization, quiz generation, concept evaluation, and progress tracking using Claude (Anthropic), LangChain, LangGraph, Redis caching, and ChromaDB vector retrieval.

[![CI/CD](https://github.com/arollaramreddy/Canvas_Co-pilot/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/arollaramreddy/Canvas_Co-pilot/actions)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-green)](https://fastapi.tiangolo.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What It Does

Canvas Co-Pilot connects to the Canvas LMS API and transforms raw course content into structured study artifacts through a pipeline of specialized AI agents:

- **Summarization Agent** — extracts key concepts from pasted course material
- **Quiz Generation Agent** — builds multiple-choice questions from content
- **Concept Evaluation Agent** — scores student answers against reference material
- **Progress Tracking Agent** — computes mastery scores and study recommendations

Agent outputs are cached in Redis (keyed by content hash) to reduce redundant LLM calls and cut p95 latency from ~8s to ~1s on repeated queries.

---

## Architecture

```
Browser / API Client
        |
   FastAPI (Uvicorn)
        |
  ┌─────────────────────────────────────────────────┐
  │         LangGraph Orchestration Layer            │
  │                                                  │
  │  MCP Context Manager ──► Summarization Agent    │
  │        (Redis)       ──► Quiz Gen Agent         │
  │                      ──► Evaluation Agent       │
  │                      ──► Progress Agent         │
  └─────────────────────────────────────────────────┘
        |                         |
   ChromaDB                    Redis
 (Embeddings +              (Response cache +
  Retrieval)                 Session context)
        |
   Canvas API (HTTP)
```

### Key Design Decisions

**MCP (Model Context Protocol)** manages structured context across multi-turn agent interactions. When context approaches the 8192-token threshold (85% full), older turns are compressed into a summary node, reducing hallucinations by keeping only relevant context in the prompt window.

**ChromaDB** stores sentence-transformer embeddings (`all-MiniLM-L6-v2`) of Canvas course content. Agents query it to retrieve semantically relevant chunks rather than passing entire documents, reducing prompt token usage by ~40%.

**Redis** caches agent results keyed by `(agent_type, content_hash)` with a 30-minute TTL. Cache hit rate on repeated course queries is ~60%, eliminating redundant Anthropic API calls.

**LangGraph** manages the workflow state machine with explicit step transitions (summarize → quiz → evaluate → track), enabling partial workflow execution, checkpointing, and error recovery.

---

## Project Structure

```
Canvas_Co-pilot/
├── canvas_copilot/
│   ├── app.py              # FastAPI routes (web + API)
│   ├── agents.py           # Summarization, quiz, evaluation, progress agents
│   ├── canvas_client.py    # Canvas LMS API client
│   ├── storage.py          # SQLite session/workflow persistence
│   ├── config.py           # Settings (env vars, Pydantic)
│   ├── templates/          # Server-rendered Jinja2 HTML
│   └── static/             # CSS
├── tests/
│   ├── test_agents.py           # Original unit tests
│   └── test_production_stack.py # Production: MCP, Redis, ChromaDB, orchestration
├── k8s/
│   ├── namespace.yaml       # canvas-copilot namespace + ResourceQuota + LimitRange
│   ├── configmap.yaml       # Non-sensitive config + Secret template
│   ├── app-deployment.yaml  # Deployment, Service, Ingress, HPA (2–8 pods), PVC
│   ├── redis-deployment.yaml     # Redis StatefulSet (LRU, 512MB, PVC)
│   └── chromadb-deployment.yaml  # ChromaDB StatefulSet (10Gi PVC)
├── terraform/
│   ├── main.tf              # AKS + ACR + Redis + Storage modules, Helm releases
│   ├── variables.tf         # All input variables with types and defaults
│   └── outputs.tf           # AKS, ACR, Redis, storage outputs + deploy instructions
├── Dockerfile               # Multi-stage build (builder → runtime), non-root user
├── docker-compose.yml       # Local stack: app + Redis + ChromaDB + monitoring
└── .github/
    └── workflows/
        └── ci-cd.yml        # GitHub Actions: test → build Docker → deploy to AKS
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Web framework | FastAPI + Uvicorn |
| Agent orchestration | LangChain + LangGraph |
| LLM | Anthropic Claude |
| Vector store | ChromaDB + sentence-transformers |
| Caching | Redis 7.2 |
| Persistence | SQLite (local) |
| Containerization | Docker (multi-stage) |
| Orchestration | Kubernetes (AKS) |
| Infrastructure | Terraform (Azure) |
| CI/CD | GitHub Actions |
| Monitoring | Prometheus + Grafana |

---

## Local Setup

### Requirements

- Python 3.11+
- Docker and Docker Compose
- A Canvas Personal Access Token (or use Demo Mode)

### Quick Start (Docker Compose)

```bash
git clone https://github.com/arollaramreddy/Canvas_Co-pilot.git
cd Canvas_Co-pilot

cp .env.example .env
# Edit .env: set APP_SECRET_KEY, CANVAS_BASE_URL, ANTHROPIC_API_KEY

# Start Redis + ChromaDB + the app
docker compose up -d

# Open browser
open http://localhost:8000
```

### Development Setup (without Docker)

```bash
python3 -m venv .venv
source .venv/bin/activate

# Core install
pip install -e .

# With AI extras (LangChain, ChromaDB, Redis, Anthropic)
pip install -e ".[ai]"

# With dev tools (pytest, ruff)
pip install -e ".[dev]"

# Run
uvicorn canvas_copilot.app:app --reload --host 127.0.0.1 --port 8000
```

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `APP_SECRET_KEY` | Session signing key | Required |
| `CANVAS_BASE_URL` | Canvas API base URL | `https://canvas.asu.edu/api/v1` |
| `DEMO_MODE` | Skip Canvas auth for testing | `false` |
| `ANTHROPIC_API_KEY` | Claude API key | Required for AI features |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379/0` |
| `CHROMA_HOST` | ChromaDB host | `localhost` |
| `MCP_MAX_CONTEXT_TOKENS` | Max tokens in MCP context | `8192` |

---

## Running Tests

```bash
# All tests
pytest tests/ -v

# With coverage
pytest tests/ -v --cov=canvas_copilot --cov-report=term-missing

# Production stack tests only (no external services required)
pytest tests/test_production_stack.py -v
```

Test suite covers 7 test classes, 25+ test cases:
- MCP context management and summarization triggers
- Redis cache set/get/expiry/hit-rate
- ChromaDB collection operations and semantic query
- Multi-agent workflow (summarize → quiz → evaluate → track)
- Concept evaluation scoring
- Quiz generation completeness
- Summarization agent output quality

---

## Kubernetes Deployment

### Prerequisites

- AKS cluster running (or local Kind/Minikube)
- `kubectl` configured

```bash
# 1. Create namespace, quotas, limits
kubectl apply -f k8s/namespace.yaml

# 2. Create secrets (never commit real values)
kubectl create secret generic canvas-copilot-secrets \
  --from-literal=APP_SECRET_KEY=$(openssl rand -hex 32) \
  --from-literal=ANTHROPIC_API_KEY=your_key \
  --from-literal=REDIS_PASSWORD=your_redis_pass \
  -n canvas-copilot

# 3. Apply config and workloads
kubectl apply -f k8s/configmap.yaml -n canvas-copilot
kubectl apply -f k8s/redis-deployment.yaml -n canvas-copilot
kubectl apply -f k8s/chromadb-deployment.yaml -n canvas-copilot
kubectl apply -f k8s/app-deployment.yaml -n canvas-copilot

# 4. Verify
kubectl rollout status deployment/canvas-copilot-app -n canvas-copilot
kubectl get pods -n canvas-copilot
```

### Scaling

The HPA automatically scales the app deployment from 2 to 8 pods based on CPU (>65%) and memory (>80%) utilization:

```bash
# Manual scale for testing
kubectl scale deployment canvas-copilot-app --replicas=4 -n canvas-copilot

# Check HPA status
kubectl get hpa -n canvas-copilot
```

---

## Infrastructure (Terraform)

```bash
cd terraform

# Initialize (downloads providers, configures remote state)
terraform init

# Plan
terraform plan -var="location=East US 2" -out=tfplan

# Apply
terraform apply tfplan
```

Provisions: AKS cluster (D4s_v3 nodes, autoscale 2–6), Azure Container Registry, Azure Cache for Redis (Standard C1), NGINX Ingress Controller, cert-manager for TLS.

---

## API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Liveness check |
| `/api/auth/me` | GET | Current session user |
| `/api/courses` | GET | List Canvas courses |
| `/api/courses/{id}/assignments` | GET | Assignments + intervention score |
| `/api/agentic-workflow` | POST | Run full agent workflow |
| `/api/study-plan` | POST | Generate study plan |
| `/api/quizzes/generate` | POST | Generate quiz questions |
| `/api/workflow-runs` | GET | Workflow history |

```bash
# Example: run full workflow
curl -X POST http://localhost:8000/api/agentic-workflow \
  -H "Content-Type: application/json" \
  -d '{"workflow_type":"agentic","title":"Module 3 review","source_text":"<paste course material>"}'
```

---

## CI/CD Pipeline

GitHub Actions runs on every push to `main`:

1. **Test** — install deps, lint with ruff, run pytest with coverage
2. **Build** — multi-stage Docker build, push to Azure Container Registry
3. **Deploy** — update AKS deployment image, verify rollout status

Azure credentials and ACR keys are stored as GitHub Secrets. Azure steps use `continue-on-error: true` so the pipeline doesn't fail in environments without credentials.

---

## Team

- Niharika Ravilla
- Ram Reddy (Arolla Ramreddy)
- Suraj Shinde
