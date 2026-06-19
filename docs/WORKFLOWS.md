# Workflows: raw endpoints → workflow-level tools

This is the mapping doc. It explains how a flat OpenAPI spec becomes a handful of workflow tools, the JSON shape those tools take, how to override the grouping, the Redfish/iDRAC intent profile, and the declarative plan spec — with a concrete before/after.

All behavior described here lives in `compiler/app/workflows.py`.

## How a cluster becomes a tool

1. **Ingest** flattens the spec into `source.tools` — one entry per `operation_id` with `path`, `method`, `parameters`, `request_body`, `tags` (`ingest.py`).
2. **`cluster_source`** groups those operations:
   - **Profile pass** (if a domain profile is detected/forced) assigns operations to intent-named workflows.
   - **Generic pass** groups the rest by `_cluster_key` = first `tag`, else first meaningful path segment (segments in `_SKIP_SEGMENTS` like `api`/`v1`/`redfish` are skipped).
3. Each group is turned into **one workflow def**. Operations are sorted by `(path, method)`. If the group has both a collection `GET` and an item `GET` (`{...}` in the path), the workflow gets `report: true` and a synthetic `__report__` operation.
4. **`workflow_tool_schema`** renders the MCP/LLM tool definition. The input schema is always the same compact shape; the `operation` enum lists the cluster's operation_ids (plus `__report__` when present).

## The workflow-def JSON shape

A workflow definition (stored in `storage.workflow_defs[source_id]`) looks like:

```json
{
  "id": "wf_power_control",
  "name": "Power Control",
  "cluster": "power_control",
  "description": "Power Control: 3 operations (GET, POST). Pick an 'operation' and pass any path/query/body params.",
  "operations": [
    {
      "operation_id": "reset_system",
      "method": "POST",
      "path": "/redfish/v1/Systems/{id}/Actions/ComputerSystem.Reset",
      "summary": "Reset a computer system",
      "params": ["id"]
    }
  ],
  "report": false,
  "profile": "Redfish"
}
```

- `id` / `name` — slug + human title (intent name under a profile, else `"<Title> Workflow"`).
- `operations[]` — the cluster's endpoints (`operation_id`, `method`, `path`, truncated `summary`, `params` name list).
- `report` — `true` when a collection+item `GET` pair exists, enabling the `__report__` multi-step op.
- `profile` — present only for profile-matched workflows (e.g. `"Redfish"`).

### The rendered MCP tool

```json
{
  "name": "wf_power_control",
  "description": "Power Control: 3 operations (GET, POST). Use search_operations(query) to find a specific operation and describe_operation(operation_id) for its full input schema, then pass that operation_id as 'operation'.",
  "input_schema": {
    "type": "object",
    "properties": {
      "operation":   { "type": "string", "enum": ["reset_system", "..."], "description": "Operation to run" },
      "path_params": { "type": "object", "description": "Path parameter substitutions" },
      "query_params":{ "type": "object", "description": "Query string parameters" },
      "body":        { "type": "object", "description": "Request body for write operations" }
    },
    "required": ["operation"]
  }
}
```

With `defer_catalog=False`, the description instead embeds the full operation catalog (one line per op, up to 40). With `defer_catalog=True` (what the MCP server uses), the catalog is omitted — the agent discovers ops via `search_operations`/`describe_operation`.

## Customizing / overriding groupings

- **Regenerate with a different profile.** `POST /api/v1/workflows/generate?source_id=<id>&profile=<auto|redfish|none>`:
  - `auto` (default) — auto-detect a built-in profile, fall back to generic clustering.
  - `redfish` — force the Redfish profile.
  - `none` (sent as the string, or any unknown name) — disable profiles, pure tag/path clustering.
- **Persisted, then editable.** Generated defs are stored at `storage.workflow_defs[source_id]`. List/metrics endpoints (`GET /api/v1/workflows`, `/metrics`) read this stored copy if present, else derive on the fly. To re-shape groupings, edit the stored defs (or regenerate). The UI's **Generate** button calls the generate endpoint.
- **Tags are the primary lever.** Because generic clustering keys on the first `tag`, the cleanest way to influence grouping without a profile is the spec's own `tags`.

## Redfish profile (intent → patterns)

`REDFISH_PROFILE` is detected when any path matches `/redfish/v1`. Each operation is placed in the **first** workflow whose regex matches `"<METHOD> <path>  <operationId>"` (case-insensitive). Order is deliberate — specific intents before the broad health check.

| Intent workflow | `id` | Match patterns (regex) |
|---|---|---|
| **Power Control** | `wf_power_control` | `ComputerSystem\.Reset`, `/Actions/.*Reset`, `PowerControl`, `\.Reset` |
| **Firmware Update** | `wf_firmware_update` | `UpdateService`, `SimpleUpdate`, `FirmwareInventory`, `/TaskService`, `/Tasks(/|$)` |
| **Inventory & Telemetry** | `wf_inventory_telemetry` | `/Processors`, `/Memory`, `/Storage`, `/EthernetInterfaces`, `/NetworkInterfaces`, `/Drives`, `/SimpleStorage`, `TelemetryService`, `/MetricReports` |
| **Server Health Check** | `wf_server_health_check` | `/Systems(/|$)`, `/Chassis(/|$)`, `/Managers(/|$)`, `/Thermal`, `/Power(?!Control)`, `Status` |

Anything not matched by the profile falls through to generic tag/path clustering, so nothing is lost.

## The declarative plan spec

A `WorkflowPlan` is an ordered list of steps interpreted by `execute_plan`. Each step:

```jsonc
{
  "operation_id": "<op to call>",
  "path_params":  { "<param>": "<literal or selector>" },   // optional
  "query_params": { "<param>": "<literal or selector>" },   // optional
  "body":         { "<field>": "<literal or selector>" },   // optional
  "foreach":      "<selector resolving to a list>",         // optional
  "until":        { "selector": "<sel>", "equals": <val>,   // optional polling
                    "max_attempts": 5, "delay_ms": 1000 }
}
```

### Selector language

| Form | Resolves to |
|---|---|
| non-selector string / non-string | literal (passed through) |
| `$last` / `$last.<dotted.path>` | previous step's result (optionally drilled in) |
| `$steps.<i>` / `$steps.<i>.<dotted.path>` | result of step index `i` |
| `item` / `item.<dotted.path>` | current `foreach` element |
| `*` inside a dotted path | maps the remaining sub-path over a list |

### Caps

`MAX_PLAN_STEPS=25`, `MAX_FOREACH_ITERATIONS=25` (also bounded by the request `limit`), `MAX_POLL_ATTEMPTS=30`, per-call timeout 30 s (inherited from the proxy). `until` also clamps `delay_ms` to ≤5000.

### Worked example — list → foreach → detail (verified live on the no-auth D&D API)

```jsonc
[
  { "operation_id": "list_spells" },                       // step 0: GET /spells -> {count, results:[{index,...}]}
  {
    "operation_id": "get_spell",                           // step 1: GET /spells/{index}
    "foreach": "$last.data.results.*.index",               // map over every result's index from step 0
    "path_params": { "index": "item" }                     // substitute the current element
  }
]
```

Run it with `POST /api/v1/workflows/plan/execute` `{ source_id, plan, limit }`. The response carries per-step `steps` (full results) plus a compact `trace`. A `until` example (poll a task to completion):

```jsonc
{ "operation_id": "get_task", "path_params": { "id": "$last.data.id" },
  "until": { "selector": "$last.data.TaskState", "equals": "Completed",
             "max_attempts": 10, "delay_ms": 2000 } }
```

Save reusable plans with `POST /api/v1/workflows/plan/save` and run by name with `POST /api/v1/workflows/plan/run-named`.

## The `__report__` auto-plan

When a workflow has a collection+item `GET` pair, `execute_workflow` handles `operation == "__report__"` as an auto-generated list→detail orchestration that preserves a stable output shape:

1. **List** the collection (`GET /things`), passing through `query_params`.
2. **Extract item keys** via `_extract_item_keys` — looks inside common shapes (`results`/`data`/`items`/`value`/`members`/`Members`) and pulls the first of `index`/`id`/`Id`/`name`/`slug` from each element.
3. **Foreach key** (capped by `report_limit`, default 5), fetch the item detail (`GET /things/{id}`), substituting the path placeholder.
4. Return `{ items_found, items_fetched, steps: [list, details[]] }`.

`_auto_report_plan` expresses the same thing as a declarative plan (`list` then `foreach $last.data.results.*.index → get item`), tying `__report__` back into the generic plan engine.

## Concrete before/after — one Redfish resource

**Before** — raw 1:1 tools (a slice of the flat catalog):

```
GET  /redfish/v1/Systems
GET  /redfish/v1/Systems/{id}
GET  /redfish/v1/Systems/{id}/Processors
GET  /redfish/v1/Systems/{id}/Memory
POST /redfish/v1/Systems/{id}/Actions/ComputerSystem.Reset
GET  /redfish/v1/Chassis
GET  /redfish/v1/Chassis/{id}/Thermal
GET  /redfish/v1/Managers
GET  /redfish/v1/UpdateService/FirmwareInventory
POST /redfish/v1/UpdateService/Actions/SimpleUpdate
...  (one MCP tool + full input schema EACH — hundreds of tools, tens of thousands of tokens)
```

**After** — four intent workflows (Redfish profile), each one MCP tool with a compact `{operation, path_params, query_params, body}` schema:

```
wf_power_control          ← ComputerSystem.Reset, /Actions/*Reset, *.Reset ...
wf_firmware_update        ← UpdateService, SimpleUpdate, FirmwareInventory, Tasks ...
wf_inventory_telemetry    ← /Processors, /Memory, /Storage, /MetricReports ...
wf_server_health_check    ← /Systems, /Chassis, /Managers, /Thermal, Status ...   (report → __report__ available)
```

An agent now sees four intent-named tools instead of the raw endpoint list — and discovers any specific operation on demand via `search_operations` / `describe_operation`. Across the verified GitHub spec this is **845 endpoints → 33 workflow tools (96.1% fewer)** and **158,751 → 12,927 tool-definition tokens (91.9% fewer)** with progressive disclosure.
