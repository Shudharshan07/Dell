import { useMemo, useState, useEffect } from "react"
import { Bell, Command, Search } from "lucide-react"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { AppSidebar } from "@/components/app-sidebar"
import { DagViewer } from "@/components/dag-viewer"
import { IngestionWizard } from "@/components/ingestion-wizard"
import { ToolsetManager } from "@/components/toolset-manager"
import { AgentPlayground } from "@/components/agent-playground"
import { WorkflowView } from "@/components/workflow-view"
import { ResourcePage } from "@/components/resource-page"
import { EnvironmentsPage } from "@/components/environments-page"
import { McpPage } from "@/components/mcp-page"
import { SdkPage } from "@/components/sdk-page"
import { PromptsPage } from "@/components/prompts-page"
import { CustomToolsPage } from "@/components/custom-tools-page"

const RESOURCE_TABS = {
  "custom-tools": "Custom Tools",
  prompts: "Prompts",
  environments: "Environments",
  mcp: "MCP",
  sdks: "SDK",
}

const pageMeta = {
  ingest: {
    title: "OpenAPI Ingestion",
    description: "Upload a schema and convert routes into executable MCP tools.",
  },
  tools: {
    title: "Toolset Manager",
    description: "Curate focused tool groups and tune metadata before agent use.",
  },
  playground: {
    title: "Agent Playground",
    description: "Test prompts against a live execution trace workspace.",
  },
  dag: {
    title: "DAG Viewer",
    description: "Endpoint dependency graph.",
  },
  workflows: {
    title: "Workflow Proxy",
    description: "Cluster raw endpoints into workflow-level MCP tools.",
  },
  "custom-tools": {
    title: "Custom Tools",
    description: "Compose higher-order tools from a toolset's operations.",
  },
  prompts: {
    title: "Prompts",
    description: "Reusable prompt templates for your toolsets.",
  },
  environments: {
    title: "Environments",
    description: "Variable and secret sets, kept separate from tool logic.",
  },
  mcp: {
    title: "MCP",
    description: "Connect an MCP client to a toolset over SSE.",
  },
  sdks: {
    title: "SDKs",
    description: "Generated client code for a toolset's tools.",
  },
}

function normalizeTools(rawTools = []) {
  return rawTools.map((tool, index) => {
    let params = []
    if (Array.isArray(tool.parameters)) {
      params = tool.parameters.map(p => typeof p === 'object' && p ? (p.name || p.id) : p).filter(Boolean)
    } else if (Array.isArray(tool.args)) {
      params = tool.args
    }
    return {
      id: tool.operation_id ?? tool.id ?? tool.name ?? `${tool.method ?? "TOOL"}_${tool.path ?? index}`,
      method: tool.method ?? "POST",
      path: tool.path ?? tool.name ?? `tool_${index + 1}`,
      description: tool.description ?? tool.summary ?? "Generated MCP tool route.",
      parameters: params,
      selected: tool.selected !== undefined ? tool.selected : true,
    }
  })
}

export default function App() {
  const [activePage, setActivePage] = useState("tools")
  const [tools, setTools] = useState([])
  const [sources, setSources] = useState({})
  const [selectedSource, setSelectedSource] = useState("")

  const fetchSources = async () => {
    try {
      const response = await fetch("/api/v1/sources")
      if (response.ok) {
        const data = await response.json()
        setSources(data)
        return data
      }
    } catch (err) {
      console.error("Failed to fetch sources", err)
    }
    return null
  }

  const loadSourceTools = async (sourceId) => {
    if (!sourceId) return
    try {
      const response = await fetch(`/api/v1/sources/${sourceId}/tools`)
      if (response.ok) {
        const data = await response.json()
        const normalized = normalizeTools(data.tools ?? [])
        setTools(normalized)
      }
    } catch (err) {
      console.error("Failed to load source tools", err)
    }
  }

  const handleDeleteSource = async (sourceId) => {
    try {
      const res = await fetch(`/api/v1/sources/${sourceId}`, { method: "DELETE" })
      if (res.ok) {
        const updated = await fetchSources()
        if (updated && Object.keys(updated).length > 0) {
          const first = Object.keys(updated)[0]
          setSelectedSource(first)
          await loadSourceTools(first)
        } else {
          setSelectedSource("")
          setTools([])
        }
      }
    } catch (err) {
      console.error(err)
    }
  }

  const handleSaveToolset = async (selectedTools) => {
    if (!selectedSource) return
    try {
      const response = await fetch("/api/v1/toolsets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolset_id: selectedSource,
          tools: selectedTools
        })
      })
      if (response.ok) {
        alert(`Toolset for '${selectedSource}' saved successfully!`)
      } else {
        alert("Failed to save toolset to backend.")
      }
    } catch (err) {
      console.error(err)
      alert("Error saving toolset.")
    }
  }

  useEffect(() => {
    fetchSources().then((data) => {
      if (data) {
        const keys = Object.keys(data)
        if (keys.length > 0) {
          const firstSource = keys[0]
          setSelectedSource(firstSource)
          loadSourceTools(firstSource)
        }
      }
    })
  }, [])

  const currentPage = pageMeta[activePage]
  const pageContent = useMemo(() => {
    if (activePage === "ingest") {
      return (
        <IngestionWizard
          sources={sources}
          onIngestionComplete={async (nextTools) => {
            const updated = await fetchSources()
            if (updated && Object.keys(updated).length > 0) {
              // Select the newly ingested source if it's new
              const keys = Object.keys(updated)
              const latest = keys[keys.length - 1]
              setSelectedSource(latest)
              await loadSourceTools(latest)
            } else {
              setTools(nextTools)
            }
          }}
          onDeleteSource={handleDeleteSource}
        />
      )
    }

    if (activePage === "tools") {
      return (
        <ToolsetManager
          tools={tools}
          onToolsChange={setTools}
          sources={sources}
          selectedSource={selectedSource}
          onSourceChange={async (sourceId) => {
            setSelectedSource(sourceId)
            await loadSourceTools(sourceId)
          }}
          onSaveToolset={handleSaveToolset}
          onNavigatePage={setActivePage}
        />
      )
    }

    if (activePage === "playground") {
      return <AgentPlayground tools={tools} />
    }

    if (activePage === "workflows") {
      return <WorkflowView />
    }

    // Dedicated, purpose-built pages for the resource sidebar ids.
    if (activePage === "environments") return <EnvironmentsPage />
    if (activePage === "mcp") return <McpPage />
    if (activePage === "sdks") return <SdkPage />
    if (activePage === "prompts") return <PromptsPage />
    if (activePage === "custom-tools") return <CustomToolsPage />

    // Fallback (kept for safety): generic ResourcePage wrapper over ToolsetExtras.
    if (RESOURCE_TABS[activePage]) {
      return <ResourcePage tab={RESOURCE_TABS[activePage]} />
    }

    return <DagViewer />
  }, [activePage, tools, sources, selectedSource])


  return (
    <div className="min-h-screen bg-[#EDEDEB] text-[#111827] antialiased">
      <TooltipProvider>
        <SidebarProvider>
          <AppSidebar activePage={activePage} onPageChange={setActivePage} />
          <main className="flex flex-1 flex-col overflow-hidden">
            {activePage !== "tools" && (
              <header className="flex h-14 items-center gap-3 border-b border-[#D1CFCA] bg-white px-4">
                <SidebarTrigger className="rounded-lg text-[#706F6B] hover:bg-[#EAE8E3] hover:text-[#111827]" />
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-sm font-semibold text-[#111827]">{currentPage?.title}</h1>
                  <p className="truncate text-xs text-[#706F6B]">{currentPage?.description}</p>
                </div>
                <div className="hidden w-full max-w-md items-center gap-2 rounded-lg border border-[#D1CFCA] bg-[#EDEDEB] px-3 py-2 text-sm text-[#706F6B] lg:flex">
                  <Search className="size-4" />
                  <span className="flex-1">Search workflows, tools, traces...</span>
                  <span className="inline-flex items-center gap-1 rounded-md border border-[#D1CFCA] bg-white px-1.5 py-0.5 text-[11px] text-[#706F6B]">
                    <Command className="size-3" /> K
                  </span>
                </div>
                <Button variant="ghost" size="icon-sm" className="rounded-lg text-[#706F6B] hover:bg-[#EAE8E3] hover:text-[#111827]">
                  <Bell className="size-4" />
                </Button>
              </header>
            )}
            <div className="flex-1 overflow-hidden bg-[#EDEDEB]">
              {pageContent}
            </div>
          </main>
        </SidebarProvider>
      </TooltipProvider>
    </div>
  )
}
