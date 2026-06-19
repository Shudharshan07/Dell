Frontend Specification: Gram Workspace UI (React + Shadcn UI + Tailwind)
This document outlines the UI architecture, state management, and critical components for the Gram platform frontend client.

1. Project Setup & Component Architecture
The workspace relies on a multi-panel layout designed to handle massive toolsets and stream live orchestration paths without layout shifting.

Directory Layout
Plaintext
src/
├── components/
│   ├── ui/                 # Stock Shadcn UI primitives (Button, Dialog, Accordion, etc.)
│   ├── IngestionWizard.jsx # OpenAPI Drag & Drop + Parser log terminal
│   ├── ToolsetManager.jsx  # virtualized tool list + description override forms
│   ├── CustomToolEditor.jsx# Workflow builder canvas for meta-prompts
│   └── AgentPlayground.jsx # Chat container + Expandable trace drawer
├── hooks/
│   useMcpStreaming.js      # WebSocket / SSE handling for live execution traces
└── App.jsx
2. Core Functional Components
A. OpenAPI Ingestion Wizard
This component handles specification uploads and streams the backend parser metrics step-by-step.

UI Elements: Shadcn Card, Input (type="file"), and an automated parsing terminal wrapper.

Component Code Example:

JavaScript
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function IngestionWizard({ onIngestionComplete }) {
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    setLogs(["Initializing openapi file validation...", "Reading schema endpoints..."]);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("http://localhost:8000/api/v1/ingest", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      
      setLogs(prev => [...prev, `Found ${data.total_tools} distinct operational routes.`, "Syncing tool mappings to state matrix..."]);
      onIngestionComplete(data.tools);
    } catch (err) {
      setLogs(prev => [...prev, "ERROR: Ingestion failure. Check file syntax structure."]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-slate-800 bg-slate-900 text-slate-100">
      <CardHeader>
        <CardTitle>Ingest OpenApi Definition</CardTitle>
        <CardDescription className="text-slate-400">Transform raw API documentation routes into unified executable MCP tool objects.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input type="file" accept=".json,.yaml,.yml" onChange={handleFileUpload} disabled={loading} className="bg-slate-950 border-slate-800" />
        
        {logs.length > 0 && (
          <div className="p-3 bg-slate-950 rounded-md font-mono text-xs space-y-1 max-h-40 overflow-y-auto text-emerald-400 border border-slate-800">
            {logs.map((log, index) => <div key={index}>&gt; {log}</div>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
B. Dynamic Toolset Manager & Context Customizer
Allows developers to curate isolated sub-groups (5-30 tools max) from the master database matrix and manually optimize descriptions.

UI Elements: Shadcn ScrollArea, Accordion (to inspect parameter payloads), and inline edit toggles.

Layout Design: Split layout. Left pane: Searchable parsed routes with checkboxes. Right pane: Curated toolset with configuration fields to refine metadata (e.g., specifying units like "cents").

C. Agent Playground & Live Execution Trace Drawer
The core testing workspace. It features a chat container on the left, and a sliding drawer tracking the real-time execution chain on the right.

Trace Engine Design: When a message is sent, a sliding panel records backend tool tracking calls. If an execution takes multiple steps, each action pops into view as it happens, displaying arguments and live duration counters.