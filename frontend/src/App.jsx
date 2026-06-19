import { useMemo, useState } from "react"
import { Bell, Command, Search } from "lucide-react"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { AppSidebar } from "@/components/app-sidebar"
import { DagViewer } from "@/components/dag-viewer"
import { IngestionWizard } from "@/components/ingestion-wizard"
import { ToolsetManager } from "@/components/toolset-manager"
import { AgentPlayground } from "@/components/agent-playground"

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
}

export default function App() {
  const [activePage, setActivePage] = useState("ingest")
  const [tools, setTools] = useState([])

  const currentPage = pageMeta[activePage]
  const pageContent = useMemo(() => {
    if (activePage === "ingest") {
      return <IngestionWizard onIngestionComplete={setTools} />
    }

    if (activePage === "tools") {
      return <ToolsetManager tools={tools} onToolsChange={setTools} />
    }

    if (activePage === "playground") {
      return <AgentPlayground tools={tools} />
    }

    return <DagViewer />
  }, [activePage, tools])

  return (
    <div className="min-h-screen bg-[#FAFAFA] text-[#111827] antialiased">
      <TooltipProvider>
        <SidebarProvider>
          <AppSidebar activePage={activePage} onPageChange={setActivePage} />
          <main className="flex flex-1 flex-col overflow-hidden">
            <header className="flex h-14 items-center gap-3 border-b border-[#E5E7EB] bg-white px-4">
              <SidebarTrigger className="rounded-lg text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827]" />
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-sm font-semibold text-[#111827]">{currentPage.title}</h1>
                <p className="truncate text-xs text-[#6B7280]">{currentPage.description}</p>
              </div>
              <div className="hidden w-full max-w-md items-center gap-2 rounded-lg border border-[#E5E7EB] bg-[#FAFAFA] px-3 py-2 text-sm text-[#9CA3AF] lg:flex">
                <Search className="size-4" />
                <span className="flex-1">Search workflows, tools, traces...</span>
                <span className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-1.5 py-0.5 text-[11px] text-[#6B7280]">
                  <Command className="size-3" /> K
                </span>
              </div>
              <Button variant="ghost" size="icon-sm" className="rounded-lg text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827]">
                <Bell className="size-4" />
              </Button>
              <div className="flex size-8 items-center justify-center rounded-full bg-[#111827] text-xs font-semibold text-white">
                GR
              </div>
            </header>
            <div className="flex-1 overflow-hidden bg-[#FAFAFA]">
              {pageContent}
            </div>
          </main>
        </SidebarProvider>
      </TooltipProvider>
    </div>
  )
}
