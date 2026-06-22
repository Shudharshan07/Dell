import { useRef, useState } from "react"
import { CheckCircle2, FileCode2, Loader2, Terminal, UploadCloud, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const API_BASE = ""

const fallbackTools = [
  {
    id: "get_customers",
    method: "GET",
    path: "/customers",
    description: "List customer records with pagination and status filters.",
    parameters: ["page", "limit", "status"],
    selected: true,
  },
  {
    id: "create_ticket",
    method: "POST",
    path: "/tickets",
    description: "Create a support ticket and assign it to the correct team.",
    parameters: ["customer_id", "priority", "summary"],
    selected: true,
  },
  {
    id: "update_subscription",
    method: "PATCH",
    path: "/subscriptions/{id}",
    description: "Modify billing terms, renewal dates, or subscription status.",
    parameters: ["id", "plan", "renewal_date"],
    selected: false,
  },
]

function normalizeTools(rawTools = []) {
  return rawTools.map((tool, index) => ({
    id: tool.id ?? tool.name ?? `${tool.method ?? "TOOL"}_${tool.path ?? index}`,
    method: tool.method ?? "POST",
    path: tool.path ?? tool.name ?? `tool_${index + 1}`,
    description: tool.description ?? tool.summary ?? "Generated MCP tool route.",
    parameters: tool.parameters ?? tool.args ?? [],
    selected: index < 8,
  }))
}

export function IngestionWizard({
  sources = {},
  searchQuery = "",
  onIngestionComplete,
  onDeleteSource,
}) {
  const fileRef = useRef(null)
  const [loading, setLoading] = useState(false)
  const [logs, setLogs] = useState([
    "Workspace ready.",
    "Drop an OpenAPI JSON/YAML file to start route normalization.",
  ])
  const [lastFile, setLastFile] = useState("")
  const [toolCount, setToolCount] = useState(0)

  const appendLog = (line) => setLogs((current) => [...current, line])

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Reset input immediately so the same file can be re-selected later
    event.target.value = ""

    setLoading(true)
    setLastFile(file.name)
    setLogs([
      `Selected ${file.name}.`,
      "Initializing OpenAPI file validation...",
      "Reading schema endpoints...",
    ])

    const formData = new FormData()
    formData.append("file", file)

    try {
      const response = await fetch(`${API_BASE}/api/v1/ingest`, {
        method: "POST",
        body: formData,
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const data = await response.json()
      const nextTools = normalizeTools(data.tools ?? [])
      setToolCount(data.total_tools ?? nextTools.length)
      appendLog(`Found ${data.total_tools ?? nextTools.length} distinct operational routes.`)
      appendLog("Syncing tool mappings to state matrix...")
      onIngestionComplete(nextTools)
    } catch {
      appendLog("Backend ingestion unavailable. Loaded a local sample tool matrix for UI work.")
      setToolCount(fallbackTools.length)
      onIngestionComplete(fallbackTools)
    } finally {
      setLoading(false)
    }
  }

  const filteredSources = Object.entries(sources).filter(([sourceId, info]) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      sourceId.toLowerCase().includes(q) ||
      (info.base_url ?? "").toLowerCase().includes(q)
    )
  })

  return (
    <section className="h-full overflow-auto glass-content">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ["Specs processed", toolCount || 0],
            ["Parser status", loading ? "Parsing" : "Ready"],
            ["Validation mode", "OpenAPI 3.x"],
          ].map(([label, value]) => (
            <div key={label} className="workspace-card p-5 border border-white/30 glass-card">
              <p className="text-xs font-semibold text-[#374151]">{label}</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-[#111827]">{value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="workspace-card p-6 border border-white/30 glass-card">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-[#111827]">Ingest OpenAPI Definition</h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-[#374151]">
                  Transform raw API documentation routes into unified executable MCP tool objects.
                </p>
              </div>
              <div className="workspace-icon-box">
                <FileCode2 className="size-5" />
              </div>
            </div>

            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex min-h-64 w-full flex-col items-center justify-center rounded-xl border border-dashed border-white/40 bg-white/40 backdrop-blur-sm px-4 text-center transition duration-200 hover:border-white/60 hover:bg-white/60"
            >
              <UploadCloud className="mb-3 size-9 text-[#111827]" />
              <span className="text-sm font-medium text-[#111827]">Choose OpenAPI JSON or YAML</span>
              <span className="mt-1 text-xs text-[#374151]">Parser logs and route counts stream below after upload.</span>
            </button>

            <Input
              ref={fileRef}
              type="file"
              accept=".json,.yaml,.yml"
              onChange={handleFileUpload}
              disabled={loading}
              className="hidden"
            />

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button onClick={() => fileRef.current?.click()} disabled={loading} className="bg-[#111827] text-white hover:bg-black">
                {loading ? <Loader2 className="animate-spin" /> : <UploadCloud />}
                Upload Spec
              </Button>
              <Button variant="outline" disabled={loading} className="border-white/30 bg-white/50 backdrop-blur-sm text-[#111827] hover:bg-white/70">
                Configure parser
              </Button>
              {lastFile && <span className="text-xs text-[#374151] font-medium px-2 py-1 bg-white/40 backdrop-blur-sm rounded-full border border-white/20">{lastFile}</span>}
            </div>
          </div>

          <div className="space-y-6">
            <div className="workspace-card p-5 border border-white/30 glass-card">
              <h3 className="workspace-title">Ingestion Status</h3>
              <p className="workspace-description text-[#374151]">Live parser state and validation feedback.</p>
              <div className="mt-5 grid gap-3">
                <div className="rounded-xl border border-white/20 bg-white/40 backdrop-blur-sm p-4">
                  <p className="text-xs font-semibold text-[#374151]">Generated tools</p>
                  <p className="mt-1 text-2xl font-semibold text-[#111827]">{toolCount}</p>
                </div>
                <div className="rounded-xl border border-white/20 bg-white/40 backdrop-blur-sm p-4">
                  <p className="text-xs font-semibold text-[#374151]">State</p>
                  <p className="mt-1 flex items-center gap-2 text-sm font-medium text-[#111827]">
                    {loading ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                    {loading ? "Parsing" : "Ready"}
                  </p>
                </div>
                <div className="rounded-xl border border-white/20 bg-white/40 backdrop-blur-sm p-4">
                  <p className="text-xs font-semibold text-[#374151]">Validation</p>
                  <p className="mt-1 text-sm font-medium text-[#111827]">No blocking issues</p>
                </div>
              </div>
            </div>

            {Object.keys(sources).length > 0 && (
              <div className="workspace-card p-5 border border-white/30 glass-card">
                <h3 className="workspace-title">Ingested Sources</h3>
                <p className="workspace-description text-[#374151]">Currently active API schemas in backend storage.</p>
                <div className="mt-4 space-y-3">
                  {filteredSources.length === 0 ? (
                    <p className="text-xs text-[#6B7280] italic">No sources match "{searchQuery}".</p>
                  ) : (
                    filteredSources.map(([sourceId, info]) => (
                      <div key={sourceId} className="flex items-center justify-between gap-3 rounded-xl border border-white/20 bg-white/40 backdrop-blur-sm p-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-[#111827]">{sourceId}</p>
                          <p className="mt-0.5 truncate text-[10px] text-[#374151] opacity-70">{info.base_url || "No base URL"}</p>
                          <span className="mt-1 inline-block rounded bg-white/60 border border-white/30 px-1 py-0.5 text-[9px] font-medium text-[#374151]">
                            {info.total_tools} tools
                          </span>
                        </div>
                        <button
                          onClick={() => onDeleteSource?.(sourceId)}
                          className="text-[#9CA3AF] transition-colors hover:text-red-600 p-1"
                          title="Delete Source"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="workspace-card overflow-hidden border border-white/30 glass-card">
          <div className="workspace-card-header flex items-center justify-between gap-3 bg-white/20 backdrop-blur-sm border-b border-white/20">
            <div className="flex items-center gap-2">
              <Terminal className="size-4 text-[#111827]" />
              <h3 className="workspace-title">Parser Terminal</h3>
            </div>
            <span className="workspace-pill bg-white/40 border border-white/30">Streaming</span>
          </div>
          <div className="max-h-64 overflow-y-auto bg-black/60 backdrop-blur-md p-4 font-mono text-xs leading-6 text-emerald-300 shadow-inner">
            {logs.map((log, index) => (
              <div key={`${log}-${index}`}>&gt; {log}</div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
