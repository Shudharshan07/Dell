"""
Workflow Proxy — the core of the MCP Workflow Proxy.

Transforms an ingested OpenAPI spec's flat list of 100-500+ endpoints into a small
set of coarse-grained, workflow-level tools (~10-30) suitable for an MCP server.

Strategy (rule-based, deterministic, no LLM required at runtime):
  1. Cluster endpoints by OpenAPI `tag` (the API designer's own grouping) when
     present, else by the first meaningful path segment.
  2. Each cluster becomes ONE workflow tool exposing an `operation` selector plus
     generic path/query/body params — collapsing N endpoints into 1 tool.
  3. Within a cluster, detect collection+item pairs and synthesize a multi-step
     "__report__" operation that lists a collection then fetches item details
     (real orchestration with data flow).

This yields a large reduction in tool count AND in tool-definition tokens, which is
the whole point: one compact tool per capability instead of one per endpoint.
"""
import re
import json
import math
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.storage import load_storage, save_storage
from app.proxy import ProxyCallRequest, proxy_call

router = APIRouter(prefix="/api/v1/workflows")

# path segments that carry no grouping meaning
_SKIP_SEGMENTS = {"api", "rest", "redfish", "public", "service", "services", "v1", "v2",
                  "v3", "v4", "v1.0", "v2.0", "beta", "latest", "1.0", "2.0"}


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(s).lower()).strip("_") or "general"


def _tokens(text: str) -> int:
    return math.ceil(len(text) / 4)  # rough chars/4 heuristic


def _jtype(t: str) -> str:
    return {"string": "string", "integer": "integer", "number": "number",
            "boolean": "boolean", "array": "array", "object": "object"}.get(str(t).lower(), "string")


def _cluster_key(tool: dict) -> str:
    tags = tool.get("tags") or []
    if tags:
        return _slug(tags[0])
    segs = [s for s in str(tool.get("path", "")).split("/") if s and not s.startswith("{")]
    segs = [s for s in segs if s.lower() not in _SKIP_SEGMENTS]
    return _slug(segs[0]) if segs else "general"


def _param_names(tool: dict) -> list[str]:
    out = []
    for p in tool.get("parameters", []) or []:
        if isinstance(p, dict) and p.get("name"):
            out.append(p["name"])
        elif isinstance(p, str):
            out.append(p)
    return out


def _endpoint_input_schema(tool: dict) -> dict:
    """Full 1:1 schema for an endpoint (used only for the raw-baseline token count)."""
    props: dict[str, Any] = {}
    required: list[str] = []
    for p in tool.get("parameters", []) or []:
        if isinstance(p, dict) and p.get("name"):
            loc = p.get("in", "query")
            if loc == "body":
                props["body"] = {"type": "object", "description": "request body"}
                continue
            sch = p.get("schema") or {}
            props[p["name"]] = {
                "type": _jtype(sch.get("type") or p.get("type") or "string"),
                "description": (p.get("description") or f"{loc} parameter")[:300],
            }
            if p.get("required"):
                required.append(p["name"])
    if tool.get("request_body"):
        props.setdefault("body", {"type": "object", "description": "request body"})
    return {"type": "object", "properties": props, "required": required}


# ---------------------------------------------------------------------------
# Enhancement 3 — declarative domain profiles (intent-named workflows)
# ---------------------------------------------------------------------------
# A profile maps intent-named workflows to operation-matching patterns (regex
# over path/operationId). Each matched group becomes ONE intent-named workflow.
# An operation matches the FIRST profile workflow whose pattern hits; anything
# unmatched falls back to generic tag/path clustering.

# Built-in Redfish / iDRAC profile. Patterns are case-insensitive regexes
# evaluated against "<METHOD> <path>  <operationId>".
REDFISH_PROFILE = {
    "name": "Redfish",
    "detect": r"/redfish/v1",
    # NOTE: order matters — an operation is placed in the FIRST workflow whose
    # pattern matches. Specific intents (Power, Firmware, Inventory) are listed
    # BEFORE the broad Server Health Check so e.g. a /Systems/.../Reset action is
    # claimed by Power Control rather than swept into the generic health bucket.
    "workflows": [
        {"id": "wf_power_control", "name": "Power Control",
         "patterns": [r"ComputerSystem\.Reset", r"/Actions/.*Reset", r"PowerControl",
                      r"\.Reset"]},
        {"id": "wf_firmware_update", "name": "Firmware Update",
         "patterns": [r"UpdateService", r"SimpleUpdate", r"FirmwareInventory",
                      r"/TaskService", r"/Tasks(/|$)"]},
        {"id": "wf_inventory_telemetry", "name": "Inventory & Telemetry",
         "patterns": [r"/Processors", r"/Memory", r"/Storage", r"/EthernetInterfaces",
                      r"/NetworkInterfaces", r"/Drives", r"/SimpleStorage",
                      r"TelemetryService", r"/MetricReports"]},
        {"id": "wf_server_health_check", "name": "Server Health Check",
         "patterns": [r"/Systems(/|$)", r"/Chassis(/|$)", r"/Managers(/|$)",
                      r"/Thermal", r"/Power(?!Control)", r"Status"]},
    ],
}

_BUILTIN_PROFILES = {"redfish": REDFISH_PROFILE}


def _op_match_text(op: dict) -> str:
    return f"{op.get('method', 'GET')} {op.get('path', '')}  {op.get('operation_id', '')}"


def _detect_profile(tools: list[dict]) -> dict | None:
    """Auto-detect a built-in domain profile by scanning operation paths."""
    for prof in _BUILTIN_PROFILES.values():
        rx = re.compile(prof["detect"], re.IGNORECASE)
        if any(rx.search(t.get("path", "") or "") for t in tools):
            return prof
    return None


def _build_workflow_from_ops(wf_id: str, name: str, ops: list[dict]) -> dict:
    operations = []
    has_collection = has_item = False
    for op in sorted(ops, key=lambda o: (o.get("path", ""), o.get("method", ""))):
        path = op.get("path", "/")
        operations.append({
            "operation_id": op.get("operation_id"),
            "method": op.get("method", "GET"),
            "path": path,
            "summary": (op.get("summary") or op.get("name") or "")[:120],
            "params": _param_names(op),
        })
        if op.get("method") == "GET":
            if "{" in path:
                has_item = True
            else:
                has_collection = True
    verbs = sorted({o["method"] for o in operations})
    return {
        "id": wf_id,
        "name": name,
        "cluster": wf_id.replace("wf_", ""),
        "description": (
            f"{name}: {len(operations)} operations ({', '.join(verbs)}). "
            f"Pick an 'operation' and pass any path/query/body params."
        ),
        "operations": operations,
        "report": has_collection and has_item,
    }


def _cluster_with_profile(tools: list[dict], profile: dict) -> tuple[list[dict], list[dict]]:
    """Assign each operation to the first matching profile workflow.
    Returns (intent_workflows, leftover_tools)."""
    compiled = [
        (wf, [re.compile(p, re.IGNORECASE) for p in wf["patterns"]])
        for wf in profile["workflows"]
    ]
    buckets: dict[str, list[dict]] = {wf["id"]: [] for wf in profile["workflows"]}
    leftover: list[dict] = []
    for t in tools:
        text = _op_match_text(t)
        placed = False
        for wf, rxs in compiled:
            if any(rx.search(text) for rx in rxs):
                buckets[wf["id"]].append(t)
                placed = True
                break
        if not placed:
            leftover.append(t)
    intent_workflows = []
    for wf in profile["workflows"]:
        ops = buckets[wf["id"]]
        if ops:
            built = _build_workflow_from_ops(wf["id"], wf["name"], ops)
            built["profile"] = profile["name"]
            intent_workflows.append(built)
    return intent_workflows, leftover


def cluster_source(source: dict, profile: str | None = "auto") -> list[dict]:
    """Return a list of workflow definitions for an ingested source.

    profile:
      - "auto" (default): auto-detect a built-in domain profile (e.g. Redfish);
        fall back to generic tag/path clustering for the whole source and for
        any operations the profile doesn't match.
      - "<name>": force a named built-in profile.
      - None: disable profiles entirely (pure generic clustering).
    """
    tools = list((source.get("tools") or {}).values())

    # ---- Enhancement 3: domain-profile pass ----
    selected_profile = None
    if profile == "auto":
        selected_profile = _detect_profile(tools)
    elif profile:
        selected_profile = _BUILTIN_PROFILES.get(profile.lower())

    intent_workflows: list[dict] = []
    if selected_profile:
        intent_workflows, tools = _cluster_with_profile(tools, selected_profile)

    # ---- generic clustering for whatever is left (or everything if no profile) ----
    clusters: dict[str, list[dict]] = {}
    for t in tools:
        clusters.setdefault(_cluster_key(t), []).append(t)

    workflows = list(intent_workflows)
    for key, ops in sorted(clusters.items()):
        operations = []
        has_collection = has_item = False
        for op in sorted(ops, key=lambda o: (o.get("path", ""), o.get("method", ""))):
            path = op.get("path", "/")
            operations.append({
                "operation_id": op.get("operation_id"),
                "method": op.get("method", "GET"),
                "path": path,
                "summary": (op.get("summary") or op.get("name") or "")[:120],
                "params": _param_names(op),
            })
            if op.get("method") == "GET":
                if "{" in path:
                    has_item = True
                else:
                    has_collection = True

        # human-friendly title from the cluster key
        title = key.replace("_", " ").title()
        verbs = sorted({o["method"] for o in operations})
        workflow = {
            "id": f"wf_{key}",
            "name": f"{title} Workflow",
            "cluster": key,
            "description": (
                f"{title}: {len(operations)} operations ({', '.join(verbs)}). "
                f"Pick an 'operation' and pass any path/query/body params."
            ),
            "operations": operations,
            "report": has_collection and has_item,  # multi-step orchestration available
        }
        workflows.append(workflow)
    return workflows


def workflow_tool_schema(wf: dict, defer_catalog: bool = False) -> dict:
    """Compact coarse-grained MCP/LLM tool definition for a workflow.

    When ``defer_catalog`` is True (progressive-disclosure mode), the full
    operation catalog is NOT embedded in the description. Instead the agent gets
    a short verb summary + op count and is told to use ``search_operations`` /
    ``describe_operation`` to discover specifics on demand. This is the biggest
    token win: the per-tool description shrinks from O(operations) to O(1).
    """
    op_ids = [o["operation_id"] for o in wf["operations"]]
    plan_ops = [f"plan:{p['name']}" for p in (wf.get("plans") or [])]
    if wf.get("report"):
        op_ids = ["__report__"] + op_ids
    # synthesized/AI plans are runnable as operation values too (still compact)
    op_ids = op_ids + plan_ops

    if defer_catalog:
        verbs = sorted({o["method"] for o in wf["operations"]})
        plan_note = (
            f" Includes {len(plan_ops)} synthesized multi-step plan(s) runnable as "
            f"operation 'plan:<name>'." if plan_ops else ""
        )
        report_note = (
            " Includes a '__report__' multi-step orchestration." if wf.get("report") else ""
        ) + plan_note
        description = (
            f"{wf['name']}: {len(wf['operations'])} operations ({', '.join(verbs)})."
            f"{report_note} Use search_operations(query) to find a specific operation "
            f"and describe_operation(operation_id) for its full input schema, then pass "
            f"that operation_id as 'operation'."
        )
    else:
        # operation catalog goes in the description (cheap) instead of N full schemas
        catalog_lines = []
        if wf.get("report"):
            catalog_lines.append("  - __report__: list the collection then fetch item details (aggregated)")
        for o in wf["operations"][:40]:
            p = f" params: {', '.join(o['params'])}" if o["params"] else ""
            catalog_lines.append(f"  - {o['operation_id']}: {o['method']} {o['path']}{p}")
        description = wf["description"] + "\nOperations:\n" + "\n".join(catalog_lines)
    return {
        "name": wf["id"],
        "description": description,
        "input_schema": {
            "type": "object",
            "properties": {
                "operation": {"type": "string", "enum": op_ids, "description": "Operation to run"},
                "path_params": {"type": "object", "description": "Path parameter substitutions"},
                "query_params": {"type": "object", "description": "Query string parameters"},
                "body": {"type": "object", "description": "Request body for write operations"},
            },
            "required": ["operation"],
        },
    }


# ---------------------------------------------------------------------------
# Metrics: raw 1:1 vs workflow-level
# ---------------------------------------------------------------------------
def compute_metrics(source: dict, workflows: list[dict]) -> dict:
    tools = list((source.get("tools") or {}).values())
    raw_defs = [
        {"name": t.get("operation_id"), "description": (t.get("description") or "")[:400],
         "input_schema": _endpoint_input_schema(t)}
        for t in tools
    ]
    wf_defs_inline = [workflow_tool_schema(w, defer_catalog=False) for w in workflows]
    wf_defs_deferred = [workflow_tool_schema(w, defer_catalog=True) for w in workflows]
    raw_tokens = _tokens(json.dumps(raw_defs))
    wf_tokens = _tokens(json.dumps(wf_defs_inline))
    wf_tokens_deferred = _tokens(json.dumps(wf_defs_deferred))
    raw_n = len(raw_defs) or 1
    raw_t = raw_tokens or 1
    synthesized_plan_count = sum(len(w.get("plans") or []) for w in workflows)
    return {
        "raw_tool_count": len(raw_defs),
        "workflow_tool_count": len(wf_defs_inline),
        "synthesized_plan_count": synthesized_plan_count,
        "tool_reduction_pct": round((1 - len(wf_defs_inline) / raw_n) * 100, 1),
        "raw_tokens": raw_tokens,
        "workflow_tokens": wf_tokens,                       # backward-compatible alias (inline)
        "workflow_tokens_inline": wf_tokens,                # full catalog in description
        "workflow_tokens_deferred": wf_tokens_deferred,     # progressive disclosure
        "token_reduction_pct": round((1 - wf_tokens / raw_t) * 100, 1),
        "deferred_token_reduction_pct": round((1 - wf_tokens_deferred / raw_t) * 100, 1),
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
def _get_source(storage: dict, source_id: str) -> dict:
    src = (storage.get("sources") or {}).get(source_id)
    if not src:
        raise HTTPException(status_code=404, detail=f"Source '{source_id}' not found.")
    return src


@router.post("/generate")
async def generate_workflows(source_id: str = Query(...), profile: str = Query("auto"),
                             discover: bool = Query(False),
                             provider: str = Query("groq"), model: str = Query("")):
    """Generate workflow tools TAILORED to an ingested spec in one click.

    Always: cluster -> synthesize deterministic multi-step plans. When
    `discover=true` AND a provider key is present, ALSO runs AI workflow discovery
    (`/discover`) and folds the result in, so the page's primary action produces
    both auto + AI workflows specific to this API. Degrades gracefully (no key →
    just cluster+synthesize, with a note in `discovery`)."""
    storage = load_storage()
    src = _get_source(storage, source_id)
    workflows = cluster_source(src, profile=profile)
    # Task A: auto-attach deterministic synthesized multi-step plans to each wf.
    auto_plan_count = synthesize_source_plans(workflows)
    storage.setdefault("workflow_defs", {})[source_id] = workflows
    save_storage(storage)

    discovery = None
    if discover:
        # AI design-time discovery (opt-in). Reuses the validated /discover path;
        # it persists accepted AI plans into workflow_plans for this source.
        discovery = await discover_workflows(source_id=source_id, provider=provider, model=model)

    # Recompute after discovery so any newly-stored AI plans are reflected.
    storage = load_storage()
    src = _get_source(storage, source_id)
    workflows = (storage.get("workflow_defs") or {}).get(source_id) or workflows
    _ensure_plans(workflows)
    metrics = compute_metrics(src, workflows)
    ai_store = (storage.get("workflow_plans") or {}).get(source_id, {})
    ai_plan_count = sum(len(p) for p in ai_store.values())
    return {
        "source_id": source_id,
        "source_name": source_id,
        "raw_tool_count": len(src.get("tools") or {}),
        "workflows": workflows,
        "metrics": metrics,
        "auto_plan_count": auto_plan_count,
        "ai_plan_count": ai_plan_count,
        "discovery": discovery,
    }


def _ensure_plans(workflows: list[dict]) -> list[dict]:
    """Make sure every workflow carries synthesized plans (idempotent). Used on
    the on-the-fly derivation paths so plans appear even before /generate runs
    and on older stored defs that predate the synthesizer."""
    if any("plans" not in w for w in workflows):
        synthesize_source_plans(workflows)
    return workflows


@router.get("")
def list_workflows(source_id: str = Query(...)):
    storage = load_storage()
    src = _get_source(storage, source_id)
    workflows = (storage.get("workflow_defs") or {}).get(source_id)
    if workflows is None:
        workflows = cluster_source(src)  # derive on the fly if not generated yet
    _ensure_plans(workflows)
    return {"source_id": source_id, "workflows": workflows, "metrics": compute_metrics(src, workflows)}


@router.get("/metrics")
def workflow_metrics(source_id: str = Query(...)):
    storage = load_storage()
    src = _get_source(storage, source_id)
    workflows = (storage.get("workflow_defs") or {}).get(source_id) or cluster_source(src)
    return {"source_id": source_id, **compute_metrics(src, workflows)}


# ---------------------------------------------------------------------------
# Enhancement 1 — Progressive disclosure: on-demand operation search / describe
# ---------------------------------------------------------------------------
@router.get("/search")
def search_operations(source_id: str = Query(...), query: str = Query(...), limit: int = 10):
    """Keyword/substring search over operation_id + summary + path across a
    source's workflows. Returns up to ``limit`` hits the agent can then describe."""
    storage = load_storage()
    src = _get_source(storage, source_id)
    workflows = (storage.get("workflow_defs") or {}).get(source_id) or cluster_source(src)
    q = (query or "").strip().lower()
    terms = [t for t in re.split(r"\s+", q) if t]
    hits = []
    for wf in workflows:
        for o in wf["operations"]:
            haystack = " ".join([
                str(o.get("operation_id") or ""),
                str(o.get("summary") or ""),
                str(o.get("path") or ""),
                str(o.get("method") or ""),
            ]).lower()
            # match if every whitespace-separated term appears (AND), or empty query
            if not terms or all(t in haystack for t in terms):
                hits.append({
                    "workflow_id": wf["id"],
                    "operation_id": o.get("operation_id"),
                    "method": o.get("method"),
                    "path": o.get("path"),
                    "summary": o.get("summary"),
                })
            if len(hits) >= limit:
                break
        if len(hits) >= limit:
            break
    return {"source_id": source_id, "query": query, "count": len(hits), "results": hits}


# ---------------------------------------------------------------------------
# 1:∞ layer — global helpers that fan a single query out across ALL sources.
# Additive: single-source search/describe/metrics above are untouched.
# ---------------------------------------------------------------------------
def _source_slug(source_id: str) -> str:
    """Short, stable, name-safe slug for a source_id used in namespaced tool
    names (`<slug>__<wf_id>`). Deterministic per source_id."""
    return _slug(source_id)[:24] or "src"


def namespaced_tool_name(source_id: str, workflow_id: str, taken: set[str] | None = None) -> str:
    """Build a sanitized, unique, ≤64-char `<source_slug>__<wf_id>` tool name."""
    base = re.sub(r"[^a-zA-Z0-9_-]", "_", f"{_source_slug(source_id)}__{workflow_id}")[:64]
    name = base or "tool"
    if taken is not None:
        n = name
        i = 1
        while n in taken:
            suffix = f"_{i}"
            n = (base[: 64 - len(suffix)] + suffix)
            i += 1
        name = n
        taken.add(name)
    return name


def search_all_sources(query: str, limit: int = 10) -> dict:
    """Search workflow operations across EVERY ingested source. Each hit is
    tagged with `source_id` and the namespaced workflow tool name to call.
    Reuses the same AND-of-terms matcher as the single-source search."""
    storage = load_storage()
    sources = storage.get("sources") or {}
    q = (query or "").strip().lower()
    terms = [t for t in re.split(r"\s+", q) if t]
    # Build a flat index of (source, workflow, op, haystack) once so we can do a
    # two-pass match: strict AND (all terms) first; if that yields nothing, fall
    # back to OR (any term). This makes loose queries like "wis ability score"
    # still surface the ability-scores operation.
    index: list[dict] = []
    taken: set[str] = set()
    for sid, src in sources.items():
        workflows = (storage.get("workflow_defs") or {}).get(sid) or cluster_source(src)
        wf_names = {wf["id"]: namespaced_tool_name(sid, wf["id"], taken) for wf in workflows}
        for wf in workflows:
            for o in wf["operations"]:
                haystack = " ".join([
                    str(o.get("operation_id") or ""),
                    str(o.get("summary") or ""),
                    str(o.get("path") or ""),
                    str(o.get("method") or ""),
                    str(sid),
                ]).lower()
                index.append({
                    "source_id": sid,
                    "tool_name": wf_names[wf["id"]],
                    "workflow_id": wf["id"],
                    "operation_id": o.get("operation_id"),
                    "method": o.get("method"),
                    "path": o.get("path"),
                    "summary": o.get("summary"),
                    "_hay": haystack,
                })

    def _collect(pred) -> list[dict]:
        out = []
        for row in index:
            if pred(row["_hay"]):
                out.append({k: v for k, v in row.items() if k != "_hay"})
                if len(out) >= limit:
                    break
        return out

    if not terms:
        hits = _collect(lambda h: True)
    else:
        hits = _collect(lambda h: all(t in h for t in terms))
        if not hits:
            # OR fallback, RANKED by how many distinct terms each row matches so
            # the most relevant op (e.g. ability-scores matching 'ability'+'score')
            # sorts above rows that only match one loose term.
            scored = []
            for row in index:
                score = sum(1 for t in terms if t in row["_hay"])
                if score:
                    scored.append((score, {k: v for k, v in row.items() if k != "_hay"}))
            scored.sort(key=lambda x: x[0], reverse=True)
            hits = [r for _, r in scored[:limit]]
    return {"query": query, "count": len(hits), "results": hits}


# ---------------------------------------------------------------------------
# Feature 2 — Chat auto-workflow-assigner (token-minimizing router).
# Deterministic, NO extra LLM. Given a user message it ranks workflows across
# ALL sources by content-term overlap (stopword-filtered, with singular/plural
# folding) and returns the top-K DISTINCT workflows that own the best hits, so
# the agent surface can be tailored to ~K tools instead of every workflow.
# ---------------------------------------------------------------------------

# Conversational filler + generic API verbs that carry no routing signal. These
# pollute a naive keyword match (e.g. "list"/"get" hit hundreds of CRUD ops), so
# we drop them before ranking. Kept small + explicit for determinism.
_ROUTER_STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "its", "it",
    "is", "are", "with", "by", "from", "this", "that", "these", "those", "my",
    "your", "their", "his", "her", "i", "we", "you", "me", "us", "all", "any",
    "please", "can", "could", "would", "should", "do", "does", "did", "then",
    "give", "show", "tell", "find", "fetch", "get", "list", "want", "need",
    "what", "which", "whats", "how", "about", "into", "out", "up", "as", "at",
    "be", "have", "has", "had", "will", "let", "lets", "use", "using", "call",
    "run", "make", "set", "info", "information", "data", "value", "values",
}


def _router_terms(query: str) -> list[str]:
    """Tokenize a message into content terms for routing: lowercase, alpha-num,
    drop stopwords + very short tokens, and add a crude singular fold so
    'skills' also matches 'skill' and 'scores' matches 'score'."""
    raw = [t for t in re.split(r"[^a-z0-9]+", (query or "").lower()) if t]
    terms: list[str] = []
    seen: set[str] = set()
    for t in raw:
        if t in _ROUTER_STOPWORDS or len(t) < 2:
            continue
        for cand in (t, t[:-1] if t.endswith("s") and len(t) > 3 else None):
            if cand and cand not in seen:
                seen.add(cand)
                terms.append(cand)
    return terms


def route_workflows(message: str, k: int = 3, hits_limit: int = 8) -> dict:
    """Token-minimizing router. Rank every workflow across ALL ingested sources
    by how strongly its operations match the message's content terms, then return
    the top-`k` DISTINCT workflows plus the supporting operation hits.

    Scoring per operation = number of DISTINCT content terms found in its
    operation_id/summary/path/source, with a small bonus for matches in the
    summary/operation_id (semantic) over the source slug (incidental). A workflow's
    score is the best operation score within it; ties break on total matched ops.

    Returns {message, terms, routed:[{source_id, workflow_id, tool_name, name,
    score, hits:[...]}], hits:[flat top ops], k}. Empty `routed` => caller should
    fall back to the full surface.
    """
    storage = load_storage()
    sources = storage.get("sources") or {}
    terms = _router_terms(message)
    taken: set[str] = set()

    # accumulate per-workflow scoring
    wf_acc: dict[tuple[str, str], dict] = {}
    for sid, src in sources.items():
        workflows = (storage.get("workflow_defs") or {}).get(sid) or cluster_source(src)
        wf_names = {wf["id"]: namespaced_tool_name(sid, wf["id"], taken) for wf in workflows}
        for wf in workflows:
            for o in wf["operations"]:
                # semantic haystack (operation_id + summary + path) vs incidental (source)
                semantic = " ".join([
                    str(o.get("operation_id") or ""),
                    str(o.get("summary") or ""),
                    str(o.get("path") or ""),
                ]).lower()
                incidental = str(sid).lower()
                if not terms:
                    matched = 0
                else:
                    matched = sum(1 for t in terms if t in semantic)
                    # source-slug-only matches count for very little (avoids a
                    # query term that happens to be in the source id dominating)
                    matched += 0.25 * sum(1 for t in terms
                                          if t not in semantic and t in incidental)
                if matched <= 0:
                    continue
                # path-segment exact match is a strong signal (e.g. /ability-scores)
                seg_tokens = set(re.split(r"[^a-z0-9]+", str(o.get("path") or "").lower()))
                seg_bonus = 0.5 * sum(1 for t in terms if t in seg_tokens)
                op_score = matched + seg_bonus
                key = (sid, wf["id"])
                acc = wf_acc.setdefault(key, {
                    "source_id": sid, "workflow_id": wf["id"],
                    "tool_name": wf_names[wf["id"]], "name": wf.get("name", wf["id"]),
                    "score": 0.0, "match_count": 0, "hits": [],
                })
                acc["score"] = max(acc["score"], op_score)
                acc["match_count"] += 1
                acc["hits"].append({
                    "source_id": sid, "tool_name": wf_names[wf["id"]],
                    "workflow_id": wf["id"], "operation_id": o.get("operation_id"),
                    "method": o.get("method"), "path": o.get("path"),
                    "summary": o.get("summary"), "_score": round(op_score, 2),
                })

    ranked = sorted(wf_acc.values(),
                    key=lambda w: (w["score"], w["match_count"]), reverse=True)
    routed = []
    flat_hits = []
    for w in ranked[:max(1, k)]:
        w["hits"].sort(key=lambda h: h["_score"], reverse=True)
        top_hits = w["hits"][:5]
        routed.append({
            "source_id": w["source_id"], "workflow_id": w["workflow_id"],
            "tool_name": w["tool_name"], "name": w["name"],
            "score": round(w["score"], 2), "matched_ops": w["match_count"],
            "hits": [{kk: vv for kk, vv in h.items() if kk != "_score"} for h in top_hits],
        })
        flat_hits.extend(top_hits)
    flat_hits.sort(key=lambda h: h["_score"], reverse=True)
    return {
        "message": message, "terms": terms, "k": max(1, k),
        "routed": routed,
        "hits": [{kk: vv for kk, vv in h.items() if kk != "_score"}
                 for h in flat_hits[:hits_limit]],
    }


@router.get("/route")
def route_endpoint(message: str = Query(...), k: int = 3):
    """Deterministic auto-router: returns the top-k task-relevant workflows for a
    message across ALL sources (no LLM). Powers the chat auto-workflow-assigner."""
    return route_workflows(message, k=k)


def describe_operation_any(operation_id: str, source_id: str | None = None) -> dict:
    """Resolve an operation across ALL sources when source_id is omitted.
    Returns the same shape as describe_operation, plus the namespaced tool_name."""
    storage = load_storage()
    sources = storage.get("sources") or {}
    if source_id:
        candidates = [(source_id, sources.get(source_id))]
    else:
        candidates = list(sources.items())
    for sid, src in candidates:
        if not src:
            continue
        tool = (src.get("tools") or {}).get(operation_id)
        if not tool:
            continue
        workflows = (storage.get("workflow_defs") or {}).get(sid) or cluster_source(src)
        wf_id = next((w["id"] for w in workflows
                      if any(o["operation_id"] == operation_id for o in w["operations"])), None)
        return {
            "source_id": sid,
            "workflow_id": wf_id,
            "tool_name": namespaced_tool_name(sid, wf_id) if wf_id else None,
            "operation_id": operation_id,
            "method": tool.get("method"),
            "path": tool.get("path"),
            "summary": (tool.get("summary") or tool.get("name") or "")[:200],
            "description": (tool.get("description") or "")[:600],
            "input_schema": _endpoint_input_schema(tool),
        }
    raise HTTPException(status_code=404,
                        detail=f"Operation '{operation_id}' not found in any source.")


@router.get("/search-all")
def search_all(query: str = Query(...), limit: int = 10):
    """Global progressive-disclosure search across every ingested source."""
    return search_all_sources(query, limit=limit)


@router.get("/metrics-all")
def workflow_metrics_all():
    """Aggregate the 1:1-vs-workflow token story across ALL sources — the
    '1:∞, flat tokens' headline. Sums raw/workflow tool counts and token costs
    over every source and reports overall reduction %s."""
    storage = load_storage()
    sources = storage.get("sources") or {}
    source_count = 0
    raw_tool_count = workflow_tool_count = 0
    raw_tokens = workflow_tokens_inline = workflow_tokens_deferred = 0
    per_source = []
    for sid, src in sources.items():
        workflows = (storage.get("workflow_defs") or {}).get(sid) or cluster_source(src)
        m = compute_metrics(src, workflows)
        source_count += 1
        raw_tool_count += m["raw_tool_count"]
        workflow_tool_count += m["workflow_tool_count"]
        raw_tokens += m["raw_tokens"]
        workflow_tokens_inline += m["workflow_tokens_inline"]
        workflow_tokens_deferred += m["workflow_tokens_deferred"]
        per_source.append({
            "source_id": sid,
            "raw_tool_count": m["raw_tool_count"],
            "workflow_tool_count": m["workflow_tool_count"],
            "raw_tokens": m["raw_tokens"],
            "workflow_tokens_deferred": m["workflow_tokens_deferred"],
        })
    raw_n = raw_tool_count or 1
    raw_t = raw_tokens or 1
    return {
        "source_count": source_count,
        "raw_tool_count": raw_tool_count,
        "workflow_tool_count": workflow_tool_count,
        "tool_reduction_pct": round((1 - workflow_tool_count / raw_n) * 100, 1),
        "raw_tokens": raw_tokens,
        "workflow_tokens_inline": workflow_tokens_inline,
        "workflow_tokens_deferred": workflow_tokens_deferred,
        "token_reduction_pct": round((1 - workflow_tokens_inline / raw_t) * 100, 1),
        "deferred_token_reduction_pct": round((1 - workflow_tokens_deferred / raw_t) * 100, 1),
        "per_source": per_source,
    }


@router.get("/operation")
def describe_operation(source_id: str = Query(...), operation_id: str = Query(...)):
    """Return the full input schema for a single operation (progressive disclosure
    detail step). Reuses the 1:1 endpoint schema builder."""
    storage = load_storage()
    src = _get_source(storage, source_id)
    tool = (src.get("tools") or {}).get(operation_id)
    if not tool:
        raise HTTPException(status_code=404,
                            detail=f"Operation '{operation_id}' not found in source '{source_id}'.")
    # find the owning workflow for context
    workflows = (storage.get("workflow_defs") or {}).get(source_id) or cluster_source(src)
    workflow_id = next((w["id"] for w in workflows
                        if any(o["operation_id"] == operation_id for o in w["operations"])), None)
    return {
        "source_id": source_id,
        "workflow_id": workflow_id,
        "operation_id": operation_id,
        "method": tool.get("method"),
        "path": tool.get("path"),
        "summary": (tool.get("summary") or tool.get("name") or "")[:200],
        "description": (tool.get("description") or "")[:600],
        "input_schema": _endpoint_input_schema(tool),
    }


# ===========================================================================
# Enhancement 2 — Declarative multi-step plan engine
# ===========================================================================
#
# A WorkflowPlan is an ordered list of steps. Each step:
#   {
#     "operation_id": "<op to call>",
#     "path_params":  {param: <literal or selector>},   # optional
#     "query_params": {param: <literal or selector>},   # optional
#     "body":         {field: <literal or selector>},   # optional
#     "foreach":      "<selector>",   # optional: iterate over a list, running
#                                     #   this step once per element. Inside the
#                                     #   step, selectors starting with "item."
#                                     #   reference the current element.
#     "until":        {"selector": "<sel>", "equals": <val>, "max_attempts": N,
#                      "delay_ms": M}  # optional: re-call until field matches
#   }
#
# Selector language (SIMPLE, documented):
#   - A plain string that is NOT a selector is treated as a literal.
#   - "$steps.<i>.<dotted.path>"  -> reach into the JSON result of step index i.
#   - "$last.<dotted.path>"       -> reach into the previous step's result.
#   - "item.<dotted.path>" / "item" -> current foreach element (inside foreach).
#   - "*" in a dotted path maps over a list, collecting the sub-selector from
#     every element, e.g. "$last.data.results.*.index" -> list of all indexes.
#
# Hard caps: MAX_STEPS, MAX_ITERATIONS per foreach, MAX_POLL_ATTEMPTS, and a
# per-call timeout inherited from proxy_call (30s).

MAX_PLAN_STEPS = 25
MAX_FOREACH_ITERATIONS = 25
MAX_POLL_ATTEMPTS = 30


def _dotted_get(obj: Any, path: str) -> Any:
    """Walk a dotted path into nested JSON. '*' maps over the current list."""
    if path == "":
        return obj
    cur = obj
    for part in path.split("."):
        if part == "":
            continue
        if part == "*":
            if not isinstance(cur, list):
                return None
            return cur  # caller handles the remaining sub-path mapping
        if isinstance(cur, list) and part.lstrip("-").isdigit():
            idx = int(part)
            cur = cur[idx] if -len(cur) <= idx < len(cur) else None
        elif isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
        if cur is None:
            return None
    return cur


def _resolve_path_with_star(obj: Any, parts: list[str]) -> Any:
    """Resolve a dotted path, supporting '*' to map a remaining sub-path over a list."""
    for i, part in enumerate(parts):
        if part == "":
            continue
        if part == "*":
            if not isinstance(obj, list):
                return None
            rest = parts[i + 1:]
            return [_resolve_path_with_star(el, rest) for el in obj]
        if isinstance(obj, list) and part.lstrip("-").isdigit():
            idx = int(part)
            obj = obj[idx] if -len(obj) <= idx < len(obj) else None
        elif isinstance(obj, dict):
            obj = obj.get(part)
        else:
            return None
        if obj is None:
            return None
    return obj


def _resolve_selector(value: Any, ctx: dict) -> Any:
    """Resolve a single value against the execution context.

    ctx = {"steps": [step_result, ...], "item": <current foreach element or None>}
    Non-string values and non-selector strings pass through as literals.
    """
    if not isinstance(value, str):
        return value
    if value == "item":
        return ctx.get("item")
    if value.startswith("item."):
        return _resolve_path_with_star(ctx.get("item"), value[len("item."):].split("."))
    if value.startswith("$last"):
        steps = ctx.get("steps") or []
        base = steps[-1] if steps else None
        rest = value[len("$last"):].lstrip(".")
        return _resolve_path_with_star(base, rest.split(".")) if rest else base
    if value.startswith("$steps."):
        rest = value[len("$steps."):]
        head, _, tail = rest.partition(".")
        steps = ctx.get("steps") or []
        if not head.isdigit():
            return None
        idx = int(head)
        base = steps[idx] if 0 <= idx < len(steps) else None
        return _resolve_path_with_star(base, tail.split(".")) if tail else base
    return value  # literal


def _resolve_mapping(mapping: dict, ctx: dict) -> dict:
    return {k: _resolve_selector(v, ctx) for k, v in (mapping or {}).items()}


async def _run_plan_step(source_id: str, step: dict, ctx: dict) -> dict:
    """Run one plan step (with optional poll/until) and return its proxy result.

    Cross-product plans: a step may carry its own `source_id` to target a
    different API than the plan default. Data still threads between steps via
    selectors, so a single plan can chain calls across multiple ingested APIs.
    """
    step_source = step.get("source_id") or source_id
    op_id = step["operation_id"]
    pp = _resolve_mapping(step.get("path_params"), ctx)
    qp = _resolve_mapping(step.get("query_params"), ctx)
    body = _resolve_mapping(step.get("body"), ctx)
    result = await proxy_call(ProxyCallRequest(
        source_id=step_source, operation_id=op_id,
        path_params=pp, query_params=qp, body=body))

    until = step.get("until")
    if until:
        sel = until.get("selector", "")
        target = until.get("equals")
        max_attempts = min(int(until.get("max_attempts", 5)), MAX_POLL_ATTEMPTS)
        delay_ms = int(until.get("delay_ms", 1000))
        attempts = 1
        while attempts < max_attempts:
            observed = _resolve_selector(sel, {"steps": [result], "item": ctx.get("item")})
            if str(observed) == str(target):
                break
            import asyncio
            await asyncio.sleep(min(delay_ms, 5000) / 1000.0)
            result = await proxy_call(ProxyCallRequest(
                source_id=step_source, operation_id=op_id,
                path_params=pp, query_params=qp, body=body))
            attempts += 1
        result = {"poll_attempts": attempts, **(result if isinstance(result, dict) else {"data": result})}
    return result


async def execute_plan(source_id: str, plan: list[dict], limit: int = 5) -> dict:
    """Generic plan interpreter. Threads JSON results between steps via selectors.

    Returns the per-step trace in the same shape the legacy __report__ used
    (a top-level ``steps`` list), plus a compact ``trace`` summary.
    """
    if not isinstance(plan, list) or not plan:
        raise HTTPException(status_code=400, detail="Plan must be a non-empty list of steps.")
    if len(plan) > MAX_PLAN_STEPS:
        raise HTTPException(status_code=400,
                            detail=f"Plan exceeds MAX_PLAN_STEPS ({MAX_PLAN_STEPS}).")

    step_results: list[Any] = []
    steps_trace: list[dict] = []
    cap = max(1, min(int(limit), MAX_FOREACH_ITERATIONS))

    for i, step in enumerate(plan):
        if not isinstance(step, dict) or "operation_id" not in step:
            raise HTTPException(status_code=400,
                                detail=f"Step {i} missing 'operation_id'.")
        step_source = step.get("source_id") or source_id
        ctx = {"steps": step_results, "item": None}
        foreach = step.get("foreach")
        if foreach:
            items = _resolve_selector(foreach, ctx)
            if not isinstance(items, list):
                items = []
            items = items[:cap]
            iter_results = []
            for el in items:
                ictx = {"steps": step_results, "item": el}
                # Capture per-iteration errors so a cross-source auth failure on
                # one step doesn't abort the whole plan — data flow is preserved.
                try:
                    r = await _run_plan_step(source_id, step, ictx)
                except HTTPException as e:
                    r = {"error": e.detail, "status_code": e.status_code}
                iter_results.append({"item": el, "result": r})
            step_results.append({"foreach": True, "items": iter_results})
            steps_trace.append({
                "step": i, "source_id": step_source,
                "operation_id": step["operation_id"], "foreach": True,
                "iterations": len(iter_results),
                "sample_status": (iter_results[0]["result"].get("status_code")
                                  if iter_results and isinstance(iter_results[0]["result"], dict) else None),
            })
        else:
            try:
                r = await _run_plan_step(source_id, step, ctx)
            except HTTPException as e:
                r = {"error": e.detail, "status_code": e.status_code}
            step_results.append(r)
            steps_trace.append({
                "step": i, "source_id": step_source,
                "operation_id": step["operation_id"],
                "status_code": r.get("status_code") if isinstance(r, dict) else None,
                "polled": isinstance(r, dict) and "poll_attempts" in r,
            })

    return {"steps_executed": len(plan), "steps": step_results, "trace": steps_trace}


def _auto_report_plan(wf: dict, limit: int = 5) -> list[dict]:
    """Build the list->detail plan that reproduces the legacy __report__ behavior."""
    collection = next((o for o in wf["operations"]
                       if o["method"] == "GET" and "{" not in o["path"]), None)
    item = next((o for o in wf["operations"]
                 if o["method"] == "GET" and "{" in o["path"]), None)
    if not collection or not item:
        return []
    ph = re.findall(r"\{([^}]+)\}", item["path"])
    ph_name = ph[0] if ph else "id"
    # selector: pull the id-ish key from each element of the collection's list
    return [
        {"operation_id": collection["operation_id"]},
        {
            "operation_id": item["operation_id"],
            "foreach": "$last.data.results.*.index",
            "path_params": {ph_name: "item"},
        },
    ]


# ===========================================================================
# Task A — Heuristic plan synthesizer (deterministic, NO LLM at runtime)
# ===========================================================================
#
# Analyzes endpoint structure and auto-derives advanced multi-step PLANS using
# the existing plan-step shape (operation_id + path_params/query_params/body +
# optional foreach/until/source_id). Each synthesized plan is a dict:
#   {"name", "description", "steps": [...], "auto": True, "kind": "<pattern>"}
#
# Patterns detected:
#   - list_and_detail  : collection GET /x  + item GET /x/{id}
#   - create_and_fetch : POST /x            + item GET /x/{id}
#   - submit_and_poll   : async-ish POST     + a Task/Status/Job GET to poll
#   - deep_inventory   : item GET /x/{id}    + its subresource GETs /x/{id}/y
#
# Deterministic + idempotent: same input => same plans, stable names.

# selectors we try (in order) to pull an id-ish key out of a collection element
_ID_KEYS_FOREACH = ["index", "Id", "id", "name", "slug"]
# fields on a created resource whose value we bind into the follow-up GET
_CREATED_ID_FIELDS = ["id", "Id", "index", "slug", "name"]
# state/status fields + their terminal values used by submit_and_poll
_STATE_FIELDS = ["TaskState", "status", "State", "JobState", "state"]
_TERMINAL_STATES = ["Completed", "Done", "OK", "Completed OK", "Succeeded", "complete", "success"]
# tokens that imply a POST kicks off async work
_ASYNC_HINTS = ("update", "reset", "action", "job", "task", "simpleupdate",
                "install", "import", "export", "build", "deploy", "submit", "run")


def _placeholders(path: str) -> list[str]:
    return re.findall(r"\{([^}]+)\}", path or "")


def _path_depth(path: str) -> int:
    return len([s for s in (path or "").split("/") if s and not s.startswith("{")])


def _collection_for_item(item_op: dict, ops: list[dict]) -> dict | None:
    """Find the sibling collection GET for an item GET /x/{id}: same path with
    the trailing /{id} removed."""
    ip = item_op["path"]
    base = re.sub(r"/\{[^}]+\}$", "", ip)
    if base == ip:
        return None
    for o in ops:
        if o["method"] == "GET" and o["path"] == base and "{" not in o["path"].split("/")[-1]:
            return o
    return None


def _list_detail_selector(collection_path: str) -> str:
    """Best-effort foreach selector for the id-ish key in a collection response.
    Redfish collections use {Members:[{@odata.id}]}; most REST use {results|data:[...]}.
    Default to the dnd5e/openapi `results.*.index` shape used by __report__."""
    return "$last.data.results.*.index"


def _synth_list_and_detail(wf_ops: list[dict], all_ops: list[dict]) -> list[dict]:
    plans = []
    for item in wf_ops:
        if item["method"] != "GET" or "{" not in item["path"]:
            continue
        # only the LAST path segment may be a placeholder (a true item endpoint)
        if not re.search(r"/\{[^}]+\}$", item["path"]):
            continue
        coll = _collection_for_item(item, all_ops)
        if not coll:
            continue
        ph = _placeholders(item["path"])
        ph_name = ph[-1] if ph else "id"
        title = coll["path"].rstrip("/").split("/")[-1] or "items"
        plans.append({
            "name": f"list_and_detail_{_slug(title)}",
            "description": f"List {title}, then fetch full detail for each item.",
            "kind": "list_and_detail",
            "auto": True,
            "steps": [
                {"operation_id": coll["operation_id"]},
                {
                    "operation_id": item["operation_id"],
                    "foreach": _list_detail_selector(coll["path"]),
                    "path_params": {ph_name: "item"},
                },
            ],
        })
    return plans


def _synth_create_and_fetch(wf_ops: list[dict], all_ops: list[dict]) -> list[dict]:
    plans = []
    for create in wf_ops:
        if create["method"] != "POST":
            continue
        # POST /x where the action segment isn't an /Actions/... RPC
        if "/Actions/" in create["path"] or "{" in create["path"].split("/")[-1]:
            continue
        cpath = create["path"].rstrip("/")
        # matching item GET /x/{id}
        item = next((o for o in all_ops
                     if o["method"] == "GET"
                     and re.sub(r"/\{[^}]+\}$", "", o["path"]) == cpath
                     and "{" in o["path"]), None)
        if not item:
            continue
        ph = _placeholders(item["path"])
        ph_name = ph[-1] if ph else "id"
        title = cpath.split("/")[-1] or "resource"
        # bind the created id from the POST response into the follow-up GET path
        id_sel = f"$last.data.{_CREATED_ID_FIELDS[0]}"
        plans.append({
            "name": f"create_and_fetch_{_slug(title)}",
            "description": f"Create a {title} (POST), then fetch the created resource by its returned id.",
            "kind": "create_and_fetch",
            "auto": True,
            "id_field_candidates": _CREATED_ID_FIELDS,
            "steps": [
                {"operation_id": create["operation_id"], "body": {}},
                {
                    "operation_id": item["operation_id"],
                    "path_params": {ph_name: id_sel},
                },
            ],
        })
    return plans


def _find_poll_op(all_ops: list[dict]) -> dict | None:
    """Find a GET that polls task/job/status — prefer an item-level Task GET."""
    cand = [o for o in all_ops if o["method"] == "GET"
            and re.search(r"task|job|status|state", o["path"], re.IGNORECASE)]
    # prefer one with a path param (a specific task/job instance)
    item_level = [o for o in cand if "{" in o["path"]]
    if item_level:
        return sorted(item_level, key=lambda o: _path_depth(o["path"]))[-1]
    return cand[0] if cand else None


def _synth_submit_and_poll(wf_ops: list[dict], all_ops: list[dict]) -> list[dict]:
    plans = []
    poll = _find_poll_op(all_ops)
    for submit in wf_ops:
        if submit["method"] not in ("POST", "PUT", "PATCH"):
            continue
        text = f"{submit['path']} {submit.get('summary','')} {submit['operation_id']}".lower()
        is_async = any(h in text for h in _ASYNC_HINTS)
        if not (is_async or poll):
            continue
        if not poll:
            continue
        ph = _placeholders(poll["path"])
        poll_step = {
            "operation_id": poll["operation_id"],
            "until": {
                # selector points at the polled GET's own most recent result
                "selector": f"$last.data.{_STATE_FIELDS[0]}",
                "equals": _TERMINAL_STATES[0],
                "max_attempts": 10,
                "delay_ms": 2000,
            },
        }
        if ph:
            # bind the task/job id from the submit response (best-effort: TaskState
            # responses usually carry an Id / @odata.id; operator can override)
            poll_step["path_params"] = {ph[-1]: "$last.data.Id"}
        action = submit["path"].split("/")[-1] or submit["operation_id"]
        plans.append({
            "name": f"submit_and_poll_{_slug(action)}",
            "description": (
                f"Submit {action} (async), then poll {poll['path']} until "
                f"{_STATE_FIELDS[0]} reaches a terminal state ({', '.join(_TERMINAL_STATES[:3])})."
            ),
            "kind": "submit_and_poll",
            "auto": True,
            "state_field_candidates": _STATE_FIELDS,
            "terminal_states": _TERMINAL_STATES,
            "steps": [
                {"operation_id": submit["operation_id"], "body": {}},
                poll_step,
            ],
        })
    return plans


def _synth_deep_inventory(wf_ops: list[dict], all_ops: list[dict]) -> list[dict]:
    plans = []
    for item in wf_ops:
        if item["method"] != "GET" or not re.search(r"/\{[^}]+\}$", item["path"]):
            continue
        base = item["path"]  # /x/{id}
        # subresource GETs: /x/{id}/y (one segment deeper, no extra placeholder)
        subs = [o for o in all_ops
                if o["method"] == "GET"
                and o["path"].startswith(base + "/")
                and "{" not in o["path"][len(base) + 1:]]
        if not subs:
            continue
        ph = _placeholders(item["path"])
        ph_name = ph[-1] if ph else "id"
        title = re.sub(r"/\{[^}]+\}$", "", base).split("/")[-1] or "resource"
        # step 0 fetches the item /x/{id}; steps 1..N fetch each subresource
        # reusing the SAME id, bound from the fetched item's own `Id` field
        # ($steps.0.data.Id — Redfish item bodies carry their Id). The operator
        # supplies the {id} for step 0 at run time via path_params.
        steps = [{"operation_id": item["operation_id"]}]
        for sub in sorted(subs, key=lambda o: o["path"]):
            steps.append({
                "operation_id": sub["operation_id"],
                "path_params": {ph_name: "$steps.0.data.Id"},
            })
        plans.append({
            "name": f"deep_inventory_{_slug(title)}",
            "description": (
                f"Walk the {title} resource graph: fetch the item then its "
                f"{len(subs)} subresources ({', '.join(s['path'].split('/')[-1] for s in subs[:5])})."
            ),
            "kind": "deep_inventory",
            "auto": True,
            "steps": steps,
        })
    return plans


def synthesize_plans(workflow: dict, all_ops: list[dict]) -> list[dict]:
    """Deterministically synthesize advanced multi-step plans for ONE workflow by
    analyzing endpoint structure against the full source operation list.

    `all_ops` is the source-level list of operation dicts ({operation_id, method,
    path, summary, params}) so cross-workflow siblings (e.g. a TaskService poll GET
    living in a different cluster) can still be discovered.

    Returns a de-duplicated, name-sorted list of plan dicts. Idempotent.
    """
    wf_ops = workflow.get("operations") or []
    out: list[dict] = []
    out += _synth_list_and_detail(wf_ops, all_ops)
    out += _synth_create_and_fetch(wf_ops, all_ops)
    out += _synth_submit_and_poll(wf_ops, all_ops)
    out += _synth_deep_inventory(wf_ops, all_ops)
    # de-dup by name (stable) and sort for determinism
    seen: dict[str, dict] = {}
    for p in out:
        seen.setdefault(p["name"], p)
    return sorted(seen.values(), key=lambda p: p["name"])


def synthesize_source_plans(workflows: list[dict]) -> int:
    """Source-level pass: attach `workflow["plans"]` to every workflow in place,
    using the union of all operations across the source as the analysis graph.
    Returns the total number of synthesized plans (for metrics)."""
    all_ops: list[dict] = []
    seen_ops: set[str] = set()
    for wf in workflows:
        for o in wf.get("operations") or []:
            oid = o.get("operation_id")
            if oid and oid not in seen_ops:
                seen_ops.add(oid)
                all_ops.append(o)
    total = 0
    for wf in workflows:
        plans = synthesize_plans(wf, all_ops)
        wf["plans"] = plans
        total += len(plans)
    return total


class WorkflowExecRequest(BaseModel):
    source_id: str
    workflow_id: str
    operation: str
    path_params: dict[str, Any] = {}
    query_params: dict[str, Any] = {}
    body: dict[str, Any] = {}
    report_limit: int = 5


def _find_workflow(storage: dict, source_id: str, workflow_id: str) -> dict:
    src = _get_source(storage, source_id)
    workflows = (storage.get("workflow_defs") or {}).get(source_id) or cluster_source(src)
    _ensure_plans(workflows)
    for w in workflows:
        if w["id"] == workflow_id:
            return w
    raise HTTPException(status_code=404, detail=f"Workflow '{workflow_id}' not found.")


def _extract_item_keys(data: Any) -> list[str]:
    """Best-effort: pull item identifiers (index/id/name) from a collection response."""
    keys = []
    candidates = data
    if isinstance(data, dict):
        # common shapes: {results:[...]}, {data:[...]}, {count, results}
        for k in ("results", "data", "items", "value", "members", "Members"):
            if isinstance(data.get(k), list):
                candidates = data[k]
                break
        else:
            candidates = list(data.values())
    if isinstance(candidates, list):
        for item in candidates:
            if isinstance(item, dict):
                for idk in ("index", "id", "Id", "name", "slug"):
                    if idk in item and isinstance(item[idk], (str, int)):
                        keys.append(str(item[idk]))
                        break
            elif isinstance(item, (str, int)):
                keys.append(str(item))
    return keys


@router.post("/execute")
async def execute_workflow(req: WorkflowExecRequest):
    storage = load_storage()
    wf = _find_workflow(storage, req.source_id, req.workflow_id)
    ops_by_id = {o["operation_id"]: o for o in wf["operations"]}

    # ── multi-step orchestration: list a collection, then fetch item details ──
    # Now implemented as an auto-generated declarative plan (Enhancement 2) while
    # preserving the legacy output shape (top-level `steps` with list + details).
    if req.operation == "__report__":
        collection = next((o for o in wf["operations"] if o["method"] == "GET" and "{" not in o["path"]), None)
        item = next((o for o in wf["operations"] if o["method"] == "GET" and "{" in o["path"]), None)
        if not collection or not item:
            raise HTTPException(status_code=400, detail="This workflow has no collection+item pair to report on.")
        # Step 1: list the collection.
        list_res = await proxy_call(ProxyCallRequest(
            source_id=req.source_id, operation_id=collection["operation_id"],
            query_params=req.query_params))
        keys = _extract_item_keys(list_res.get("data") if isinstance(list_res, dict) else list_res)
        ph = [m for m in re.findall(r"\{([^}]+)\}", item["path"])]
        ph_name = ph[0] if ph else "id"
        # Step 2: foreach extracted key, fetch its detail (data flows via the plan).
        detail_plan = [{
            "operation_id": item["operation_id"],
            "foreach": "item",  # we feed the keys list directly below
            "path_params": {ph_name: "item"},
        }]
        # run the foreach over the extracted keys using the generic executor
        limit = max(1, min(req.report_limit, MAX_FOREACH_ITERATIONS))
        details = []
        for key in keys[:limit]:
            r = await _run_plan_step(req.source_id, detail_plan[0], {"steps": [], "item": key})
            details.append({ph_name: key, "result": r})
        steps = [
            {"step": "list", "operation_id": collection["operation_id"], "result": list_res},
            {"step": "details", "operation_id": item["operation_id"],
             "count": len(details), "items": details},
        ]
        return {"workflow_id": req.workflow_id, "operation": "__report__",
                "items_found": len(keys), "items_fetched": len(details), "steps": steps}

    # ── synthesized / AI plan dispatch: operation == "plan:<name>" ──
    # Runs a named multi-step plan (from workflow["plans"] or stored AI plans)
    # through the generic plan engine. __report__ above remains a built-in alias.
    if req.operation.startswith("plan:"):
        plan_name = req.operation[len("plan:"):]
        plan_steps = None
        for p in (wf.get("plans") or []):
            if p.get("name") == plan_name:
                plan_steps = p.get("steps")
                break
        if plan_steps is None:  # fall back to stored named plans (e.g. AI plans)
            plan_steps = (((storage.get("workflow_plans") or {}).get(req.source_id) or {})
                          .get(req.workflow_id, {}).get(plan_name))
        if plan_steps is None:
            raise HTTPException(status_code=404,
                                detail=f"Plan '{plan_name}' not found in workflow '{req.workflow_id}'.")
        out = await execute_plan(req.source_id, plan_steps, limit=req.report_limit)
        return {"workflow_id": req.workflow_id, "operation": req.operation,
                "plan": plan_name, **out}

    # ── single-operation dispatch ──
    op = ops_by_id.get(req.operation)
    if not op:
        raise HTTPException(status_code=404,
                            detail=f"Operation '{req.operation}' not in workflow '{req.workflow_id}'.")
    result = await proxy_call(ProxyCallRequest(
        source_id=req.source_id, operation_id=op["operation_id"],
        path_params=req.path_params, query_params=req.query_params, body=req.body))
    return {"workflow_id": req.workflow_id, "operation": req.operation,
            "method": op["method"], "path": op["path"], "result": result}


# ---------------------------------------------------------------------------
# Enhancement 2 — plan execute endpoint + named-plan storage
# ---------------------------------------------------------------------------
class PlanExecRequest(BaseModel):
    source_id: str
    plan: list[dict[str, Any]]
    limit: int = 5
    workflow_id: str | None = None  # optional, for trace context only


@router.post("/plan/execute")
async def plan_execute(req: PlanExecRequest):
    """Execute an inline declarative WorkflowPlan and return the per-step trace."""
    storage = load_storage()
    _get_source(storage, req.source_id)  # validates source exists
    out = await execute_plan(req.source_id, req.plan, limit=req.limit)
    return {"source_id": req.source_id, "workflow_id": req.workflow_id, **out}


class NamedPlanSaveRequest(BaseModel):
    source_id: str
    workflow_id: str
    name: str
    plan: list[dict[str, Any]]


@router.post("/plan/save")
async def plan_save(req: NamedPlanSaveRequest):
    """Store a named plan for a workflow (workflow_plans[source_id][workflow_id][name])."""
    storage = load_storage()
    _get_source(storage, req.source_id)
    plans = storage.setdefault("workflow_plans", {})
    plans.setdefault(req.source_id, {}).setdefault(req.workflow_id, {})[req.name] = req.plan
    save_storage(storage)
    return {"status": "saved", "source_id": req.source_id,
            "workflow_id": req.workflow_id, "name": req.name, "steps": len(req.plan)}


@router.get("/plan")
def plan_list(source_id: str = Query(...), workflow_id: str | None = Query(None)):
    """List stored named plans for a source (optionally filtered by workflow)."""
    storage = load_storage()
    _get_source(storage, source_id)
    plans = (storage.get("workflow_plans") or {}).get(source_id, {})
    if workflow_id is not None:
        plans = {workflow_id: plans.get(workflow_id, {})}
    return {"source_id": source_id, "plans": plans}


@router.post("/plan/run-named")
async def plan_run_named(source_id: str = Query(...), workflow_id: str = Query(...),
                         name: str = Query(...), limit: int = 5):
    """Execute a previously stored named plan."""
    storage = load_storage()
    _get_source(storage, source_id)
    plan = (((storage.get("workflow_plans") or {}).get(source_id) or {})
            .get(workflow_id, {}).get(name))
    if plan is None:
        raise HTTPException(status_code=404,
                            detail=f"Named plan '{name}' not found for {source_id}/{workflow_id}.")
    out = await execute_plan(source_id, plan, limit=limit)
    return {"source_id": source_id, "workflow_id": workflow_id, "name": name, **out}


# ---------------------------------------------------------------------------
# Task C — expose synthesized + AI plans per workflow (for the UI / agents)
# ---------------------------------------------------------------------------
@router.get("/plans")
def list_synthesized_plans(source_id: str = Query(...)):
    """Return all synthesized (auto) + stored AI plans per workflow for a source.

    Shape: {source_id, workflows: [{workflow_id, name, plans: [...]}]} where each
    plan is {name, description, kind, source: "auto"|"ai", steps:[...]}.
    Run any plan via /workflows/execute with operation="plan:<name>"."""
    storage = load_storage()
    src = _get_source(storage, source_id)
    workflows = (storage.get("workflow_defs") or {}).get(source_id) or cluster_source(src)
    _ensure_plans(workflows)
    ai_store = (storage.get("workflow_plans") or {}).get(source_id, {})
    out = []
    for wf in workflows:
        plans = []
        for p in (wf.get("plans") or []):
            plans.append({**p, "source": "auto"})
        # merge stored AI plans (named) for this workflow
        for name, steps in (ai_store.get(wf["id"]) or {}).items():
            if any(pl["name"] == name for pl in plans):
                continue
            plans.append({"name": name, "description": f"AI-discovered plan '{name}'.",
                          "kind": "ai", "source": "ai", "steps": steps})
        out.append({"workflow_id": wf["id"], "name": wf["name"], "plans": plans})
    total = sum(len(w["plans"]) for w in out)
    return {"source_id": source_id, "plan_count": total, "workflows": out}


# ===========================================================================
# Task B — Design-time AI workflow discovery (LLM ONLY here; opt-in endpoint)
# ===========================================================================
#
# Builds a COMPACT catalog of a source's operations, asks the configured provider
# (default groq openai/gpt-oss-120b) to propose 3-8 advanced multi-step
# workflows, then VALIDATES every referenced operation_id against the source,
# repairs/drops invalid steps, rejects empty plans, and stores accepted ones as
# named plans (source:"ai"). Runtime core stays LLM-free.

_DISCOVER_MAX_OPS = 120  # cap catalog size to stay within context


def _compact_catalog(src: dict) -> list[dict]:
    """[{operation_id, method, path, summary, required}] trimmed for the prompt."""
    out = []
    for oid, t in (src.get("tools") or {}).items():
        required = []
        for p in (t.get("parameters") or []):
            if isinstance(p, dict) and p.get("required") and p.get("name"):
                required.append(p["name"])
        out.append({
            "operation_id": oid,
            "method": (t.get("method") or "GET").upper(),
            "path": t.get("path") or "/",
            "summary": (t.get("summary") or t.get("name") or "")[:80],
            "required": required,
        })
        if len(out) >= _DISCOVER_MAX_OPS:
            break
    return out


def _build_discover_prompt(source_id: str, catalog: list[dict]) -> str:
    lines = [f"{c['operation_id']} | {c['method']} {c['path']}"
             + (f" | requires: {', '.join(c['required'])}" if c["required"] else "")
             + (f" | {c['summary']}" if c["summary"] else "")
             for c in catalog]
    return (
        "You are an API workflow architect. Below is the FULL operation catalog for "
        f"the API source '{source_id}'. Propose 3-8 ADVANCED, operator-intent, "
        "MULTI-STEP workflows that chain these operations to accomplish real goals "
        "(e.g. list-then-detail, create-then-fetch, submit-then-poll, "
        "deep-inventory walks). Each step MUST reference an operation_id EXACTLY as "
        "listed below — never invent one. Each workflow needs >=2 steps.\n\n"
        "Return ONLY strict JSON of the form:\n"
        '{"workflows":[{"name":"snake_case_name","description":"one line",'
        '"steps":[{"operation_id":"<exact id>","bind":"optional note on data flow"}]}]}\n\n'
        "OPERATION CATALOG:\n" + "\n".join(lines)
    )


def _extract_json(text: str) -> dict | None:
    """Pull the first JSON object out of an LLM response (handles ```json fences)."""
    if not text:
        return None
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    blob = m.group(1) if m else None
    if blob is None:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end <= start:
            return None
        blob = text[start:end + 1]
    try:
        return json.loads(blob)
    except Exception:
        return None


async def _call_provider_for_discovery(prompt: str, provider: str, model: str) -> tuple[str, str | None]:
    """Single-shot (no tools) provider call. Returns (text, error)."""
    from app.agent import (
        GROQ_API_KEY, ANTHROPIC_API_KEY, GROQ_DEFAULT_MODEL, OLLAMA_BASE_URL,
    )
    sys_prompt = "You output only strict JSON. No prose, no markdown fences unless asked."
    if provider == "groq":
        if not GROQ_API_KEY:
            return "", "GROQ_API_KEY is not set in compiler/.env."
        base, key, mdl = "https://api.groq.com/openai/v1", GROQ_API_KEY, (model or GROQ_DEFAULT_MODEL)
    elif provider == "claude":
        if not ANTHROPIC_API_KEY:
            return "", "ANTHROPIC_API_KEY is not set in compiler/.env."
        # use the OpenAI-compat path only for groq/ollama; claude handled below
        base, key, mdl = None, ANTHROPIC_API_KEY, (model or "claude-sonnet-4-6")
    elif provider == "ollama":
        base, key, mdl = f"{OLLAMA_BASE_URL}/v1", "", (model or "")
    else:
        return "", f"Unknown provider '{provider}'."

    try:
        if provider == "claude":
            headers = {"x-api-key": key, "anthropic-version": "2023-06-01",
                       "content-type": "application/json"}
            payload = {"model": mdl, "max_tokens": 2048, "system": sys_prompt,
                       "messages": [{"role": "user", "content": prompt}]}
            async with httpx.AsyncClient(timeout=120.0) as client:
                r = await client.post("https://api.anthropic.com/v1/messages",
                                      headers=headers, json=payload)
                if r.status_code >= 400:
                    return "", f"Anthropic {r.status_code}: {r.text[:300]}"
                blocks = r.json().get("content", [])
                return "".join(b.get("text", "") for b in blocks if b.get("type") == "text"), None
        else:
            headers = {"content-type": "application/json"}
            if key:
                headers["Authorization"] = f"Bearer {key}"
            payload = {"model": mdl, "messages": [
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": prompt}]}
            async with httpx.AsyncClient(timeout=120.0) as client:
                r = await client.post(f"{base}/chat/completions", headers=headers, json=payload)
                if r.status_code >= 400:
                    return "", f"{provider} {r.status_code}: {r.text[:300]}"
                msg = (r.json().get("choices") or [{}])[0].get("message", {})
                return msg.get("content") or "", None
    except Exception as e:  # noqa: BLE001
        return "", f"{provider} call failed: {e}"


def _owning_workflow_id(workflows: list[dict], operation_id: str) -> str | None:
    for w in workflows:
        if any(o["operation_id"] == operation_id for o in w["operations"]):
            return w["id"]
    return None


@router.post("/discover")
async def discover_workflows(source_id: str = Query(...),
                             provider: str = Query("groq"),
                             model: str = Query("")):
    """Design-time, LLM-assisted advanced-workflow discovery (opt-in).

    Returns {proposed, accepted, rejected_reasons}. Accepted plans are validated
    against the source spec and stored as named AI plans (source:"ai"). Degrades
    gracefully with a clear message if no key/provider is configured."""
    storage = load_storage()
    src = _get_source(storage, source_id)
    valid_ops = set((src.get("tools") or {}).keys())
    catalog = _compact_catalog(src)
    prompt = _build_discover_prompt(source_id, catalog)

    text, err = await _call_provider_for_discovery(prompt, provider.lower(), model)
    if err:
        return {"source_id": source_id, "provider": provider, "ok": False,
                "message": err, "proposed": [], "accepted": [], "rejected_reasons": [err]}

    parsed = _extract_json(text)
    if not parsed or not isinstance(parsed.get("workflows"), list):
        return {"source_id": source_id, "provider": provider, "ok": False,
                "message": "Provider did not return parseable workflow JSON.",
                "raw": text[:600], "proposed": [], "accepted": [], "rejected_reasons": [
                    "unparseable LLM response"]}

    proposed = parsed["workflows"]
    workflows = (storage.get("workflow_defs") or {}).get(source_id) or cluster_source(src)
    _ensure_plans(workflows)

    accepted = []
    rejected_reasons = []
    ai_store = storage.setdefault("workflow_plans", {}).setdefault(source_id, {})

    for idx, wf in enumerate(proposed):
        name = _slug(str(wf.get("name") or f"ai_workflow_{idx}"))
        raw_steps = wf.get("steps") or []
        valid_steps = []
        dropped = []
        for st in raw_steps:
            oid = (st or {}).get("operation_id")
            if oid in valid_ops:
                step = {"operation_id": oid}
                if st.get("bind"):
                    step["_bind"] = str(st["bind"])[:120]
                valid_steps.append(step)
            else:
                dropped.append(oid)
        if len(valid_steps) < 2:
            rejected_reasons.append(
                f"'{name}': only {len(valid_steps)} valid step(s) "
                f"(dropped invalid op_ids: {dropped or 'none'}).")
            continue
        # anchor to the workflow that owns the first step's operation
        owner = _owning_workflow_id(workflows, valid_steps[0]["operation_id"]) or workflows[0]["id"]
        ai_store.setdefault(owner, {})[name] = valid_steps
        accepted.append({
            "name": name,
            "description": str(wf.get("description") or "")[:200],
            "workflow_id": owner,
            "source": "ai",
            "steps": valid_steps,
            "dropped_op_ids": dropped,
        })

    save_storage(storage)
    return {
        "source_id": source_id, "provider": provider, "model": model or "(default)",
        "ok": True,
        "catalog_size": len(catalog),
        "proposed_count": len(proposed),
        "accepted_count": len(accepted),
        "proposed": proposed,
        "accepted": accepted,
        "rejected_reasons": rejected_reasons,
    }
