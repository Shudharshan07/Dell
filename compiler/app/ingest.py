from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
import yaml
import json
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
