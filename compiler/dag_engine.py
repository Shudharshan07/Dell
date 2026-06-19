import networkx as nx
# pyrefly: ignore [missing-import]
from prance import ResolvingParser
import os

class OpenAPIDagEngine:
    def __init__(self, spec_path: str):
        if not os.path.exists(spec_path):
            raise FileNotFoundError(f"Specification file not found at: {spec_path}")
            
        self.graph = nx.DiGraph()
        
        # Step 1: Read and clean the spec text content
        with open(spec_path, 'r', encoding='utf-8', errors='ignore') as f:
            raw_content = f.read()
            
        # Sanitize the exact structural anomaly line "- =" -> replace with valid YAML string
        sanitized_content = raw_content.replace("- =", '- ""')
        
        # Step 2: Write it out to a temporary hidden file in the same directory 
        dir_name = os.path.dirname(spec_path)
        self.temp_spec_path = os.path.join(dir_name, "_temp_sanitized_spec.yaml")
        
        with open(self.temp_spec_path, 'w', encoding='utf-8') as f:
            f.write(sanitized_content)
            
        # Step 3: Parse our safe temporary file path with recursive settings allowed
        try:
            self.parser = ResolvingParser(
                self.temp_spec_path, 
                lazy=True, 
                strict=False,
                recursion_limit=20,     # Allow deep recursive object matching for Jira/Enterprise schemas
                recursion_raise=False   # Do not raise an exception when a circular reference loop is caught
            )
            self.parser.parse()
            self.spec = self.parser.specification
        finally:
            # Step 4: Clean up temporary file
            if os.path.exists(self.temp_spec_path):
                os.remove(self.temp_spec_path)
        
    def build_dag(self):
        paths = self.spec.get("paths", {}) or {}
        
        # Step 1: Extract EVERY Endpoint Node safely
        for path, methods in paths.items():
            if not methods or not isinstance(methods, dict):
                continue
                
            for method, details in methods.items():
                if method.lower() in ['get', 'post', 'put', 'delete', 'patch']:
                    if not isinstance(details, dict):
                        continue
                        
                    node_id = f"{method.upper()} {path}"
                    
                    self.graph.add_node(
                        node_id,
                        path=path,
                        method=method.upper(),
                        summary=details.get("summary", details.get("operationId", path)),
                        description=details.get("description", ""),
                        operation_id=details.get("operationId", f"{method}_{path.replace('/', '_')}"),
                        parameters=details.get("parameters", [])
                    )

        # Step 2: Establish Relational Edges using standard REST structural logic
        nodes = list(self.graph.nodes(data=True))
        for source_id, source_data in nodes:
            source_path = source_data['path']
            source_clean = source_path.rstrip('/')
            
            for target_id, target_data in nodes:
                target_path = target_data['path']
                
                # Rule A: Identity/Instance Mapping (e.g., /resource -> /resource/{id})
                if target_path.startswith(source_clean + "/{") or target_path.startswith(source_clean + "/:"):
                    if source_data['method'] in ['POST', 'GET']:
                        self.graph.add_edge(source_id, target_id, type="instance_dependency")
                
                # Rule B: Actions/Sub-routes (e.g., /resource/{id} -> /resource/{id}/actions)
                elif "{" in source_path and target_path.startswith(source_path + "/"):
                    self.graph.add_edge(source_id, target_id, type="subresource_dependency")

        return self.graph

    def to_json(self):
        return {
            "summary": {
                "total_endpoints": self.graph.number_of_nodes(),
                "detected_dependencies": self.graph.number_of_edges()
            },
            "nodes": [
                {
                    "id": node, 
                    "method": data["method"], 
                    "summary": data["summary"],
                    "path": data["path"]
                } 
                for node, data in self.graph.nodes(data=True)
            ],
            "links": [
                {"source": u, "target": v, "type": data["type"]} 
                for u, v, data in self.graph.edges(data=True)
            ]
        }