"""
Agent playground backend.

Runs a provider-agnostic tool-use loop against a curated toolset and streams the
execution trace to the frontend over SSE. Three providers are supported, all via
raw httpx (no extra SDK dependency):

  - claude  : Anthropic Messages API  (native tool-use blocks)
  - groq    : Groq OpenAI-compatible API
  - ollama  : local Ollama OpenAI-compatible API

Tool definitions are built from the selected toolset by resolving each tool back
to its source OpenAPI operation (for real JSON-Schema parameters). Tool calls are
executed through the existing proxy layer (`app.proxy.proxy_call`).
"""
import os
import re
import json
import time
from typing import Any, AsyncIterator

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.storage import load_storage
from app.proxy import ProxyCallRequest, proxy_call
from app.workflows import (
    cluster_source,
    workflow_tool_schema,
    WorkflowExecRequest,
    execute_workflow,
    search_operations as wf_search_operations,
    describe_operation as wf_describe_operation,
    search_all_sources as wf_search_all_sources,
    describe_operation_any as wf_describe_operation_any,
    namespaced_tool_name,
    route_workflows as wf_route_workflows,
)

router = APIRouter(prefix="/api/v1/agent")


# ---------------------------------------------------------------------------
# Minimal .env loader (python-dotenv is not installed)
# ---------------------------------------------------------------------------
def _load_env() -> None:
    env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
    if not os.path.exists(env_path):
        return
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key, val = key.strip(), val.strip().strip('"').strip("'")
                # Don't clobber a real environment variable if already set
                os.environ.setdefault(key, val)
    except Exception:
        pass


_load_env()

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")

CLAUDE_MODELS = ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5"]
GROQ_DEFAULT_MODELS = [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
]
GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b"

SYSTEM_PROMPT = (
    "You are an API toolset tester. The user gives you a request; you have a set of "
    "tools that each call a real API endpoint. Use the tools to fulfil the request, "
    "passing correct parameters. After the tool results come back, answer the user "
    "concisely based on the real data. If a tool errors, explain what went wrong."
)

MAX_TURNS = 8
# Tool results are fed back to the model AND re-sent on every subsequent turn,
# so oversized results compound token cost fast. Keep enough to answer, no more.
MAX_TOOL_RESULT_CHARS = 2500


# ---------------------------------------------------------------------------
# Tool catalog: resolve toolset -> JSON-Schema tool defs + an execution registry
# ---------------------------------------------------------------------------
def _sanitize(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", str(name))[:64] or "tool"


def _jtype(openapi_type: str) -> str:
    return {
        "string": "string",
        "integer": "integer",
        "number": "number",
        "boolean": "boolean",
        "array": "array",
        "object": "object",
    }.get(str(openapi_type).lower(), "string")


def _find_source_for_op(sources: dict, op_id: str) -> str:
    for sid, data in sources.items():
        if op_id in (data.get("tools") or {}):
            return sid
    return ""


def build_catalog(toolset: dict) -> tuple[list[dict], dict]:
    """Returns (tool_defs, registry).

    tool_defs: [{name, description, input_schema}] — provider-neutral.
    registry:  name -> {source_id, operation_id, locations: {param: path|query|body}}
    """
    storage = load_storage()
    sources = storage.get("sources", {})
    tool_defs: list[dict] = []
    registry: dict[str, dict] = {}

    for t in toolset.get("tools", []):
        if not t.get("selected"):
            continue
        op_id = t.get("id")
        if not op_id:
            continue
        sid = t.get("source_id") or _find_source_for_op(sources, op_id)
        src_tool = (sources.get(sid, {}).get("tools", {}) or {}).get(op_id, {})

        params = src_tool.get("parameters") or t.get("parameters") or []
        method = (t.get("method") or src_tool.get("method") or "GET").upper()
        path = t.get("path") or src_tool.get("path") or "/"

        props: dict[str, Any] = {}
        required: list[str] = []
        locations: dict[str, str] = {}

        for p in params:
            if isinstance(p, dict):
                pname = p.get("name")
                if not pname:
                    continue
                loc = p.get("in", "query")
                # Swagger 2.0 body parameter — represent the whole body as one object arg.
                if loc == "body":
                    props["body"] = {
                        "type": "object",
                        "description": (p.get("description") or "JSON request body")[:300],
                    }
                    locations["body"] = "body"
                    if p.get("required"):
                        required.append("body")
                    continue
                # OAS3 puts type under `schema`; Swagger 2.0 puts it at the top level.
                schema = p.get("schema") or {}
                prop: dict[str, Any] = {
                    "type": _jtype(schema.get("type") or p.get("type") or "string"),
                    "description": (p.get("description") or f"{loc} parameter")[:300],
                }
                if prop["type"] == "array":
                    prop["items"] = {"type": "string"}
                props[pname] = prop
                if p.get("required"):
                    required.append(pname)
                if loc == "path":
                    locations[pname] = "path"
                elif loc == "formData":
                    locations[pname] = "body"  # best-effort; proxy sends JSON, not form-encoded
                else:
                    locations[pname] = "query"  # query (header/cookie aren't proxyable -> query)
            elif isinstance(p, str):
                props[p] = {"type": "string", "description": "parameter"}
                locations[p] = "query"

        # OAS3 request body (only add if a Swagger 2.0 body param didn't already).
        if src_tool.get("request_body") and "body" not in props:
            props["body"] = {"type": "object", "description": "JSON request body"}
            locations["body"] = "body"

        name = _sanitize(op_id)
        # de-dup sanitized names
        if name in registry:
            name = f"{name}_{len(registry)}"
        description = (
            src_tool.get("description") or t.get("description") or f"{method} {path}"
        )[:400]

        tool_defs.append(
            {
                "name": name,
                "description": description,
                "input_schema": {
                    "type": "object",
                    "properties": props,
                    "required": required,
                },
            }
        )
        registry[name] = {
            "source_id": sid,
            "operation_id": op_id,
            "locations": locations,
            "method": method,
            "path": path,
        }

    return tool_defs, registry


def _to_proxy_request(name: str, args: dict, registry: dict) -> ProxyCallRequest:
    meta = registry[name]
    path_params: dict[str, Any] = {}
    query_params: dict[str, Any] = {}
    body: dict[str, Any] = {}
    for key, value in (args or {}).items():
        loc = meta["locations"].get(key, "query")
        if loc == "path":
            path_params[key] = value
        elif loc == "body":
            if isinstance(value, dict):
                body.update(value)
        else:
            query_params[key] = value
    return ProxyCallRequest(
        source_id=meta["source_id"],
        operation_id=meta["operation_id"],
        path_params=path_params,
        query_params=query_params,
        body=body,
    )


async def _execute_tool(name: str, args: dict, registry: dict) -> tuple[bool, Any]:
    try:
        req = _to_proxy_request(name, args, registry)
        result = await proxy_call(req)
        return True, result
    except HTTPException as e:
        return False, {"error": e.detail}
    except Exception as e:  # noqa: BLE001
        return False, {"error": str(e)}


# ---------------------------------------------------------------------------
# Workflow-tool mode: build the compact, DEFERRED (progressive-disclosure)
# tool surface from a source's workflows, plus the two meta tools
# (search_operations / describe_operation). Mirrors app/mcp_server.py.
# ---------------------------------------------------------------------------
SEARCH_OPERATIONS_DEF = {
    "name": "search_operations",
    "description": (
        "Search this source's workflow operations by keyword (matches operation_id, "
        "summary, path, method). Returns up to 10 hits with their workflow_id, method, "
        "and path. Use this FIRST to find the right operation before calling a wf_* "
        "workflow tool."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Keywords to search for, e.g. 'ability score wisdom'."}
        },
        "required": ["query"],
    },
}

DESCRIBE_OPERATION_DEF = {
    "name": "describe_operation",
    "description": (
        "Return the full input schema (path/query/body params) for a single operation "
        "plus its owning workflow_id. Call after search_operations to learn exactly what "
        "params an operation needs before calling the workflow tool."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "operation_id": {"type": "string", "description": "The operation_id to describe."}
        },
        "required": ["operation_id"],
    },
}

WORKFLOW_SYSTEM_PROMPT = (
    "You are an API agent operating over compact, workflow-level tools (progressive "
    "disclosure). Each wf_* tool covers a whole capability cluster and takes an "
    "'operation' selector plus optional path_params/query_params/body. The wf_* tool "
    "descriptions do NOT list their operations — to discover a specific operation, call "
    "search_operations(query) to find candidates, then describe_operation(operation_id) "
    "for its exact input schema. Then call the owning wf_* tool, passing that operation_id "
    "as 'operation' with the required params. After results return, answer the user "
    "concisely from the real data. If a tool errors, explain what went wrong."
)


def build_workflow_catalog(source_id: str) -> tuple[list[dict], dict]:
    """Returns (tool_defs, registry) for workflow mode.

    tool_defs: deferred (catalog-free) wf_* tool schemas + search_operations +
               describe_operation. This is the small progressive-disclosure surface.
    registry:  name -> {"kind": "workflow"|"meta", "source_id": ...}
    """
    storage = load_storage()
    src = (storage.get("sources") or {}).get(source_id)
    if not src:
        raise HTTPException(status_code=404, detail=f"Source '{source_id}' not found.")
    workflows = (storage.get("workflow_defs") or {}).get(source_id) or cluster_source(src)

    tool_defs: list[dict] = []
    registry: dict[str, dict] = {}
    for wf in workflows:
        schema = workflow_tool_schema(wf, defer_catalog=True)
        tool_defs.append(schema)
        registry[schema["name"]] = {"kind": "workflow", "source_id": source_id}

    for meta in (SEARCH_OPERATIONS_DEF, DESCRIBE_OPERATION_DEF):
        tool_defs.append(meta)
        registry[meta["name"]] = {"kind": "meta", "source_id": source_id}

    return tool_defs, registry


# ---------------------------------------------------------------------------
# 1:∞ layer — multi-API workflow mode. One agent surface fronting ALL ingested
# sources at once, with the SAME small deferred token cost: every source's
# workflows are exposed as namespaced (<source_slug>__<wf_id>) deferred tools
# plus TWO GLOBAL meta tools that search/describe across all sources. Adding a
# 5th/50th API barely grows the tool-definition tokens (catalogs stay deferred).
# ---------------------------------------------------------------------------
GLOBAL_SEARCH_OPERATIONS_DEF = {
    "name": "search_operations",
    "description": (
        "Search workflow operations across ALL ingested API sources by keyword "
        "(matches operation_id, summary, path, method, source). Returns up to 10 "
        "hits, each with its source_id, the EXACT namespaced workflow tool name to "
        "call ('tool_name'), operation_id, method, and path. Use this FIRST to locate "
        "the right operation across every source, then call the returned tool_name "
        "passing operation_id as 'operation'."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Keywords to search for, e.g. 'ability score wisdom'."}
        },
        "required": ["query"],
    },
}

GLOBAL_DESCRIBE_OPERATION_DEF = {
    "name": "describe_operation",
    "description": (
        "Return the full input schema (path/query/body params) for a single operation "
        "resolved across ALL sources, plus its source_id, owning workflow_id, and the "
        "namespaced tool_name to call. Pass source_id only to disambiguate; omit it to "
        "resolve across every source."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "operation_id": {"type": "string", "description": "The operation_id to describe."},
            "source_id": {"type": "string", "description": "Optional: restrict to one source."},
        },
        "required": ["operation_id"],
    },
}

GLOBAL_WORKFLOW_SYSTEM_PROMPT = (
    "You are an API agent fronting MANY APIs at once through compact, workflow-level "
    "tools (progressive disclosure). Each tool is namespaced '<source>__<workflow>' and "
    "covers a whole capability cluster; it takes an 'operation' selector plus optional "
    "path_params/query_params/body. The tool descriptions do NOT list their operations. "
    "To find a specific operation ACROSS ALL sources, call search_operations(query); each "
    "hit gives you the exact 'tool_name' to call and its 'operation_id'. Use "
    "describe_operation(operation_id) for the exact input schema. Then call that namespaced "
    "tool, passing the operation_id as 'operation' with the required params. After results "
    "return, answer the user concisely from the real data. If a tool errors, explain why."
)

# Generic executor used when the namespaced tool set exceeds a provider's tool cap.
# This is the FLATTEST possible 1:∞ surface: 3 tools total (2 meta + this executor)
# regardless of how many APIs are ingested — proving truly flat token cost.
EXECUTE_WORKFLOW_DEF = {
    "name": "execute_workflow",
    "description": (
        "Execute one operation on any ingested API. Pass 'tool_name' (the namespaced "
        "'<source>__<workflow>' name returned by search_operations) and 'operation' (the "
        "operation_id), plus optional path_params/query_params/body. Use search_operations "
        "first to get the tool_name + operation_id, then call this."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "tool_name": {"type": "string", "description": "Namespaced workflow tool name from search_operations."},
            "operation": {"type": "string", "description": "operation_id to run."},
            "path_params": {"type": "object", "description": "Path parameter substitutions."},
            "query_params": {"type": "object", "description": "Query string parameters."},
            "body": {"type": "object", "description": "Request body for write operations."},
        },
        "required": ["tool_name", "operation"],
    },
}

GLOBAL_WORKFLOW_FLAT_SYSTEM_PROMPT = (
    "You are an API agent fronting MANY APIs at once (the 1:∞ layer). You have just THREE "
    "tools regardless of how many APIs exist: search_operations(query) to find an operation "
    "across ALL sources (returns the namespaced 'tool_name' + 'operation_id'), "
    "describe_operation(operation_id) for its exact input schema, and execute_workflow(...) "
    "to run it. Workflow: search_operations -> (optionally describe_operation) -> "
    "execute_workflow(tool_name=<from search>, operation=<operation_id>, params...). After "
    "results return, answer concisely from the real data. If a tool errors, explain why."
)

# Provider tool-definition caps (per request). Above this, switch to the flat
# 3-tool executor surface so the live run still works AND token cost stays flat.
PROVIDER_TOOL_CAP = {"groq": 128, "ollama": 128}


def build_workflow_catalog_all() -> tuple[list[dict], dict]:
    """Returns (tool_defs, registry) for MULTI-API workflow mode (source_id == __all__).

    Iterates every source's workflows, exposes each as a namespaced deferred tool
    `<source_slug>__<wf_id>` (sanitized, unique, ≤64), and adds the two GLOBAL meta
    tools. registry maps name -> {"kind":"workflow","source_id","workflow_id"} or
    {"kind":"meta_global"}.
    """
    storage = load_storage()
    sources = storage.get("sources") or {}
    tool_defs: list[dict] = []
    registry: dict[str, dict] = {}
    taken: set[str] = set()

    for sid, src in sources.items():
        workflows = (storage.get("workflow_defs") or {}).get(sid) or cluster_source(src)
        for wf in workflows:
            schema = workflow_tool_schema(wf, defer_catalog=True)
            name = namespaced_tool_name(sid, wf["id"], taken)
            schema = {**schema, "name": name}
            tool_defs.append(schema)
            registry[name] = {"kind": "workflow", "source_id": sid, "workflow_id": wf["id"]}

    for meta in (GLOBAL_SEARCH_OPERATIONS_DEF, GLOBAL_DESCRIBE_OPERATION_DEF):
        tool_defs.append(meta)
        registry[meta["name"]] = {"kind": "meta_global"}

    return tool_defs, registry


def build_workflow_catalog_all_flat() -> tuple[list[dict], dict]:
    """FLAT 1:∞ surface for providers that cap tool definitions per request.

    Exposes only 3 tool DEFINITIONS (search_operations, describe_operation,
    execute_workflow) so the sent-tool token cost is constant regardless of how
    many APIs are ingested. The full namespaced registry is still built so the
    generic executor can resolve any tool_name -> {source_id, workflow_id}.
    """
    # reuse the full builder to get the namespaced resolution registry,
    # then drop the per-workflow tool DEFINITIONS (keep registry entries).
    full_defs, registry = build_workflow_catalog_all()
    # registry already maps namespaced names -> {kind: workflow, source_id, workflow_id}
    # and the two meta names -> {kind: meta_global}. Add the executor.
    registry[EXECUTE_WORKFLOW_DEF["name"]] = {"kind": "executor_global"}
    tool_defs = [GLOBAL_SEARCH_OPERATIONS_DEF, GLOBAL_DESCRIBE_OPERATION_DEF, EXECUTE_WORKFLOW_DEF]
    return tool_defs, registry


# ---------------------------------------------------------------------------
# Feature 2 — Chat auto-workflow-assigner (token-minimizing per-message router).
# Instead of sending EVERY workflow tool (the __all__ surface), we route on the
# user's message FIRST (deterministic keyword ranking, NO extra LLM) and build a
# task-tailored catalog: ONLY the top-K relevant workflow tools (deferred) + the
# two GLOBAL meta tools. The model sees ~3-5 tools tailored to the task → minimal
# tokens AND sharper tool selection. Falls back to the flat all-APIs surface if
# routing finds nothing.
# ---------------------------------------------------------------------------
GLOBAL_WORKFLOW_AUTO_SYSTEM_PROMPT = (
    "You are an API agent. For THIS request a deterministic router has pre-selected the "
    "few workflow tools most relevant to the user's message (token-minimizing routing). "
    "Each tool is namespaced '<source>__<workflow>', covers a capability cluster, and "
    "takes an 'operation' selector plus optional path_params/query_params/body. The tool "
    "descriptions do NOT list their operations. To find the exact operation, call "
    "search_operations(query) — each hit gives the exact 'tool_name' to call and its "
    "'operation_id' — then optionally describe_operation(operation_id) for the input "
    "schema. Then call that namespaced tool, passing operation_id as 'operation' with the "
    "required params. The pre-selected tools usually suffice; only use search_operations if "
    "they don't fit. After results return, answer the user concisely from the real data. "
    "If a tool errors, explain why."
)


def build_workflow_catalog_auto(message: str, k: int = 3) -> tuple[list[dict], dict, dict]:
    """Returns (tool_defs, registry, route) for AUTO (task-routed) workflow mode.

    Routes on the message across ALL sources, then exposes ONLY the top-K matched
    workflow tools (namespaced, deferred) plus the two GLOBAL meta tools. The
    registry resolves those routed names AND every meta tool. `route` is the raw
    router result (terms + routed workflows) for the start-event trace.

    If routing finds nothing, returns ([], {}, route) so the caller can fall back
    to the full flat all-APIs surface.
    """
    route = wf_route_workflows(message, k=k)
    routed = route.get("routed") or []

    tool_defs: list[dict] = []
    registry: dict[str, dict] = {}

    storage = load_storage()
    for r in routed:
        sid = r["source_id"]
        wf_id = r["workflow_id"]
        name = r["tool_name"]
        src = (storage.get("sources") or {}).get(sid)
        if not src:
            continue
        workflows = (storage.get("workflow_defs") or {}).get(sid) or cluster_source(src)
        wf = next((w for w in workflows if w["id"] == wf_id), None)
        if not wf:
            continue
        schema = {**workflow_tool_schema(wf, defer_catalog=True), "name": name}
        tool_defs.append(schema)
        registry[name] = {"kind": "workflow", "source_id": sid, "workflow_id": wf_id}

    if tool_defs:
        # add the two GLOBAL meta tools as a fallback discovery path
        for meta in (GLOBAL_SEARCH_OPERATIONS_DEF, GLOBAL_DESCRIBE_OPERATION_DEF):
            tool_defs.append(meta)
            registry[meta["name"]] = {"kind": "meta_global"}

    return tool_defs, registry, route


async def _execute_workflow_tool(name: str, args: dict, registry: dict) -> tuple[bool, Any]:
    """Dispatch a workflow-mode tool call to the workflow endpoints.

    Handles BOTH single-source mode (kind: workflow|meta, name == wf_* id) and
    multi-API mode (kind: workflow with explicit workflow_id, or meta_global).
    """
    meta = registry.get(name)
    if not meta:
        return False, {"error": f"Unknown tool '{name}'."}
    args = args or {}
    kind = meta.get("kind")
    try:
        # ---- global meta tools (multi-API mode) ----
        if kind == "meta_global":
            if name == "search_operations":
                return True, wf_search_all_sources(query=str(args.get("query", "")))
            if name == "describe_operation":
                return True, wf_describe_operation_any(
                    operation_id=str(args.get("operation_id", "")),
                    source_id=(str(args["source_id"]) if args.get("source_id") else None),
                )
            return False, {"error": f"Unknown global meta tool '{name}'."}

        # ---- generic executor (flat multi-API surface) ----
        if kind == "executor_global":
            tool_name = str(args.get("tool_name", ""))
            target = registry.get(tool_name)
            if not target or target.get("kind") != "workflow":
                return False, {"error": f"Unknown tool_name '{tool_name}'. Use search_operations to get a valid tool_name."}
            req = WorkflowExecRequest(
                source_id=target["source_id"],
                workflow_id=target["workflow_id"],
                operation=str(args.get("operation", "")),
                path_params=args.get("path_params") or {},
                query_params=args.get("query_params") or {},
                body=args.get("body") or {},
            )
            return True, await execute_workflow(req)

        # ---- single-source meta tools ----
        if kind == "meta":
            sid = meta["source_id"]
            if name == "search_operations":
                return True, wf_search_operations(source_id=sid, query=str(args.get("query", "")))
            if name == "describe_operation":
                return True, wf_describe_operation(source_id=sid, operation_id=str(args.get("operation_id", "")))
            return False, {"error": f"Unknown meta tool '{name}'."}

        # ---- workflow tool: resolve source_id + workflow_id ----
        sid = meta["source_id"]
        # multi-API names are namespaced -> workflow_id is in the registry;
        # single-source names ARE the wf_* id.
        workflow_id = meta.get("workflow_id", name)
        req = WorkflowExecRequest(
            source_id=sid,
            workflow_id=workflow_id,
            operation=str(args.get("operation", "")),
            path_params=args.get("path_params") or {},
            query_params=args.get("query_params") or {},
            body=args.get("body") or {},
        )
        result = await execute_workflow(req)
        return True, result
    except HTTPException as e:
        return False, {"error": e.detail}
    except Exception as e:  # noqa: BLE001
        return False, {"error": str(e)}


def _parse_retry_after(resp: "httpx.Response") -> float:
    """Best-effort retry delay (seconds) from a 429 response: Retry-After header
    first, else the 'try again in 25.7s' hint Groq embeds in the error body."""
    ra = resp.headers.get("retry-after")
    if ra:
        try:
            return float(ra)
        except ValueError:
            pass
    m = re.search(r"try again in ([\d.]+)\s*s", resp.text or "")
    if m:
        try:
            return float(m.group(1)) + 1.0
        except ValueError:
            pass
    return 20.0


def _truncate(obj: Any) -> str:
    s = json.dumps(obj) if not isinstance(obj, str) else obj
    if len(s) > MAX_TOOL_RESULT_CHARS:
        return s[:MAX_TOOL_RESULT_CHARS] + f"… [truncated, {len(s)} chars total]"
    return s


# ---------------------------------------------------------------------------
# Provider loops — each is an async generator yielding trace-event dicts
# ---------------------------------------------------------------------------
async def run_claude(
    model: str,
    message: str,
    tool_defs: list,
    registry: dict,
    tool_runner=_execute_tool,
    system_prompt: str = SYSTEM_PROMPT,
) -> AsyncIterator[dict]:
    if not ANTHROPIC_API_KEY:
        yield {"type": "error", "message": "ANTHROPIC_API_KEY is not set. Add it to compiler/.env."}
        return

    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    tools = [
        {"name": t["name"], "description": t["description"], "input_schema": t["input_schema"]}
        for t in tool_defs
    ]
    messages: list[dict] = [{"role": "user", "content": message}]
    tin = tout = tcache = turn = 0

    async with httpx.AsyncClient(timeout=120.0) as client:
        for _ in range(MAX_TURNS):
            payload = {
                "model": model,
                "max_tokens": 2048,
                "system": system_prompt,
                "messages": messages,
            }
            if tools:
                payload["tools"] = tools
            resp = await client.post(
                "https://api.anthropic.com/v1/messages", headers=headers, json=payload
            )
            if resp.status_code >= 400:
                yield {"type": "error", "message": f"Anthropic {resp.status_code}: {resp.text[:400]}"}
                return
            data = resp.json()
            turn += 1
            u = data.get("usage") or {}
            tin += u.get("input_tokens", 0) or 0
            tout += u.get("output_tokens", 0) or 0
            tcache += u.get("cache_read_input_tokens", 0) or 0
            yield {
                "type": "usage",
                "input_tokens": tin,
                "output_tokens": tout,
                "cached_tokens": tcache,
                "total_tokens": tin + tout,
                "turns": turn,
            }
            content = data.get("content", [])
            tool_uses = [b for b in content if b.get("type") == "tool_use"]

            for b in content:
                if b.get("type") == "text" and b.get("text"):
                    yield {"type": "assistant", "text": b["text"]}

            if data.get("stop_reason") != "tool_use" or not tool_uses:
                yield {"type": "done"}
                return

            messages.append({"role": "assistant", "content": content})
            tool_results = []
            for tu in tool_uses:
                yield {"type": "tool_call", "name": tu["name"], "args": tu.get("input", {})}
                t0 = time.time()
                ok, out = await tool_runner(tu["name"], tu.get("input", {}), registry)
                yield {
                    "type": "tool_result",
                    "name": tu["name"],
                    "ok": ok,
                    "duration_ms": int((time.time() - t0) * 1000),
                    "preview": _truncate(out)[:800],
                }
                tool_results.append(
                    {"type": "tool_result", "tool_use_id": tu["id"], "content": _truncate(out)}
                )
            messages.append({"role": "user", "content": tool_results})

        yield {"type": "done"}


async def _run_openai_compat(
    base_url: str,
    api_key: str,
    model: str,
    message: str,
    tool_defs: list,
    registry: dict,
    tool_runner=_execute_tool,
    system_prompt: str = SYSTEM_PROMPT,
) -> AsyncIterator[dict]:
    headers = {"content-type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    tools = [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["input_schema"],
            },
        }
        for t in tool_defs
    ]
    messages: list[dict] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": message},
    ]

    tin = tout = tcache = turn = 0
    async with httpx.AsyncClient(timeout=120.0) as client:
        for _ in range(MAX_TURNS):
            payload: dict[str, Any] = {"model": model, "messages": messages}
            if tools:
                payload["tools"] = tools
                payload["tool_choice"] = "auto"
            resp = await client.post(
                f"{base_url}/chat/completions", headers=headers, json=payload
            )
            # Bounded backoff on provider rate limits (e.g. Groq free-tier TPM).
            # Additive: retries the SAME request; trace/usage shapes are unchanged.
            rl_retries = 0
            while resp.status_code == 429 and rl_retries < 3:
                wait_s = _parse_retry_after(resp)
                yield {"type": "assistant", "text": f"⏳ Rate limited; retrying in {int(wait_s)}s…"}
                import asyncio
                await asyncio.sleep(min(wait_s, 60.0))
                rl_retries += 1
                resp = await client.post(
                    f"{base_url}/chat/completions", headers=headers, json=payload
                )
            if resp.status_code >= 400:
                yield {"type": "error", "message": f"{base_url} {resp.status_code}: {resp.text[:400]}"}
                return
            data = resp.json()
            turn += 1
            u = data.get("usage") or {}
            tin += u.get("prompt_tokens", 0) or 0
            tout += u.get("completion_tokens", 0) or 0
            tcache += (u.get("prompt_tokens_details") or {}).get("cached_tokens", 0) or 0
            yield {
                "type": "usage",
                "input_tokens": tin,
                "output_tokens": tout,
                "cached_tokens": tcache,
                "total_tokens": tin + tout,
                "turns": turn,
            }
            choice = (data.get("choices") or [{}])[0]
            msg = choice.get("message", {})
            tool_calls = msg.get("tool_calls") or []

            if msg.get("content"):
                yield {"type": "assistant", "text": msg["content"]}

            if not tool_calls:
                yield {"type": "done"}
                return

            messages.append(msg)
            for tc in tool_calls:
                fn = tc.get("function", {})
                name = fn.get("name", "")
                # Groq gpt-oss (harmony format) sometimes leaks control tokens into
                # the tool name, e.g. "search_operations<|channel|>commentary".
                # Strip anything from the first non-tool-name character onward.
                if name:
                    name = re.split(r"[<|]", name, 1)[0].strip()
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except Exception:
                    args = {}
                yield {"type": "tool_call", "name": name, "args": args}
                t0 = time.time()
                ok, out = await tool_runner(name, args, registry)
                yield {
                    "type": "tool_result",
                    "name": name,
                    "ok": ok,
                    "duration_ms": int((time.time() - t0) * 1000),
                    "preview": _truncate(out)[:800],
                }
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.get("id", name),
                        "content": _truncate(out),
                    }
                )

        yield {"type": "done"}


# ---------------------------------------------------------------------------
# Provider discovery
# ---------------------------------------------------------------------------
async def _discover_groq_models() -> list[str]:
    if not GROQ_API_KEY:
        return GROQ_DEFAULT_MODELS
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(
                "https://api.groq.com/openai/v1/models",
                headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
            )
            if r.status_code == 200:
                ids = sorted(m["id"] for m in r.json().get("data", []) if m.get("id"))
                return ids or GROQ_DEFAULT_MODELS
    except Exception:
        pass
    return GROQ_DEFAULT_MODELS


async def _discover_ollama_models() -> tuple[bool, list[str]]:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            if r.status_code == 200:
                names = [m["name"] for m in r.json().get("models", []) if m.get("name")]
                return True, names
    except Exception:
        pass
    return False, []


@router.get("/providers")
async def list_providers():
    groq_models = await _discover_groq_models()
    ollama_up, ollama_models = await _discover_ollama_models()
    return {
        "providers": [
            {
                "id": "claude",
                "label": "Claude (Anthropic)",
                "available": bool(ANTHROPIC_API_KEY),
                "needs_key": not bool(ANTHROPIC_API_KEY),
                "models": CLAUDE_MODELS,
                "default_model": "claude-sonnet-4-6",
            },
            {
                "id": "groq",
                "label": "Groq",
                "available": bool(GROQ_API_KEY),
                "needs_key": not bool(GROQ_API_KEY),
                "models": groq_models,
                "default_model": GROQ_DEFAULT_MODEL
                if GROQ_DEFAULT_MODEL in groq_models
                else (groq_models[0] if groq_models else GROQ_DEFAULT_MODEL),
            },
            {
                "id": "ollama",
                "label": "Ollama (local)",
                "available": ollama_up and bool(ollama_models),
                "needs_key": False,
                "reachable": ollama_up,
                "models": ollama_models,
                "default_model": ollama_models[0] if ollama_models else "",
            },
        ]
    }


def _resolve_auto() -> tuple[str, str]:
    if ANTHROPIC_API_KEY:
        return "claude", "claude-sonnet-4-6"
    if GROQ_API_KEY:
        return "groq", GROQ_DEFAULT_MODEL
    return "ollama", ""


# ---------------------------------------------------------------------------
# /run — streamed agent loop
# ---------------------------------------------------------------------------
class AgentRunRequest(BaseModel):
    provider: str
    model: str = ""
    # toolset_id is required only in the default ("toolset") mode.
    toolset_id: str = ""
    message: str
    # mode selects the tool surface: "toolset" (raw curated endpoints, default)
    # or "workflow" (compact deferred workflow-level tools + progressive disclosure).
    mode: str = "toolset"
    source_id: str = ""  # required when mode == "workflow"
    # history is accepted but the loop currently runs single-turn per request
    history: list[dict] = []


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


@router.get("/workflow-sources")
async def workflow_sources():
    """List ingested sources with their workflow tool count, so the UI can populate
    a source dropdown for workflow mode."""
    storage = load_storage()
    out = []
    total_wf = total_raw = 0
    for sid, src in (storage.get("sources") or {}).items():
        workflows = (storage.get("workflow_defs") or {}).get(sid) or cluster_source(src)
        total_wf += len(workflows)
        total_raw += len(src.get("tools", {}))
        out.append({
            "source_id": sid,
            "base_url": src.get("base_url", ""),
            "raw_tools": len(src.get("tools", {})),
            "workflow_count": len(workflows),
        })
    # Aggregate entry for the 1:∞ "All APIs" dropdown choice. The agent surface
    # in __all__ mode is (sum of workflow tools) + 2 global meta tools.
    return {
        "sources": out,
        "all": {
            "source_id": "__all__",
            "source_count": len(out),
            "raw_tools": total_raw,
            "workflow_count": total_wf,
            "agent_tool_count": total_wf + 2,
        },
    }


@router.post("/run")
async def run_agent(req: AgentRunRequest):
    mode = (req.mode or "toolset").lower()

    provider = req.provider
    model = req.model
    if provider == "auto":
        provider, auto_model = _resolve_auto()
        model = model or auto_model

    # full_tool_count is the true 1:∞ aggregate surface (namespaced tools + meta),
    # reported even when we fall back to the flat executor for a capped provider.
    full_tool_count = None
    surface = mode
    routed_workflows: list[str] | None = None  # set in __auto__ mode for the start event
    route_info: dict | None = None

    if mode == "workflow":
        # ── Feature 2: AUTO (task-routed) mode — source_id == "__auto__". Route on
        # the message FIRST, then send ONLY the top-K relevant workflow tools + the
        # 2 global meta tools. Minimal tokens + sharper tool selection. ──
        if req.source_id == "__auto__":
            # the true aggregate (all namespaced tools + 2 meta) for the headline
            _all_defs, _ = build_workflow_catalog_all()
            full_tool_count = len(_all_defs)
            tool_defs, registry, route_info = build_workflow_catalog_auto(req.message)
            if tool_defs:
                routed_workflows = [r["tool_name"] for r in (route_info.get("routed") or [])]
                tool_runner = _execute_workflow_tool
                system_prompt = GLOBAL_WORKFLOW_AUTO_SYSTEM_PROMPT
                surface = "workflow_auto"
            else:
                # routing found nothing — fall back to the flat all-APIs surface
                tool_defs, registry = build_workflow_catalog_all_flat()
                tool_runner = _execute_workflow_tool
                system_prompt = GLOBAL_WORKFLOW_FLAT_SYSTEM_PROMPT
                surface = "workflow_auto_fallback"
        # Multi-API (1:∞) mode when source_id is empty/missing/"__all__":
        # front EVERY source at once with namespaced deferred tools + global meta.
        elif not req.source_id or req.source_id == "__all__":
            tool_defs, registry = build_workflow_catalog_all()
            full_tool_count = len(tool_defs)
            cap = PROVIDER_TOOL_CAP.get(provider)
            if cap is not None and len(tool_defs) > cap:
                # Provider caps tools/request — switch to the FLAT 3-tool executor
                # surface. Registry still resolves every namespaced tool_name, so
                # the agent can reach all APIs; sent-token cost is now constant.
                tool_defs, registry = build_workflow_catalog_all_flat()
                system_prompt = GLOBAL_WORKFLOW_FLAT_SYSTEM_PROMPT
                surface = "workflow_all_flat"
            else:
                system_prompt = GLOBAL_WORKFLOW_SYSTEM_PROMPT
                surface = "workflow_all"
            tool_runner = _execute_workflow_tool
        else:
            tool_defs, registry = build_workflow_catalog(req.source_id)
            tool_runner = _execute_workflow_tool
            system_prompt = WORKFLOW_SYSTEM_PROMPT
    else:
        storage = load_storage()
        toolset = (storage.get("toolsets") or {}).get(req.toolset_id)
        if not toolset:
            raise HTTPException(status_code=404, detail=f"Toolset '{req.toolset_id}' not found.")
        tool_defs, registry = build_catalog(toolset)
        tool_runner = _execute_tool
        system_prompt = SYSTEM_PROMPT

    async def event_stream() -> AsyncIterator[str]:
        start_ev = {
            "type": "start",
            "provider": provider,
            "model": model,
            "mode": mode,
            "surface": surface,
            "tool_count": len(tool_defs),
        }
        # When flattened for a capped provider, expose the true aggregate too so
        # the UI/metrics still show the 1:∞ headline (e.g. 133) alongside the
        # 3 definitions actually sent.
        if full_tool_count is not None:
            start_ev["aggregate_tool_count"] = full_tool_count
        # Feature 2 (auto mode): surface which workflows were auto-assigned for
        # this message + the router's content terms, so the UI can show the tiny
        # tailored surface vs the large aggregate.
        if routed_workflows is not None:
            start_ev["routed_workflows"] = routed_workflows
            if route_info is not None:
                start_ev["route_terms"] = route_info.get("terms") or []
                start_ev["routed_detail"] = [
                    {"tool_name": r["tool_name"], "workflow_id": r["workflow_id"],
                     "source_id": r["source_id"], "name": r.get("name"),
                     "score": r.get("score")}
                    for r in (route_info.get("routed") or [])
                ]
            print(f"[auto-router] message={req.message!r} terms={start_ev.get('route_terms')} "
                  f"assigned={routed_workflows} sent_tools={start_ev['tool_count']} "
                  f"aggregate={full_tool_count}", flush=True)
        yield _sse(start_ev)
        try:
            if provider == "claude":
                gen = run_claude(
                    model or "claude-sonnet-4-6", req.message, tool_defs, registry,
                    tool_runner=tool_runner, system_prompt=system_prompt,
                )
            elif provider == "groq":
                gen = _run_openai_compat(
                    "https://api.groq.com/openai/v1",
                    GROQ_API_KEY,
                    model or GROQ_DEFAULT_MODEL,
                    req.message,
                    tool_defs,
                    registry,
                    tool_runner=tool_runner,
                    system_prompt=system_prompt,
                )
            elif provider == "ollama":
                gen = _run_openai_compat(
                    f"{OLLAMA_BASE_URL}/v1", "", model, req.message, tool_defs, registry,
                    tool_runner=tool_runner, system_prompt=system_prompt,
                )
            else:
                yield _sse({"type": "error", "message": f"Unknown provider '{provider}'."})
                return

            async for event in gen:
                yield _sse(event)
        except Exception as e:  # noqa: BLE001
            yield _sse({"type": "error", "message": str(e)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
