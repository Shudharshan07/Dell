"""
Toolset companion resources: Environments, Prompts, Custom Tools, plus generated
MCP connection config and SDK snippets.

Modeled on how platforms like Speakeasy's Gram structure a toolset:
  - Environments  : named sets of variables/secrets (API keys, base-url overrides)
                    kept separate from toolset logic.
  - Prompts       : reusable prompt templates exposed alongside the tools (MCP prompts).
  - Custom Tools  : higher-order tools composed from one or more existing operations.
  - MCP           : connection config to consume the toolset from an MCP client.
  - SDK           : ready-to-run client snippets for the toolset's tools.

Environments / Prompts / Custom Tools are persisted per-toolset in local storage.
MCP config and SDK are derived/generated on read.
"""
import re
import json
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.storage import load_storage, save_storage

router = APIRouter(prefix="/api/v1")

# storage buckets keyed by toolset_id -> list[item]
_BUCKETS = ("environments", "prompts", "custom_tools")


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9_-]", "-", str(name).lower()).strip("-") or "item"


_VAR_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}")


def detect_variables(template: str) -> list[str]:
    """Parse a prompt template for {{variable}} tokens, preserving first-seen order."""
    seen: list[str] = []
    for m in _VAR_RE.finditer(template or ""):
        v = m.group(1)
        if v not in seen:
            seen.append(v)
    return seen


def render_template(template: str, values: dict) -> str:
    """Fill {{variable}} tokens from values; leave unknown tokens intact."""
    def repl(m):
        key = m.group(1)
        return str(values[key]) if key in (values or {}) else m.group(0)
    return _VAR_RE.sub(repl, template or "")


def _bucket(storage: dict, bucket: str, toolset_id: str) -> list:
    storage.setdefault(bucket, {})
    storage[bucket].setdefault(toolset_id, [])
    return storage[bucket][toolset_id]


def _require_toolset(storage: dict, toolset_id: str) -> dict:
    ts = (storage.get("toolsets") or {}).get(toolset_id)
    if not ts:
        raise HTTPException(status_code=404, detail=f"Toolset '{toolset_id}' not found.")
    return ts


def _new_id(items: list, name: str) -> str:
    base = _slug(name)
    existing = {i["id"] for i in items}
    if base not in existing:
        return base
    n = 2
    while f"{base}-{n}" in existing:
        n += 1
    return f"{base}-{n}"


# ---------------------------------------------------------------------------
# Generic per-toolset collection CRUD (environments / prompts / custom_tools)
# ---------------------------------------------------------------------------
class EnvironmentItem(BaseModel):
    name: str
    variables: dict[str, Any] = {}


class PromptItem(BaseModel):
    name: str
    description: str = ""
    content: str = ""


class CustomToolItem(BaseModel):
    name: str
    description: str = ""
    steps: list[str] = []  # ordered operation_ids drawn from the toolset


def _list(bucket: str, toolset_id: str):
    storage = load_storage()
    _require_toolset(storage, toolset_id)
    return _bucket(storage, bucket, toolset_id)


def _create(bucket: str, toolset_id: str, payload: dict):
    storage = load_storage()
    _require_toolset(storage, toolset_id)
    items = _bucket(storage, bucket, toolset_id)
    item = {"id": _new_id(items, payload.get("name", bucket)), **payload}
    items.append(item)
    save_storage(storage)
    return item


def _delete(bucket: str, toolset_id: str, item_id: str):
    storage = load_storage()
    _require_toolset(storage, toolset_id)
    items = _bucket(storage, bucket, toolset_id)
    new_items = [i for i in items if i["id"] != item_id]
    if len(new_items) == len(items):
        raise HTTPException(status_code=404, detail=f"'{item_id}' not found.")
    storage[bucket][toolset_id] = new_items
    save_storage(storage)
    return {"status": "deleted", "id": item_id}


# Environments
@router.get("/toolsets/{toolset_id}/environments")
def list_environments(toolset_id: str):
    return {"environments": _list("environments", toolset_id)}


@router.post("/toolsets/{toolset_id}/environments")
def create_environment(toolset_id: str, item: EnvironmentItem):
    return _create("environments", toolset_id, item.model_dump())


@router.delete("/toolsets/{toolset_id}/environments/{item_id}")
def delete_environment(toolset_id: str, item_id: str):
    return _delete("environments", toolset_id, item_id)


# Prompts
@router.get("/toolsets/{toolset_id}/prompts")
def list_prompts(toolset_id: str):
    return {"prompts": _list("prompts", toolset_id)}


@router.post("/toolsets/{toolset_id}/prompts")
def create_prompt(toolset_id: str, item: PromptItem):
    payload = item.model_dump()
    payload["variables"] = detect_variables(payload.get("content", ""))
    return _create("prompts", toolset_id, payload)


class PromptRenderRequest(BaseModel):
    content: str
    values: dict[str, Any] = {}


@router.post("/prompts/render")
def render_prompt(req: PromptRenderRequest):
    """Detect {{variables}} in a template and render a live preview with values.
    Used by the Prompts page for live preview + Send-to-Playground."""
    variables = detect_variables(req.content)
    return {
        "variables": variables,
        "missing": [v for v in variables if v not in (req.values or {})],
        "rendered": render_template(req.content, req.values),
    }


@router.delete("/toolsets/{toolset_id}/prompts/{item_id}")
def delete_prompt(toolset_id: str, item_id: str):
    return _delete("prompts", toolset_id, item_id)


# Custom tools
@router.get("/toolsets/{toolset_id}/custom-tools")
def list_custom_tools(toolset_id: str):
    return {"custom_tools": _list("custom_tools", toolset_id)}


@router.post("/toolsets/{toolset_id}/custom-tools")
def create_custom_tool(toolset_id: str, item: CustomToolItem):
    return _create("custom_tools", toolset_id, item.model_dump())


@router.delete("/toolsets/{toolset_id}/custom-tools/{item_id}")
def delete_custom_tool(toolset_id: str, item_id: str):
    return _delete("custom_tools", toolset_id, item_id)


# ---------------------------------------------------------------------------
# MCP connection config (derived)
# ---------------------------------------------------------------------------
@router.get("/toolsets/{toolset_id}/mcp-config")
def mcp_config(toolset_id: str):
    storage = load_storage()
    ts = _require_toolset(storage, toolset_id)
    selected = [t for t in ts.get("tools", []) if t.get("selected")]
    sse_url = "http://localhost:8002/sse"
    claude_desktop = {
        "mcpServers": {
            f"gram-{toolset_id}": {
                "command": "npx",
                "args": ["-y", "mcp-remote", sse_url],
            }
        }
    }
    cursor = {"mcpServers": {f"gram-{toolset_id}": {"url": sse_url}}}
    return {
        "toolset_id": toolset_id,
        "tool_count": len(selected),
        "sse_url": sse_url,
        "fastmcp_command": "fastmcp run app/mcp_server.py --transport sse --port 8002",
        "claude_desktop_config": claude_desktop,
        "cursor_config": cursor,
    }


# ---------------------------------------------------------------------------
# SDK snippet generation (derived)
# ---------------------------------------------------------------------------
def _resolve_tool_source(storage: dict, tool: dict) -> str:
    sid = tool.get("source_id")
    if sid:
        return sid
    op = tool.get("id")
    for s_id, data in (storage.get("sources") or {}).items():
        if op in (data.get("tools") or {}):
            return s_id
    return ""


@router.get("/toolsets/{toolset_id}/sdk")
def generate_sdk(toolset_id: str, lang: str = "python"):
    storage = load_storage()
    ts = _require_toolset(storage, toolset_id)
    selected = [t for t in ts.get("tools", []) if t.get("selected")]
    proxy = "http://localhost:8000/api/v1/proxy/call"

    def example(tool):
        sid = _resolve_tool_source(storage, tool)
        return sid, tool.get("id"), tool.get("method", "GET"), tool.get("path", "/")

    if lang == "python":
        lines = [
            "import httpx",
            "",
            "PROXY = \"%s\"" % proxy,
            "",
            "def call(source_id, operation_id, path_params=None, query_params=None, body=None):",
            "    r = httpx.post(PROXY, json={",
            "        \"source_id\": source_id, \"operation_id\": operation_id,",
            "        \"path_params\": path_params or {}, \"query_params\": query_params or {},",
            "        \"body\": body or {},",
            "    }, timeout=30)",
            "    return r.json()",
            "",
            f"# Tools in toolset '{toolset_id}':",
        ]
        for t in selected:
            sid, op, method, path = example(t)
            lines.append(f"# {method} {path}")
            lines.append(f"result = call({sid!r}, {op!r})")
        code = "\n".join(lines)
    elif lang == "typescript":
        lines = [
            f"const PROXY = \"{proxy}\";",
            "",
            "async function call(sourceId: string, operationId: string, opts: {",
            "  pathParams?: Record<string, unknown>;",
            "  queryParams?: Record<string, unknown>;",
            "  body?: Record<string, unknown>;",
            "} = {}) {",
            "  const r = await fetch(PROXY, {",
            "    method: \"POST\",",
            "    headers: { \"Content-Type\": \"application/json\" },",
            "    body: JSON.stringify({",
            "      source_id: sourceId, operation_id: operationId,",
            "      path_params: opts.pathParams ?? {}, query_params: opts.queryParams ?? {},",
            "      body: opts.body ?? {},",
            "    }),",
            "  });",
            "  return r.json();",
            "}",
            "",
            f"// Tools in toolset '{toolset_id}':",
        ]
        for t in selected:
            sid, op, method, path = example(t)
            lines.append(f"// {method} {path}")
            lines.append(f"const result = await call({sid!r}, {op!r});".replace("'", '"'))
        code = "\n".join(lines)
    else:  # curl
        lines = []
        for t in selected:
            sid, op, method, path = example(t)
            payload = json.dumps(
                {"source_id": sid, "operation_id": op, "path_params": {}, "query_params": {}, "body": {}}
            )
            lines.append(f"# {method} {path}")
            lines.append(f"curl -s -X POST {proxy} -H 'Content-Type: application/json' -d '{payload}'")
            lines.append("")
        code = "\n".join(lines) or "# No tools selected in this toolset."

    return {"toolset_id": toolset_id, "lang": lang, "code": code, "tool_count": len(selected)}


# ===========================================================================
# Source-scoped Environments (the REAL proxy-override functionality)
# ===========================================================================
# Stored under storage["source_environments"][source_id] =
#   {"active": <env_id|None>, "envs": [{"id","name","variables":{...}}, ...]}
# proxy.py:_active_env_vars reads this to override base_url + inject auth.

SSE_PORT = 8002
SSE_URL = f"http://localhost:{SSE_PORT}/sse"


def _require_source(storage: dict, source_id: str) -> dict:
    src = (storage.get("sources") or {}).get(source_id)
    if not src:
        raise HTTPException(status_code=404, detail=f"Source '{source_id}' not found.")
    return src


def _source_env_block(storage: dict, source_id: str) -> dict:
    se = storage.setdefault("source_environments", {})
    se.setdefault(source_id, {"active": None, "envs": []})
    return se[source_id]


class SourceEnvItem(BaseModel):
    name: str
    variables: dict[str, Any] = {}


@router.get("/sources/{source_id}/environments")
def list_source_environments(source_id: str):
    storage = load_storage()
    _require_source(storage, source_id)
    block = _source_env_block(storage, source_id)
    return {"source_id": source_id, "active": block.get("active"),
            "environments": block.get("envs", [])}


@router.post("/sources/{source_id}/environments")
def create_source_environment(source_id: str, item: SourceEnvItem):
    storage = load_storage()
    _require_source(storage, source_id)
    block = _source_env_block(storage, source_id)
    env = {"id": _new_id(block["envs"], item.name), "name": item.name,
           "variables": item.variables}
    block["envs"].append(env)
    save_storage(storage)
    return env


@router.put("/sources/{source_id}/environments/{env_id}")
def update_source_environment(source_id: str, env_id: str, item: SourceEnvItem):
    storage = load_storage()
    _require_source(storage, source_id)
    block = _source_env_block(storage, source_id)
    for env in block["envs"]:
        if env["id"] == env_id:
            env["name"] = item.name
            env["variables"] = item.variables
            save_storage(storage)
            return env
    raise HTTPException(status_code=404, detail=f"Environment '{env_id}' not found.")


@router.delete("/sources/{source_id}/environments/{env_id}")
def delete_source_environment(source_id: str, env_id: str):
    storage = load_storage()
    _require_source(storage, source_id)
    block = _source_env_block(storage, source_id)
    before = len(block["envs"])
    block["envs"] = [e for e in block["envs"] if e["id"] != env_id]
    if len(block["envs"]) == before:
        raise HTTPException(status_code=404, detail=f"Environment '{env_id}' not found.")
    if block.get("active") == env_id:
        block["active"] = None
    save_storage(storage)
    return {"status": "deleted", "id": env_id, "active": block.get("active")}


class ActivateEnvRequest(BaseModel):
    env_id: str | None = None  # None deactivates (restores default proxy behavior)


@router.post("/sources/{source_id}/environments/activate")
def activate_source_environment(source_id: str, req: ActivateEnvRequest):
    storage = load_storage()
    _require_source(storage, source_id)
    block = _source_env_block(storage, source_id)
    if req.env_id is not None and not any(e["id"] == req.env_id for e in block["envs"]):
        raise HTTPException(status_code=404, detail=f"Environment '{req.env_id}' not found.")
    block["active"] = req.env_id
    save_storage(storage)
    return {"source_id": source_id, "active": block["active"]}


@router.get("/sources/{source_id}/environments/active")
def get_active_source_environment(source_id: str):
    storage = load_storage()
    _require_source(storage, source_id)
    block = _source_env_block(storage, source_id)
    active = block.get("active")
    env = next((e for e in block["envs"] if e["id"] == active), None)
    return {"source_id": source_id, "active": active, "environment": env}


# ===========================================================================
# MCP dashboard status
# ===========================================================================
def _mcp_client_blocks() -> dict:
    server_key = "gram-workflow-proxy"
    remote = {server_key: {"command": "npx", "args": ["-y", "mcp-remote", SSE_URL]}}
    url_only = {server_key: {"url": SSE_URL}}
    return {
        "claude_desktop": {"mcpServers": remote},
        "cursor": {"mcpServers": url_only},
        "windsurf": {"mcpServers": remote},
    }


@router.get("/mcp/status")
async def mcp_status():
    """Live MCP dashboard: server reachability, workflow tool count across all
    sources, and copy-paste client config for Claude Desktop, Cursor, Windsurf."""
    from app.workflows import cluster_source  # local import avoids cycle

    storage = load_storage()
    sources = storage.get("sources") or {}

    per_source = []
    tool_count = 0
    for sid, src in sources.items():
        wfs = (storage.get("workflow_defs") or {}).get(sid) or cluster_source(src)
        n = len(wfs)
        tool_count += n
        per_source.append({"id": sid, "workflow_tools": n,
                           "names": [w.get("id") for w in wfs]})

    # Honest reachability: a raw TCP connect to the SSE port. SSE endpoints stream
    # (an HTTP GET may hang), so a successful socket connect is the reliable signal
    # that the FastMCP server is up; connection refused => down.
    import asyncio
    reachable = False
    for host in ("127.0.0.1", "::1"):
        try:
            fut = asyncio.open_connection(host, SSE_PORT)
            reader, writer = await asyncio.wait_for(fut, timeout=1.5)
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            reachable = True
            break
        except Exception:
            continue

    return {
        "reachable": reachable,
        "sse_url": SSE_URL,
        "tool_count": tool_count,
        "source_count": len(sources),
        "sources": per_source,
        "clients": _mcp_client_blocks(),
    }


# ===========================================================================
# Full-client SDK generation (per source, not per toolset)
# ===========================================================================
def _source_ops(src: dict) -> list[dict]:
    out = []
    for oid, t in (src.get("tools") or {}).items():
        out.append({"operation_id": oid, "method": (t.get("method") or "GET").upper(),
                    "path": t.get("path") or "/", "summary": (t.get("summary") or "")[:80]})
    return out


def _full_client_python(source_id: str, base_url: str, ops: list[dict]) -> str:
    proxy = "http://localhost:8000/api/v1/proxy/call"
    lines = [
        '"""Auto-generated MCP Workflow Proxy client for source: %s' % source_id,
        f'Downstream base URL: {base_url}',
        'All calls route through the local proxy (handles auth + active environment).',
        '"""',
        "import httpx",
        "",
        f'SOURCE_ID = "{source_id}"',
        f'PROXY = "{proxy}"',
        "",
        "",
        "class Client:",
        "    def __init__(self, proxy: str = PROXY, source_id: str = SOURCE_ID):",
        "        self.proxy = proxy",
        "        self.source_id = source_id",
        "",
        "    def call(self, operation_id, path_params=None, query_params=None, body=None):",
        "        r = httpx.post(self.proxy, json={",
        '            "source_id": self.source_id, "operation_id": operation_id,',
        '            "path_params": path_params or {}, "query_params": query_params or {},',
        '            "body": body or {},',
        "        }, timeout=30)",
        "        r.raise_for_status()",
        "        return r.json()",
        "",
        "    def run_plan(self, plan, limit=5):",
        '        """Execute a declarative multi-step plan (list of step dicts)."""',
        '        r = httpx.post("http://localhost:8000/api/v1/workflows/plan/execute",',
        '            json={"source_id": self.source_id, "plan": plan, "limit": limit}, timeout=120)',
        "        r.raise_for_status()",
        "        return r.json()",
        "",
        "",
        "# Available operations:",
    ]
    for o in ops[:200]:
        lines.append(f'#   {o["method"]:6} {o["path"]}  ->  call({o["operation_id"]!r})')
    lines += ["", 'if __name__ == "__main__":', "    c = Client()",
              f'    print(c.call({ops[0]["operation_id"]!r}))' if ops else "    pass"]
    return "\n".join(lines)


def _full_client_typescript(source_id: str, base_url: str, ops: list[dict]) -> str:
    proxy = "http://localhost:8000/api/v1/proxy/call"
    lines = [
        f"// Auto-generated MCP Workflow Proxy client for source: {source_id}",
        f"// Downstream base URL: {base_url}",
        "",
        f'export const SOURCE_ID = "{source_id}";',
        f'const PROXY = "{proxy}";',
        "",
        "export interface CallOpts {",
        "  pathParams?: Record<string, unknown>;",
        "  queryParams?: Record<string, unknown>;",
        "  body?: Record<string, unknown>;",
        "}",
        "",
        "export class Client {",
        "  constructor(private proxy: string = PROXY, private sourceId: string = SOURCE_ID) {}",
        "",
        "  async call(operationId: string, opts: CallOpts = {}) {",
        "    const r = await fetch(this.proxy, {",
        '      method: "POST",',
        '      headers: { "Content-Type": "application/json" },',
        "      body: JSON.stringify({",
        "        source_id: this.sourceId, operation_id: operationId,",
        "        path_params: opts.pathParams ?? {}, query_params: opts.queryParams ?? {},",
        "        body: opts.body ?? {},",
        "      }),",
        "    });",
        "    if (!r.ok) throw new Error(`proxy ${r.status}`);",
        "    return r.json();",
        "  }",
        "",
        "  async runPlan(plan: unknown[], limit = 5) {",
        '    const r = await fetch("http://localhost:8000/api/v1/workflows/plan/execute", {',
        '      method: "POST", headers: { "Content-Type": "application/json" },',
        "      body: JSON.stringify({ source_id: this.sourceId, plan, limit }),",
        "    });",
        "    return r.json();",
        "  }",
        "}",
        "",
        "// Available operations:",
    ]
    for o in ops[:200]:
        lines.append(f'//   {o["method"]} {o["path"]}  ->  call("{o["operation_id"]}")')
    return "\n".join(lines)


def _full_client_curl(source_id: str, base_url: str, ops: list[dict]) -> str:
    proxy = "http://localhost:8000/api/v1/proxy/call"
    lines = [f"# cURL calls for source: {source_id} (base {base_url})", ""]
    for o in ops[:200]:
        payload = json.dumps({"source_id": source_id, "operation_id": o["operation_id"],
                              "path_params": {}, "query_params": {}, "body": {}})
        lines += [f'# {o["method"]} {o["path"]}',
                  f"curl -s -X POST {proxy} -H 'Content-Type: application/json' -d '{payload}'", ""]
    return "\n".join(lines)


@router.get("/sdk")
def generate_full_sdk(source_id: str, lang: str = "python"):
    """Generate a COMPLETE client module for a source (typed call() + run_plan()),
    not just per-call snippets. Powers the SDK page's Copy/Download."""
    storage = load_storage()
    src = _require_source(storage, source_id)
    base_url = src.get("base_url", "")
    ops = _source_ops(src)
    if lang == "typescript":
        code = _full_client_typescript(source_id, base_url, ops)
        filename = f"{_slug(source_id)}_client.ts"
    elif lang == "curl":
        code = _full_client_curl(source_id, base_url, ops)
        filename = f"{_slug(source_id)}_client.sh"
    else:
        lang = "python"
        code = _full_client_python(source_id, base_url, ops)
        filename = f"{_slug(source_id)}_client.py"
    return {"source_id": source_id, "lang": lang, "filename": filename,
            "operation_count": len(ops), "code": code}


# ===========================================================================
# Custom Tools — compose from source operations + RUN via execute_plan
# ===========================================================================
class SourceCustomToolItem(BaseModel):
    name: str
    description: str = ""
    source_id: str
    steps: list[dict[str, Any]] = []  # each: {operation_id, path_params?, query_params?, body?, foreach?}


@router.get("/sources/{source_id}/custom-tools")
def list_source_custom_tools(source_id: str):
    storage = load_storage()
    _require_source(storage, source_id)
    items = (storage.get("custom_tools") or {}).get(source_id, [])
    return {"source_id": source_id, "custom_tools": items}


@router.post("/sources/{source_id}/custom-tools")
def create_source_custom_tool(source_id: str, item: SourceCustomToolItem):
    storage = load_storage()
    _require_source(storage, source_id)
    bucket = storage.setdefault("custom_tools", {}).setdefault(source_id, [])
    rec = {"id": _new_id(bucket, item.name), "name": item.name,
           "description": item.description, "source_id": source_id,
           "steps": item.steps}
    bucket.append(rec)
    save_storage(storage)
    return rec


@router.delete("/sources/{source_id}/custom-tools/{tool_id}")
def delete_source_custom_tool(source_id: str, tool_id: str):
    storage = load_storage()
    _require_source(storage, source_id)
    bucket = storage.setdefault("custom_tools", {}).setdefault(source_id, [])
    new = [t for t in bucket if t["id"] != tool_id]
    if len(new) == len(bucket):
        raise HTTPException(status_code=404, detail=f"'{tool_id}' not found.")
    storage["custom_tools"][source_id] = new
    save_storage(storage)
    return {"status": "deleted", "id": tool_id}


class CustomToolRunRequest(BaseModel):
    source_id: str
    steps: list[dict[str, Any]] | None = None  # inline run; else use saved tool_id
    tool_id: str | None = None
    limit: int = 5


def _normalize_steps(steps: list) -> list[dict]:
    """Accept either ['op_id', ...] (legacy) or [{operation_id,...}, ...]."""
    out = []
    for s in steps or []:
        if isinstance(s, str):
            out.append({"operation_id": s})
        elif isinstance(s, dict) and s.get("operation_id"):
            out.append(s)
    return out


@router.post("/custom-tools/run")
async def run_custom_tool(req: CustomToolRunRequest):
    """Convert a custom tool's ordered steps into a plan and execute via
    execute_plan, returning the step trace."""
    from app.workflows import execute_plan  # local import avoids cycle

    storage = load_storage()
    _require_source(storage, req.source_id)

    steps = req.steps
    if steps is None and req.tool_id:
        bucket = (storage.get("custom_tools") or {}).get(req.source_id, [])
        rec = next((t for t in bucket if t["id"] == req.tool_id), None)
        if not rec:
            raise HTTPException(status_code=404, detail=f"Custom tool '{req.tool_id}' not found.")
        steps = rec.get("steps", [])

    plan = _normalize_steps(steps or [])
    if not plan:
        raise HTTPException(status_code=400, detail="No runnable steps provided.")
    out = await execute_plan(req.source_id, plan, limit=req.limit)
    return {"source_id": req.source_id, "tool_id": req.tool_id, "plan": plan, **out}
