# MCP Workflow Proxy

**Turn any enterprise OpenAPI spec into a small set of workflow-level MCP tools an agent can actually reason about — instead of 100–500+ raw endpoints that blow the context window.**

---

## The problem: tool explosion / context overload

Modern enterprise APIs are huge. The iDRAC Redfish surface and OpenManage Enterprise (OME) expose hundreds of fine-grained endpoints — one operation per resource, per action, per sub-collection. When you naively turn each endpoint into an MCP tool, an agent is handed a flat catalog of hundreds of tools and *tens of thousands of tokens of tool definitions before it has read a single byte of the user's request.*

That has two costs:

1. **Context overload** — tool definitions alone can consume 50k–150k+ tokens, crowding out the actual task, increasing latency and cost, and degrading tool-selection accuracy.
2. **No intent.** "Reset this server", "check firmware", "is the chassis healthy?" are *workflows*, not endpoints. A flat `GET /redfish/v1/Systems/{id}/...` list doesn't map to what an operator actually wants to do.

> Anthropic's own ["Code execution with MCP"](https://www.anthropic.com/engineering/code-execution-with-mcp) writeup makes the same point: loading every tool definition up front is the dominant token cost, and progressive, on-demand disclosure is the fix.

## What it does

The Workflow Proxy ingests an OpenAPI v3 or Swagger 2.0 spec and **clusters its endpoints into coarse, workflow-level tools** (~10–30 instead of hundreds). Each workflow tool:

- exposes a single `operation` selector plus generic `path_params` / `query_params` / `body`, collapsing N endpoints into 1 tool;
- ships with a **deferred catalog** (progressive disclosure) so the per-tool description is O(1), not O(operations);
- can run a **multi-step plan** (`__report__`: list a collection → fetch each item's detail) with real data flow between steps;
- can be served straight to an MCP client (Claude Desktop, Cursor) over SSE.

A built-in **Redfish/iDRAC profile** renames clusters to operator intents — *Power Control, Firmware Update, Inventory & Telemetry, Server Health Check* — instead of raw path segments.

Beyond static clustering, the proxy **builds workflows itself**: it synthesizes multi-step plans from the API's structure (list→detail, create→fetch, submit→poll, deep-inventory) and can **AI-discover** spec-tailored workflows on demand (each validated against the spec). In the Agent Playground, a **chat auto-router** then assigns only the ~3 task-relevant workflows per message — so token cost scales with the *task*, not the API surface, and the **same surface fronts all ingested APIs at once (1:∞)**.

## Architecture at a glance

```
        ┌─────────────────────────────────────────────────┐
        │  React UI (Vite)                                  │
        │  Ingest · Toolsets · Workflow Proxy · DAG ·       │
        │  Playground (⚡ auto-route) · Environments · MCP · │
        │  SDK · Prompts · Custom Tools                     │
        └───────────────┬─────────────────────────────────┘
                        │ HTTP (8000)
        ┌───────────────▼─────────────────────────────────┐
        │  FastAPI  (compiler/main.py)                      │
        │  ingest · proxy · workflows · agent · resources   │
        │  (clustering · synthesis · AI discover · router)  │
        │             │                                     │
        │             ▼                                     │
        │   local_storage.json  (sources, workflow_defs,    │
        │     toolsets, plans, environments, creds)         │
        └───────────────┬─────────────────────────────────┘
                        │
        ┌───────────────▼─────────────────────────────────┐
        │  FastMCP server  (app/mcp_server.py)  :8002/sse   │
        │  workflow tools + search_operations/describe      │
        └───────────────┬─────────────────────────────────┘
                        │ /workflows/execute → /proxy/call (active env override)
                        ▼
                 Downstream API (iDRAC / OME / any OpenAPI)
```

## Quickstart

**Prereqs:** Python 3.10–3.13, Node 18+. One command sets everything up (creates the venv, installs backend deps incl. FastMCP, builds the UI, scaffolds `compiler/.env`):

```bat
:: Windows — from the repo root (Dell\)
setup.bat   &&  run.bat
```
```bash
# macOS / Linux
./setup.sh  &&  ./run.sh
```
```bash
# Any environment, via Docker (Python 3.12 base)
docker compose up --build
```

`run` launches two services:

| Service        | URL                            | Notes                                  |
|----------------|--------------------------------|----------------------------------------|
| FastAPI + UI   | `http://localhost:8000`        | API + the built React app              |
| MCP (SSE)      | `http://localhost:8002/sse`    | FastMCP server for MCP clients         |

**API keys (optional, for the Agent Playground):** create `compiler/.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
GROQ_API_KEY=gsk_...
OLLAMA_BASE_URL=http://localhost:11434
```

The playground works with Claude (Anthropic), Groq, or a local Ollama — whichever key/host is present. Everything else (ingest, cluster, proxy, MCP) needs **no API key**.

## 90-second demo script

1. **Ingest a spec.** `http://localhost:8000` → **Your APIs** → upload `test_specs/V3/redfish_mock_1.0_openapi.yaml` (or any spec in `test_specs/V2`/`V3`). Every endpoint becomes a source.
2. **Workflow Proxy → Generate Dynamic Workflows.** One click clusters the endpoints, **synthesizes multi-step plans** (list→detail, create→fetch, submit→poll, deep-inventory), and **AI-discovers** spec-tailored workflows. The Redfish profile names them *Power Control / Firmware Update / Inventory & Telemetry / Server Health Check*.
3. **Show the metric cards** — raw vs workflow tool count, and raw vs deferred tokens (progressive disclosure). Expand a workflow → its operations + auto/AI plans, each with **Run**.
4. **The headline — auto-routing.** Playground (already on **⚡ Auto (task-routed)**) → ask *"check the wisdom stats."* The trace shows it **routed to ~3 of 131 workflows across 5 APIs**, sent the model **~5 tools / ~4K tokens**, called the right one, HTTP 200. Then flip to **Toolset** mode to show the ~166K raw-mode contrast. *"Tools scale to the task, not the API surface."*
5. **Functional pages.** **Environments** → activate one and watch the proxy re-route (base-url + auth at call time). **MCP** → live status + Claude/Cursor/Windsurf configs. **Custom Tools** → compose and **Run** a multi-step tool.
6. **Connect a real MCP client.** Point Claude Desktop / Cursor at `http://localhost:8002/sse` (snippets below) — your agent now sees workflow tools, not raw endpoints.

## Verified metrics

| Spec    | Endpoints | Workflow tools | Tool reduction | Raw tokens | Clustered (inline) | Progressive disclosure |
|---------|-----------|----------------|----------------|------------|--------------------|------------------------|
| GitHub  | 845       | 33             | **96.1%**      | 158,751    | 20,288 (87.2%)     | **12,927 (91.9%)**     |
| Stripe  | 452       | 60             | **86.7%**      | 83,060     | 24,479 (70.5%)     | —                      |

Acceptance targets were **≥80% tool reduction** and **≥70% token reduction** — both beaten. Ingestion was validated across **15 mixed V2/V3 specs**, including the 8.6 MB GitHub and 3.6 MB Stripe specs. (Token counts use a chars/4 heuristic over the serialized tool definitions; see `compute_metrics` in `compiler/app/workflows.py`.)

### 1:∞ — many APIs, flat token cost

The agent (and MCP server) can front **all ingested APIs at once** — not 1:1, but **1:∞**. Aggregated across **5 APIs / 1,393 endpoints**:

| | Aggregate (5 APIs) |
|---|---|
| Tools | 1,393 → **131** (90.6% ↓) |
| Tool-definition tokens | 251,184 → **34,146** (86.4% ↓) |
| **Tools actually sent to the model** | **3 — constant, regardless of how many APIs you add** |

When a provider caps tools per request, the proxy serves a **flat 3-tool surface** (`search_operations` · `describe_operation` · `execute_workflow`) backed by the full registry, so adding the 6th or 60th API doesn't grow the sent-token cost. See `GET /api/v1/workflows/metrics-all`.

## Connecting an MCP client

Point any MCP client at the SSE endpoint. **Cursor** (`~/.cursor/mcp.json` or project `.cursor/mcp.json`):

```json
{ "mcpServers": { "workflow-proxy": { "url": "http://localhost:8002/sse" } } }
```

**Claude Desktop** (via the `mcp-remote` bridge, since Desktop speaks stdio):

```json
{
  "mcpServers": {
    "workflow-proxy": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:8002/sse"]
    }
  }
}
```

The UI also generates these exact snippets per-toolset (`GET /api/v1/toolsets/{id}/mcp-config`).

## Key features

- **Rule-based clustering** by OpenAPI `tag` → first meaningful path segment. Deterministic, no LLM at runtime.
- **Progressive disclosure** — `search_operations` / `describe_operation` MCP tools let the agent discover specifics on demand; the biggest token win.
- **1:∞ multi-API** — one MCP/agent surface spanning *all* ingested APIs (namespaced per source) with a global cross-API search and a constant 3-tool sent surface; plus cross-product plans that thread data from one API into another.
- **Chat auto-workflow router** — per message, a deterministic ranker picks the top ~3 task-relevant workflows, so the agent is handed ~5 tools tailored to *that task* (≈89% fewer tool-definition tokens than sending the full set). Default Playground mode (`⚡ Auto (task-routed)`).
- **Dynamic workflow discovery** — *Generate Dynamic Workflows* clusters + synthesizes multi-step plans (list→detail, create→fetch, submit→poll, deep-inventory) and optionally AI-discovers spec-tailored workflows, each validated against the spec.
- **Functional resource pages** — Environments actually re-route the proxy (base-url + auth injected at call time); a live MCP status dashboard; a downloadable SDK client; prompt templates with `{{variable}}` detection; and composable, **runnable** custom tools (executed via the plan engine).
- **Declarative multi-step plan engine** — selectors (`$last`, `$steps.<i>`, `item`, `*`), `foreach`, and `until` polling, with hard caps.
- **Intent profiles** — built-in Redfish/iDRAC profile maps operations to operator intents.
- **Multi-provider Agent Playground** — Claude / Groq / Ollama, with a live token + tool-call trace over SSE.
- **Robust ingestion** — `$ref` resolution, path-item-level shared params, Swagger 2.0 `host`+`basePath` base-url derivation, tags.
- **Companion resources** — environments, prompts, custom tools, generated MCP config + SDK snippets (Python/TS/curl).

## Tech stack

- **Backend:** Python, FastAPI, httpx, PyYAML, networkx (DAG view), [FastMCP](https://gofastmcp.com) (SSE transport).
- **Frontend:** React + Vite, Tailwind, shadcn/ui, lucide icons.
- **Protocol:** [Model Context Protocol](https://spec.modelcontextprotocol.io).
- **Storage:** a single local JSON file (`compiler/local_storage.json`) — zero infra.

## Repo layout

```
Dell/
├─ setup.bat / setup.sh          # one-command setup (venv + deps + UI build + .env)
├─ run.bat  / run.sh             # launch API (8000) and MCP (8002)
├─ Dockerfile / docker-compose.yml   # run the whole stack anywhere
├─ compiler/
│  ├─ main.py                    # FastAPI app, routers, DAG endpoints, static serving
│  ├─ app/
│  │  ├─ ingest.py               # OpenAPI/Swagger parse, $ref, shared params, toolsets
│  │  ├─ proxy.py                # downstream executor (active-env override, redirects)
│  │  ├─ workflows.py            # clustering, profiles, metrics, plan engine, synth +   ← core
│  │  │                          #   AI discovery, multi-API, auto-router
│  │  ├─ mcp_server.py           # FastMCP SSE server, workflow + search/describe tools
│  │  ├─ agent.py                # multi-provider playground (Claude/Groq/Ollama) + auto-route
│  │  ├─ resources.py            # environments(+proxy wiring)/prompts/custom-tools, mcp-status, SDK
│  │  └─ storage.py              # local_storage.json read/write
│  ├─ requirements.txt           # incl. fastmcp
│  └─ .env.example
├─ frontend/src/
│  ├─ App.jsx
│  └─ components/                # workflow-view · dag-viewer · ingestion-wizard ·
│                                #   toolset-manager · agent-playground · toolset-extras ·
│                                #   environments-page · mcp-page · sdk-page ·
│                                #   prompts-page · custom-tools-page · resource-page
├─ docs/                         # ARCHITECTURE.md · WORKFLOWS.md · PITCH.md · DEMO.md
└─ test_specs/{V2,V3}/           # Swagger 2.0 + OpenAPI 3 specs, incl. redfish_mock
```

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — components, data flows, clustering & plan-engine design, trade-offs.
- [`docs/WORKFLOWS.md`](docs/WORKFLOWS.md) — endpoint→workflow mapping, plan spec, Redfish profile table, before/after.
- [`docs/PITCH.md`](docs/PITCH.md) — slide-by-slide deck and evaluation-criteria mapping.
- [`docs/DEMO.md`](docs/DEMO.md) — step-by-step jury demo script with the exact numbers to call out.
