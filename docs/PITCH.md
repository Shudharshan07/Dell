# Pitch deck — MCP Workflow Proxy

A slide-by-slide outline (~10 slides). Speaker notes in italics.

---

## Slide 1 — Title

# MCP Workflow Proxy
### Turn enterprise OpenAPI specs into workflow-level MCP tools an agent can actually reason about.

*Dell hackathon submission. Built for iDRAC Redfish / OpenManage Enterprise — works on any OpenAPI v3 or Swagger 2.0 spec.*

---

## Slide 2 — The problem: tool explosion / context overload

- Enterprise APIs are massive: iDRAC Redfish and OME expose **hundreds** of fine-grained endpoints.
- Naive MCP = one tool per endpoint → an agent gets a flat catalog of hundreds of tools and **50k–150k+ tokens of definitions before reading the task.**
- Two failure modes: **context overload** (cost, latency, worse tool selection) and **no intent** — "reset this server" is a workflow, not a `POST /…/ComputerSystem.Reset`.

> *Verified baseline: the GitHub spec alone is 845 endpoints / 158,751 tokens of tool definitions. That doesn't fit a sane agent budget.*

---

## Slide 3 — The insight

- Operators think in **workflows** (Power, Firmware, Inventory, Health), not endpoints.
- Don't front-load every tool definition — **cluster** to intent, and **disclose detail on demand**.
- This is exactly Anthropic's "code execution with MCP" lesson: tool-definition load is the dominant cost; progressive disclosure is the fix. We apply it at the proxy layer, deterministically, with no LLM at generate-time.

---

## Slide 4 — The solution / architecture

- **Ingest** any OpenAPI/Swagger spec → flatten endpoints.
- **Cluster** by tag → path segment, or by an **intent profile** (Redfish).
- **Serve** ~10–30 coarse workflow tools over **MCP SSE** to Claude Desktop / Cursor.

```
React UI ─► FastAPI (ingest · cluster · proxy) ─► local_storage.json
                          │
            FastMCP (:8002/sse) ─► /workflows/execute ─► proxy ─► downstream API
            + search_operations / describe_operation  (progressive disclosure)
```

*Three layers, one JSON file of state, zero infra. The MCP server is a thin client of the FastAPI core, so clustering/execution has a single source of truth.*

---

## Slide 5 — Live demo flow

1. Ingest `redfish_mock_1.0_openapi.yaml` (or GitHub/Stripe).
2. Workflow Proxy page → **Generate** → four intent workflows appear.
3. Point at the **metrics cards**: tool count and token count drop.
4. **Run** a `GET` op, then **Run `__report__`** → watch the multi-step list→detail orchestration return aggregated data (live, keyless, on the D&D API).
5. Connect **Cursor/Claude Desktop** to `http://localhost:8002/sse` and call the same tools from an agent.

*Everything but the playground needs no API key.*

---

## Slide 6 — Results

| Spec   | Endpoints | Workflow tools | Tool ↓ | Raw tokens | Clustered | Progressive disclosure |
|--------|-----------|----------------|--------|------------|-----------|------------------------|
| GitHub | 845       | 33             | **96.1%** | 158,751 | 20,288 (87.2%) | **12,927 (91.9%)** |
| Stripe | 452       | 60             | **86.7%** | 83,060  | 24,479 (70.5%) | — |

**The layered token story:** clustering takes GitHub from 158,751 → 20,288 tokens (**87.2%**). Progressive disclosure then strips the per-tool catalog, taking it to **12,927 (91.9%)**. Two compounding levers.

*Acceptance targets — ≥80% tool reduction, ≥70% token reduction — both beaten. Ingestion validated across 15 mixed V2/V3 specs incl. 8.6 MB GitHub and 3.6 MB Stripe.*

---

## Slide 7 — Innovation

- **Progressive disclosure** — `search_operations` / `describe_operation` MCP tools; per-tool description goes from O(operations) to O(1).
- **Declarative plan engine** — selectors (`$last`, `$steps.<i>`, `item`, `*`), `foreach`, `until` polling, hard caps. Verified live (list → foreach → detail; plus polling).
- **Intent profiles** — Redfish/iDRAC profile renames clusters to operator intents via ordered regex.
- **Multi-provider playground** — Claude / Groq / Ollama, live token + tool-call trace over SSE.

---

## Slide 8 — How it maps to the 6 evaluation criteria

| Criterion | What we deliver |
|---|---|
| **Innovation** | Workflow-level clustering + progressive disclosure applied at the MCP proxy layer; deterministic, no runtime LLM; declarative plan engine with selectors/foreach/until; pluggable intent profiles. |
| **Execution** | Working end-to-end: FastAPI core + FastMCP SSE server + React UI; robust ingestion ($ref, shared params, Swagger 2.0 base-url) validated on 15 specs up to 8.6 MB; one-command `run.bat`. |
| **Effectiveness** | Beats both targets — 96.1% / 86.7% tool reduction, 91.9% / 70.5% token reduction — measured by `compute_metrics`, surfaced live in the UI. |
| **Demo** | 60-second flow: ingest → Generate → metrics → run `__report__` → connect an MCP client. Live keyless run on the D&D API. |
| **Docs** | README + ARCHITECTURE + WORKFLOWS + this deck, all grounded in the actual code, with diagrams, tables, and a concrete before/after. |
| **Stretch** | Intent profiles, multi-step plan engine, multi-provider agent playground, generated MCP-client config + SDK snippets, DAG dependency viewer. |

---

## Slide 9 — Stretch goals achieved

- ✅ Domain **intent profiles** (Redfish) with auto-detection and forced override.
- ✅ **Declarative multi-step plan engine** with data flow, iteration, and polling — verified live.
- ✅ **Progressive disclosure** search/describe tools wired into the MCP server.
- ✅ **Multi-provider** agent playground (Claude / Groq / Ollama) with streamed traces.
- ✅ Generated **MCP-client config** (Claude Desktop + Cursor) and **SDK snippets** (Python/TS/curl).
- ✅ **DAG viewer** of endpoint dependencies.

---

## Slide 10 — Ask / close

**Ask:** point your MCP client at `http://localhost:8002/sse` and let an agent operate Dell infrastructure through four intent tools instead of hundreds of endpoints.

### Winning narrative

> Enterprise APIs like iDRAC Redfish and OpenManage Enterprise expose hundreds of fine-grained endpoints — and naively wiring them into an agent buries it under 150k+ tokens of tool definitions before it reads a single request. The MCP Workflow Proxy fixes this at the source: it ingests any OpenAPI v3 or Swagger 2.0 spec, deterministically clusters endpoints into a handful of workflow-level tools (renamed to operator intents like *Power Control* and *Firmware Update* for Dell hardware), and serves them over MCP with progressive disclosure so detail is fetched only on demand. The result is measured, not aspirational — **845 endpoints become 33 tools (96.1% fewer) and 158,751 tokens become 12,927 (91.9% fewer)** — beating both acceptance targets, validated across 15 specs up to 8.6 MB, with a live multi-step plan engine and a ready-to-connect Claude Desktop / Cursor integration. It makes large enterprise APIs *agent-operable*.

---

*References: MCP spec (spec.modelcontextprotocol.io) · FastMCP (gofastmcp.com) · Redfish DSP0266 (dmtf.org) · iDRAC/OME (developer.dell.com) · Anthropic "Code execution with MCP".*
