import json
import os

STORAGE_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "local_storage.json")

DEFAULT_STORAGE = {
    "sources": {},        # Raw & parsed OpenAPI specifications
    "toolsets": {},       # Custom curated tool groups
    "credentials": {},    # Local environment tokens
    "workflows": {},      # Custom composite agentic prompt sequences
    "environments": {},   # Per-toolset variable/secret sets
    "prompts": {},        # Per-toolset prompt templates
    "custom_tools": {},   # Per-toolset higher-order tools
    "workflow_defs": {},  # Per-source workflow clusters (the Workflow Proxy output)
    "workflow_plans": {}, # Per-source/workflow named declarative multi-step plans
    "source_environments": {},  # Per-source env sets + active selection (proxy overrides)
}

def load_storage() -> dict:
    """Reads local JSON file state safely, creating it if missing."""
    if not os.path.exists(STORAGE_PATH):
        save_storage(DEFAULT_STORAGE)
        return DEFAULT_STORAGE
    try:
        with open(STORAGE_PATH, "r") as f:
            return json.load(f)
    except json.JSONDecodeError:
        return DEFAULT_STORAGE

def save_storage(data: dict) -> None:
    """Writes updated configuration state directly back to disk.

    ``default=str`` keeps non-JSON-native values that YAML parsing can produce
    (e.g. datetime/date objects from timestamp examples in OpenAPI specs) from
    blowing up serialization.
    """
    with open(STORAGE_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str)
