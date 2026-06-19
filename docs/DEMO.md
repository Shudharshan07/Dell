# Jury Demo Script — MCP Workflow Proxy

A tight 5–7 minute walkthrough that hits every judging criterion. Practice once; every step below is verified working.

## 0. One-time setup (before judging) — < 5 min
```bash
# Windows
setup.bat            # creates venv, installs deps, builds UI, makes compiler\.env
# macOS / Linux
./setup.sh
# or, anywhere with Docker:
docker compose up --build
```
Add a `GROQ_API_KEY` to `compiler/.env` (free tier is enough). Then:
```bash
run.bat              # Windows   →  API :8000  +  MCP (SSE) :8002
./run.sh             # macOS/Linux
```
Open **http://localhost:8000**.

---

## 1. Frame the problem (30s)
> "Enterprise APIs like Dell iDRAC Redfish or OpenManage expose hundreds of endpoints. Wrapping each as an MCP tool — the FastMCP default — floods the model: a GitHub-sized spec is **845 tools / 158K tokens** of definitions before the agent does any work. The model can't choose well, and the context is gone."

## 2. Ingest an API (30s) — *Onboarding speed*
- Sidebar → **Your APIs** → upload an OpenAPI/Swagger spec (or use a pre-ingested one).
- Show it parsed N endpoints. "Under a minute to onboard any spec — OpenAPI v3 *or* Swagger 2.0."

## 3. The Workflow Proxy (90s) — *Innovation + Effectiveness (the core)*
- Sidebar → **Workflow Proxy** → pick the API → **Generate**.
- Point at the two metric cards:
  - **MCP tools: 845 → 33 (96% fewer)**
  - **Tokens: 158,751 → 12,927 (91.9% fewer)** — note the caption: *with progressive disclosure*.
- Expand a workflow → show the underlying operations (composability preserved). Set **Profile: Redfish** on a Redfish spec → workflows are renamed to operator intents: **Server Health Check, Firmware Update, Power Control, Inventory & Telemetry**.
- Use the **search box** → type "firmware" → it finds the operation on demand. "That's the trick: workflow tools stay loaded, the full catalog is fetched only when needed."

## 4. It actually runs (45s) — *Correctness*
- On a workflow, click **Run** (or the `__report__` multi-step) → real HTTP 200 + data. "Not a fat router — it executes the real call, follows redirects, and `__report__` orchestrates list→detail with data flowing between steps."

## 5. Connect a real MCP client (45s) — *Demo / MCP-compliant deliverable*
- Toolset → **MCP** tab → copy the **Claude Desktop / Cursor** config (points at `http://localhost:8002/sse`).
- "Any MCP client now sees ~30 workflow tools, not 845 endpoints."

## 6. The 1:∞ headline (90s) — *the winning moment*
- Sidebar → **Playground** → Agent mode → **Workflows** → source **🌐 All APIs (∞)**.
- Show the panel: **131 workflow tools across 5 APIs**, but the model is sent a **flat 3-tool surface** (`search_operations`, `describe_operation`, `execute_workflow`).
- Ask: *"Get the 'wis' ability score and list its skills."*
- Watch the trace: global `search_operations` finds the op **across all 5 APIs** → `execute_workflow` → HTTP 200 → correct answer. Open the **token meter**: **~3.7K tokens total.**
- The line to land:
  > "Five APIs, 1,393 endpoints — and the model sees **3 tools** and spends **constant tokens no matter how many APIs we add**. That's not 1:1. It's **1:∞**."

## 7. Cross-product composition (30s) — *Stretch*
- Mention/show the cross-product plan: a value from API A (iDRAC-style) flows into a call on API B (OME-style) — "provision on one, register on the other," one tool call.

---

## Numbers to say out loud
| | Single spec (GitHub) | All 5 APIs aggregated |
|---|---|---|
| Tools | 845 → 33 (**96%↓**) | 1,393 → 131 (**90.6%↓**) |
| Tokens | 158,751 → 12,927 (**91.9%↓**) | 251,184 → 34,146 (**86.4%↓**) |
| Sent to model (capped provider) | — | **3 tools — constant** |

Targets were ≥80% tools / ≥70% tokens. **Beaten on every axis.**

## Maps to the rubric
- **Innovation (25%)** — clustering + progressive disclosure + flat constant-token surface + intent profiles.
- **Technical Execution (25%)** — declarative multi-step plan engine (data-flow, foreach, until/polling), cross-product plans, robust ingest ($ref, Swagger 2.0).
- **Effectiveness (20%)** — the numbers above.
- **Demo/Usability (15%)** — one-command setup / Docker, copy-paste MCP config, the visual Workflow Proxy page.
- **Docs (10%)** — README, ARCHITECTURE, WORKFLOWS, this DEMO, PITCH.
- **Stretch (5%)** — multi-API composition, intent profiles, hierarchical/progressive disclosure, observability UI.

## Closing line
> "We don't shrink the tool list — we turn any sprawling API, or any number of APIs, into the handful of workflows an operator would actually run, at a token cost that stays flat as you scale. One MCP server. Infinite APIs."
