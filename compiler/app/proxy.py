"""
Dynamic API proxy layer.
Forwards tool execution requests to downstream APIs using locally stored credentials.
"""
import json
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any
from app.storage import load_storage

router = APIRouter(prefix="/api/v1/proxy")


class ProxyCallRequest(BaseModel):
    source_id: str
    operation_id: str
    path_params: dict[str, Any] = {}
    query_params: dict[str, Any] = {}
    body: dict[str, Any] = {}


@router.post("/call")
async def proxy_call(req: ProxyCallRequest):
    """
    Executes a single tool call against a downstream API.
    Resolves base_url and credentials from local storage automatically.
    """
    storage = load_storage()

    source = storage["sources"].get(req.source_id)
    if not source:
        raise HTTPException(status_code=404, detail=f"Source '{req.source_id}' not found.")

    tool = source["tools"].get(req.operation_id)
    if not tool:
        raise HTTPException(status_code=404, detail=f"Operation '{req.operation_id}' not found.")

    base_url = source.get("base_url", "").rstrip("/")
    token = storage["credentials"].get(req.source_id, "")

    # Resolve path parameters
    path = tool["path"]
    for key, value in req.path_params.items():
        path = path.replace(f"{{{key}}}", str(value))

    url = base_url + path
    method = tool["method"].lower()

    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token.replace('Bearer ', '')}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            if method in ("get", "delete"):
                response = await client.request(method, url, headers=headers, params=req.query_params)
            else:
                headers["Content-Type"] = "application/json"
                response = await client.request(method, url, headers=headers, params=req.query_params, json=req.body)

            if response.status_code == 429:
                retry_after = response.headers.get("Retry-After", "2")
                return {"error": "rate_limited", "retry_after_seconds": retry_after}

            try:
                return {"status_code": response.status_code, "data": response.json()}
            except Exception:
                return {"status_code": response.status_code, "data": response.text}

        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f"Downstream request failed: {str(e)}")


@router.post("/workflow/{workflow_id}")
async def run_workflow(workflow_id: str):
    """
    Executes a saved multi-step workflow from local storage.
    Each step is a proxy call executed in sequence.
    """
    storage = load_storage()

    workflow = storage["workflows"].get(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_id}' not found.")

    results = []
    for i, step in enumerate(workflow.get("steps", [])):
        step_req = ProxyCallRequest(**step)
        try:
            result = await proxy_call(step_req)
            results.append({"step": i + 1, "operation_id": step_req.operation_id, "result": result})
        except HTTPException as e:
            results.append({"step": i + 1, "operation_id": step_req.operation_id, "error": e.detail})
            break  # Stop on first failure

    return {"workflow_id": workflow_id, "steps_executed": len(results), "results": results}
