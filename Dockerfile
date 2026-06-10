# ─── Stage 1: builder ───────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl git && \
    rm -rf /var/lib/apt/lists/*

# Copy dependency files first for layer caching
COPY pyproject.toml ./
COPY canvas_copilot/__init__.py canvas_copilot/

# Install Python dependencies into a prefix
RUN pip install --upgrade pip setuptools wheel && \
    pip install --prefix=/install -e ".[ai]" --no-warn-script-location

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

# Security: run as non-root
RUN groupadd -r copilot && useradd -r -g copilot copilot

WORKDIR /app

# Runtime system deps (minimal)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl && \
    rm -rf /var/lib/apt/lists/*

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application source
COPY --chown=copilot:copilot canvas_copilot/ ./canvas_copilot/
COPY --chown=copilot:copilot pyproject.toml ./
COPY --chown=copilot:copilot .env.example ./.env.example

# Create data directory for SQLite
RUN mkdir -p /app/data && chown copilot:copilot /app/data

# Switch to non-root user
USER copilot

# Environment defaults (override at runtime)
ENV HOST=0.0.0.0 \
    PORT=8000 \
    DEMO_MODE=false \
    DATA_DIR=/app/data \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

EXPOSE 8000

# Healthcheck: ping the liveness endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "canvas_copilot.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
