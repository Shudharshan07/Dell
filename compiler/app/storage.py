import json
import os

STORAGE_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "local_storage.json")

DEFAULT_STORAGE = {
    "sources": {},      # Raw & parsed OpenAPI specifications
    "toolsets": {},     # Custom curated tool groups
    "credentials": {},  # Local environment tokens
    "workflows": {}     # Custom composite agentic prompt sequences
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
    """Writes updated configuration state directly back to disk."""
    with open(STORAGE_PATH, "w") as f:
        json.dump(data, f, indent=2)
