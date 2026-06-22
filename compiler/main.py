# pyrefly: ignore [missing-import]
from fastapi import FastAPI, HTTPException, Query
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
# pyrefly: ignore [missing-import]
from fastapi.staticfiles import StaticFiles
# pyrefly: ignore [missing-import]
from fastapi.responses import FileResponse
# pyrefly: ignore [missing-import]
import networkx as nx
import re
import os
import sys
import glob

# Ensure app/ sub-package is importable regardless of cwd
sys.path.insert(0, os.path.dirname(__file__))

from app.ingest import router as ingest_router
from app.proxy import router as proxy_router
from app.agent import router as agent_router
from app.resources import router as resources_router
from app.workflows import router as workflows_router

app = FastAPI(title="OneMCP")

# Clear CORS policy for React/Vite development local links
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_headers=["*"],
    allow_methods=["*"],
)

app.include_router(ingest_router)
app.include_router(proxy_router)
app.include_router(agent_router)
app.include_router(resources_router)
app.include_router(workflows_router)


BASE_SPEC_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "test_specs", "V3"))

def parse_spec_to_graph(spec_path: str) -> dict:
    graph = nx.DiGraph()
    
    with open(spec_path, 'r', encoding='utf-8', errors='ignore') as f:
        raw_text = f.read()
    
    # Catch paths across both YAML indent formats and JSON key structures
    path_matches = re.finditer(r'(?:["\']\s*|\s*)(/[a-zA-Z0-9_\-\{\}\/\:\.\@\+]+)(?:["\']\s*)?:\s*(?:\{|\n)', raw_text)
    
    paths_found = []
    for match in path_matches:
        path = match.group(1)
        # Avoid structural swagger metadata keywords passing as valid paths
        if not path.startswith(("/components", "/definitions", "/responses", "/parameters")):
            paths_found.append((path, match.start()))
            
    if not paths_found:
        return {"summary": {"total_endpoints": 0, "detected_dependencies": 0}, "nodes": [], "links": []}
        
    methods_list = ['get', 'post', 'put', 'delete', 'patch']
    
    for i, (path, start_pos) in enumerate(paths_found):
        end_pos = paths_found[i+1][1] if i + 1 < len(paths_found) else len(raw_text)
        path_block = raw_text[start_pos:end_pos].lower()
        
        for method in methods_list:
            # Match variations like "get:", '"get":', or 'method: get'
            if re.search(r'(?:["\']?' + method + r'["\']?\s*:\s*|["\']?method["\']?\s*:\s*["\']?' + method + r'["\']?)', path_block):
                node_id = f"{method.upper()} {path}"
                
                # Snatch closest documentation or summary string if available
                summary_match = re.search(r'summary["\']?\s*:\s*["\']?([^"\']+)["\']?', path_block)
                summary = summary_match.group(1).strip() if summary_match else path
                
                graph.add_node(node_id, path=path, method=method.upper(), summary=summary)

    # Establish Relational Edges
    nodes = list(graph.nodes(data=True))
    for source_id, source_data in nodes:
        source_path = source_data['path'].rstrip('/')
        
        for target_id, target_data in nodes:
            target_path = target_data['path']
            
            if target_path.startswith(source_path + "/{") or target_path.startswith(source_path + "/:"):
                if source_data['method'] in ['POST', 'GET']:
                    graph.add_edge(source_id, target_id, type="instance_dependency")
            elif "{" in source_path and target_path.startswith(source_path + "/"):
                graph.add_edge(source_id, target_id, type="subresource_dependency")

    return {
        "summary": {
            "total_endpoints": graph.number_of_nodes(),
            "detected_dependencies": graph.number_of_edges()
        },
        "nodes": [{"id": n, "method": d["method"], "summary": d["summary"], "path": d["path"]} for n, d in graph.nodes(data=True)],
        "links": [{"source": u, "target": v, "type": d["type"]} for u, v, d in graph.edges(data=True)]
    }

@app.get("/api/specs")
def list_specs():
    pattern = os.path.join(BASE_SPEC_DIR, "*.yaml")
    files = glob.glob(pattern)
    return {"specs": sorted([os.path.basename(f) for f in files])}


@app.get("/api/dag")
def get_dag(filename: str = Query(..., description="Target spec file in test_specs/V3")):
    spec_path = os.path.abspath(os.path.join(BASE_SPEC_DIR, filename))

    # Containment: reject any filename that escapes BASE_SPEC_DIR (path traversal).
    if os.path.commonpath([spec_path, BASE_SPEC_DIR]) != BASE_SPEC_DIR:
        raise HTTPException(status_code=400, detail="Invalid filename.")

    if not os.path.exists(spec_path):
        raise HTTPException(status_code=404, detail=f"Spec file '{filename}' not found.")
        
    try:
        return parse_spec_to_graph(spec_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Graph parsing failed: {str(e)}")

FRONTEND_DIST_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "static"))
assets_path = os.path.join(FRONTEND_DIST_PATH, "assets")

if os.path.exists(assets_path):
    app.mount("/assets", StaticFiles(directory=assets_path), name="assets")


@app.get("/{catchall:path}")
async def serve_frontend(catchall: str):
    """
    Catch-all route. If a request is not for /api or /assets, send the index.html.
    This lets the browser handle client-side routing smoothly.
    """
    index_file = os.path.join(FRONTEND_DIST_PATH, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    
    # Fallback message if you haven't run 'npm run build' yet
    return {
        "status": "Backend is running!",
        "error": "Frontend build files missing.",
        "help": f"Please run 'npm run build' inside your frontend directory to generate assets at: {FRONTEND_DIST_PATH}"
    }

if __name__ == "__main__":
    # pyrefly: ignore [missing-import]
    import uvicorn
    port = int(os.environ.get("API_PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)