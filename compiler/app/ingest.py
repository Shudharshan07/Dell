from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
import yaml
import json
from typing import List, Any
from pydantic import BaseModel, field_validator
from app.storage import load_storage, save_storage

router = APIRouter(prefix="/api/v1")


@router.post("/ingest")
async def ingest_openapi(file: UploadFile = File(...)):
    """Parses an OpenAPI spec file, flattens endpoints, and persists to local storage."""
    contents = await file.read()

    try:
        if file.filename.endswith((".yaml", ".yml")):
            spec_data = yaml.safe_load(contents)
        else:
            spec_data = json.loads(contents)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid file format. Must be valid JSON or YAML.")

    parsed_tools = {}
    paths = spec_data.get("paths", {}) or {}
    servers = spec_data.get("servers", [{}])
    base_url = servers[0].get("url", "") if servers else ""

    for path, methods in paths.items():
        if not isinstance(methods, dict):
            continue
        for method, details in methods.items():
            if method.lower() not in ["get", "post", "put", "delete", "patch"]:
                continue
            if not isinstance(details, dict):
                continue

            operation_id = (
                details.get("operationId", f"{method}_{path.replace('/', '_')}")
                .replace("-", "_")
            )

            parsed_tools[operation_id] = {
                "operation_id": operation_id,
                "name": details.get("summary", f"{method.upper()} {path}"),
                "description": details.get("description", details.get("summary", "No description")),
                "path": path,
                "method": method.upper(),
                "parameters": details.get("parameters", []),
                "request_body": details.get("requestBody", {}),
            }

    storage = load_storage()
    source_id = file.filename.rsplit(".", 1)[0]
    storage["sources"][source_id] = {
        "base_url": base_url,
        "tools": parsed_tools,
    }
    save_storage(storage)

    return {
        "source_id": source_id,
        "base_url": base_url,
        "total_tools": len(parsed_tools),
        "tools": list(parsed_tools.values()),
    }


@router.post("/credentials")
async def save_credential(source_id: str, token: str):
    """Saves an API token for a given source into local JSON storage."""
    storage = load_storage()
    storage["credentials"][source_id] = token
    save_storage(storage)
    return {"status": "success", "message": f"Credentials saved locally for {source_id}"}


@router.get("/sources")
async def list_sources():
    """Lists all ingested API sources and their tool counts."""
    storage = load_storage()
    return {
        source_id: {
            "base_url": data.get("base_url", ""),
            "total_tools": len(data.get("tools", {})),
        }
        for source_id, data in storage["sources"].items()
    }


@router.get("/sources/{source_id}/tools")
async def get_source_tools(source_id: str):
    """Returns all parsed tools for a given ingested source."""
    storage = load_storage()
    source = storage["sources"].get(source_id)
    if not source:
        raise HTTPException(status_code=404, detail=f"Source '{source_id}' not found.")
    return {"source_id": source_id, "tools": list(source["tools"].values())}


@router.delete("/sources/{source_id}")
async def delete_source(source_id: str):
    """Removes an ingested source and its tools from local storage."""
    storage = load_storage()
    if source_id not in storage["sources"]:
        raise HTTPException(status_code=404, detail=f"Source '{source_id}' not found.")
    del storage["sources"][source_id]
    storage["credentials"].pop(source_id, None)
    save_storage(storage)
    return {"status": "deleted", "source_id": source_id}


class ToolsetItem(BaseModel):
    id: str
    method: str
    path: str
    description: str
    parameters: List[Any] = []
    selected: bool = True

    @field_validator("parameters", mode="before")
    @classmethod
    def coerce_parameters(cls, v):
        """Accept both string and object parameters; extract name if object."""
        if not isinstance(v, list):
            return []
        result = []
        for p in v:
            if isinstance(p, str):
                result.append(p)
            elif isinstance(p, dict):
                result.append(p.get("name") or p.get("id") or str(p))
            else:
                result.append(str(p))
        return result


class ToolsetSaveRequest(BaseModel):
    toolset_id: str
    tools: List[ToolsetItem]
    description: str = "New Toolset Description"


@router.post("/toolsets")
async def save_toolset(req: ToolsetSaveRequest):
    """Saves a custom curated toolset to local storage."""
    storage = load_storage()
    
    # Initialize toolsets sub-dict if not present
    if "toolsets" not in storage:
        storage["toolsets"] = {}
        
    storage["toolsets"][req.toolset_id] = {
        "toolset_id": req.toolset_id,
        "tools": [tool.model_dump() for tool in req.tools],
        "description": req.description
    }
    save_storage(storage)
    return {"status": "success", "message": f"Toolset '{req.toolset_id}' saved successfully"}


@router.get("/toolsets")
async def list_toolsets():
    """Lists all saved toolsets."""
    storage = load_storage()
    toolsets = storage.get("toolsets", {})
    for tid, tval in toolsets.items():
        if "description" not in tval:
            tval["description"] = "New Toolset Description"
    return toolsets


@router.get("/toolsets/{toolset_id}")
async def get_toolset(toolset_id: str):
    """Retrieves a specific toolset."""
    storage = load_storage()
    toolset = storage.get("toolsets", {}).get(toolset_id)
    if not toolset:
        raise HTTPException(status_code=404, detail=f"Toolset '{toolset_id}' not found.")
    if "description" not in toolset:
        toolset["description"] = "New Toolset Description"
    return toolset


@router.delete("/toolsets/{toolset_id}")
async def delete_toolset(toolset_id: str):
    """Removes a curated toolset from local storage."""
    storage = load_storage()
    if "toolsets" in storage and toolset_id in storage["toolsets"]:
        del storage["toolsets"][toolset_id]
        save_storage(storage)
        return {"status": "deleted", "toolset_id": toolset_id}
    raise HTTPException(status_code=404, detail=f"Toolset '{toolset_id}' not found.")


