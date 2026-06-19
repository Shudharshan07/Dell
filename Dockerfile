# ── MCP Workflow Proxy — single-image build (any environment) ─────────────────
# Stage 1: build the React frontend (vite emits into compiler/static)
FROM node:20-slim AS frontend
WORKDIR /app
COPY frontend/ ./frontend/
COPY compiler/ ./compiler/
WORKDIR /app/frontend
RUN npm install && npm run build

# Stage 2: Python backend + MCP server
FROM python:3.12-slim
WORKDIR /app/compiler
RUN apt-get update && apt-get install -y --no-install-recommends bash \
    && rm -rf /var/lib/apt/lists/*
COPY compiler/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY compiler/ ./
# built UI from stage 1 + sample specs for the DAG viewer
COPY --from=frontend /app/compiler/static ./static
COPY test_specs/ /app/test_specs/
EXPOSE 8000 8002
CMD ["bash", "start.sh"]
