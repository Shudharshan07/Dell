Backend Specification: Local Gram Execution Engine (Python + FastMCP)
This document specifies the technical design, directory architecture, API endpoints, and dynamic proxy routing rules for running the Gram tool orchestrator as a lightweight local development tool.

1. System Architecture & Project Setup
Instead of a heavy, multi-tenant database cluster, this architecture leverages an asynchronous Python server that persists custom workflows, API metadata overrides, and credentials to a single local configuration file (gram_storage.json).

 ┌──────────────────────┐
 │     Agent Client     │ (Cursor IDE / Claude Desktop App)
 └──────────┬───────────┘
            │
            │ (MCP Protocol via JSON-RPC over Local stdio/HTTP)
            ▼
 ┌──────────────────────┐      Reads/Writes      ┌───────────────────┐
 │  Local FastMCP App   │ ─────────────────────► │ gram_storage.json │
 │ (FastAPI Core Loop)  │                        │ (Local File DB)   │
 └──────────┬───────────┘                        └───────────────────┘
            │
            │ (Direct Outbound REST Requests)
            ▼
 ┌──────────────────────┐
 │ Downstream SaaS APIs │ (Stripe, HubSpot, Custom Local APIs)
 └──────────────────────┘
Directory Structure
Plaintext
gram-backend/
├── app/
│   ├── __init__.py
│   ├── main.py            # FastAPI entry point, ingestion & storage endpoints
│   ├── mcp_server.py      # FastMCP tool registration and proxy logic
│   └── storage.py         # File-based JSON read/write handlers
├── gram_storage.json      # Local persistent storage file (Git-ignored)
└── requirements.txt
Python Dependencies (requirements.txt)
Plaintext
fastapi>=0.110.0
fastmcp>=0.4.0
pydantic>=2.6.0
httpx>=0.27.0
uvicorn>=0.28.0
pyyaml>=6.0.1
2. Local File Storage Layer (app/storage.py)
This utility handles reading and writing configurations directly to your local file system, mimicking database states with zero dependency overhead.

Python
import json
import os

STORAGE_PATH = "gram_storage.json"

DEFAULT_STORAGE = {
    "sources": {},     # Raw & parsed OpenAPI specifications
    "toolsets": {},    # Custom curated tool groups (5-30 tools max)
    "credentials": {}, # Local environment tokens (e.g., Stripe, HubSpot keys)
    "workflows": {}    # Custom composite agentic prompt sequences
}

def load_storage():
    """Reads the local JSON file state safely, creating it if missing."""
    if not os.path.exists(STORAGE_PATH):
        save_storage(DEFAULT_STORAGE)
        return DEFAULT_STORAGE
    try:
        with open(STORAGE_PATH, "r") as f:
            return json.load(f)
    except json.JSONDecodeError:
        return DEFAULT_STORAGE

def save_storage(data):
    """Writes the updated configuration state directly back to disk."""
    with open(STORAGE_PATH, "w") as f:
        json.dump(data, f, indent=2)
3. Core API Router & Ingestion Engine (app/main.py)
Handles UI interactions from your React frontend—such as parsing uploaded OpenAPI specs, managing local credentials, and organizing tool metadata.

Python
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import yaml
import json
from app.storage import load_storage, save_storage

app = FastAPI(title="Gram Local Core API")

# Allow seamless connectivity from local React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/v1/ingest")
async def ingest_openapi(file: UploadFile = File(...)):
    """Parses an OpenAPI spec file, flattens endpoints, and updates local storage."""
    contents = await file.read()
    
    try:
        if file.filename.endswith(('.yaml', '.yml')):
            spec_data = yaml.safe_load(contents)
        else:
            spec_data = json.loads(contents)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid file format. Must be valid JSON or YAML.")

    parsed_tools = {}
    paths = spec_data.get("paths", {})
    servers = spec_data.get("servers", [{}])
    base_url = servers[0].get("url", "") if servers else ""

    for path, methods in paths.items():
        for method, details in methods.items():
            if method.lower() in ['get', 'post', 'put', 'delete']:
                operation_id = details.get("operationId", f"{method}_{path.replace('/', '_')}").replace("-", "_")
                
                parsed_tools[operation_id] = {
                    "operation_id": operation_id,
                    "name": details.get("summary", f"{method.upper()} {path}"),
                    "description": details.get("description", details.get("summary", "No description")),
                    "path": path,
                    "method": method.upper(),
                    "parameters": details.get("parameters", []),
                    "request_body": details.get("requestBody", {})
                }

    # Persist directly into local file storage
    storage = load_storage()
    source_id = file.filename.split('.')[0]
    storage["sources"][source_id] = {
        "base_url": base_url,
        "tools": parsed_tools
    }
    save_storage(storage)

    return {
        "source_id": source_id,
        "base_url": base_url,
        "total_tools": len(parsed_tools),
        "tools": list(parsed_tools.values())
    }

@app.post("/api/v1/credentials")
async def save_credential(source_id: str, token: str):
    """Saves local target keys (e.g., Stripe Developer Token) into the local JSON file."""
    storage = load_storage()
    storage["credentials"][source_id] = token
    save_storage(storage)
    return {"status": "success", "message": f"Credentials saved locally for {source_id}"}
4. FastMCP Live Proxy Layer (app/mcp_server.py)
This file mounts the live FastMCP server instance. It serves as your agent client's (stdio or SSE) connection interface, dynamically forwarding actions to your downstream APIs using your local credentials file.

Python
import json
import httpx
from fastmcp import FastMCP
from pydantic import BaseModel, Field
from app.storage import load_storage

# Initialize the FastMCP local application context
mcp = FastMCP("Gram Local Proxy Manager")

class DynamicChargePayload(BaseModel):
    amount: int = Field(..., description="The transaction volume value. NOTE: Values must strictly be formatted in cents (e.g., 2500 for $25.00).")
    currency: str = Field("usd", description="Three-letter ISO currency code wrapper.")
    customer_id: str = Field(..., description="Unique customer string token tracking key.")

@mcp.tool()
async def stripe_create_charge(payload: DynamicChargePayload) -> str:
    """
    Executes a transaction charge safely via the local proxy layer.
    Automatically fetches local configurations and structural parameters.
    """
    storage = load_storage()
    
    # Resolve localized secrets from our storage file
    api_token = storage["credentials"].get("stripe", "Bearer sk_test_mock_holder")
    base_url = storage["sources"].get("stripe", {}).get("base_url", "https://api.stripe.com/v1")
    
    target_endpoint = f"{base_url}/charges"
    headers = {
        "Authorization": f"Bearer {api_token.replace('Bearer ', '')}",
        "Content-Type": "application/x-www-form-urlencoded"
    }
    
    # Map incoming payloads down to application/x-www-form-urlencoded formats
    form_data = {
        "amount": payload.amount,
        "currency": payload.currency,
        "customer": payload.customer_id
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(target_endpoint, headers=headers, data=form_data)
            
            # Catch API rate-limiting structures natively locally
            if response.status_code == 429:
                retry_after = response.headers.get("Retry-After", "2")
                return f"⚠️ RATE LIMIT TRIGGERED: Downstream endpoint busy. Retry operations after {retry_after}s delay."
            
            if response.status_code >= 400:
                return f"❌ HTTP ERROR [{response.status_code}]: Downstream endpoint returned: {response.text}"
                
            return json.dumps(response.json(), indent=2)
            
        except Exception as e:
            return f"❌ CLIENT CALL EXCEPTION: Failed routing request downstream. Details: {str(e)}"
5. Composite Custom Tools (Prompt-Driven Workflows)
When an agent triggers a hand-crafted "Custom Tool", it skips individual network overhead requests. Instead, it reads sequential step metadata directly from your local gram_storage.json to process the entire pipeline at once.

Python
@mcp.tool()
async def run_custom_company_audit_workflow(company_slug: str) -> str:
    """
    Meta-Tool Workflow Execution Block.
    Step 1: Queries internal storage configurations to locate targeted system IDs.
    Step 2: Fetches user profiles from local directory listings.
    Step 3: Compiles unified invoice summaries directly from downstream records.
    """
    # Emulates executing structural step dependencies across independent tools
    trace_steps = [
        f"🔍 Step 1: Querying local storage for workspace profile slug matching: '{company_slug}'... Found ID: ws_local_8819",
        "📋 Step 2: Fetching default points-of-contact accounts... Found billing owner address: operations@dev.io",
        "💳 Step 3: Triggering downstream payment lookup matrices using resolved contact variables..."
    ]
    
    # Simulate final execution data responses
    mock_metrics = {
        "account_status": "Active",
        "total_unsettled_refunds_cents": 0,
        "current_billing_period_charges_cents": 15500
    }
    
    output_summary = {
        "execution_log": trace_steps,
        "final_payload": mock_metrics
    }
    
    return json.dumps(output_summary, indent=2)
6. Running and Mounting Your Local Server
To run your backend configuration together with FastAPI and FastMCP simultaneously during local debugging sessions:

Bash
# Terminal Session 1: Run your FastAPI context setup (Frontend communications)
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# Terminal Session 2: Boot your FastMCP system directly to bridge with Cursor/Claude
fastmcp run app/mcp_server.py