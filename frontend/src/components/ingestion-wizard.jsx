import { useRef, useState } from "react"
import { CheckCircle2, FileCode2, Loader2, Terminal, UploadCloud } from "lucide-react"
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

export function IngestionWizard({ onIngestionComplete }) {
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
      event.target.value = ""
    }
  }

  return (
    <section className="h-full overflow-auto">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ["Specs processed", toolCount || 0],
            ["Parser status", loading ? "Parsing" : "Ready"],
            ["Validation mode", "OpenAPI 3.x"],
          ].map(([label, value]) => (
            <div key={label} className="workspace-card p-5">
              <p className="workspace-subtle">{label}</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-[#111827]">{value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="workspace-card p-6">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-[#111827]">Ingest OpenAPI Definition</h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-[#6B7280]">
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
              className="flex min-h-64 w-full flex-col items-center justify-center rounded-xl border border-dashed border-[#D1D5DB] bg-[#FAFAFA] px-4 text-center transition duration-200 hover:border-[#111827] hover:bg-white"
            >
              <UploadCloud className="mb-3 size-9 text-[#111827]" />
              <span className="text-sm font-medium text-[#111827]">Choose OpenAPI JSON or YAML</span>
              <span className="mt-1 text-xs text-[#6B7280]">Parser logs and route counts stream below after upload.</span>
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
              <Button variant="outline" disabled={loading} className="border-[#E5E7EB] bg-white text-[#111827] hover:bg-[#F3F4F6]">
                Configure parser
              </Button>
              {lastFile && <span className="text-xs text-[#6B7280]">{lastFile}</span>}
            </div>
          </div>

          <div className="workspace-card p-5">
            <h3 className="workspace-title">Ingestion Status</h3>
            <p className="workspace-description">Live parser state and validation feedback.</p>
            <div className="mt-5 grid gap-3">
              <div className="rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] p-4">
                <p className="workspace-subtle">Generated tools</p>
                <p className="mt-1 text-2xl font-semibold text-[#111827]">{toolCount}</p>
              </div>
              <div className="rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] p-4">
                <p className="workspace-subtle">State</p>
                <p className="mt-1 flex items-center gap-2 text-sm font-medium text-[#111827]">
                  {loading ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  {loading ? "Parsing" : "Ready"}
                </p>
              </div>
              <div className="rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] p-4">
                <p className="workspace-subtle">Validation</p>
                <p className="mt-1 text-sm font-medium text-[#111827]">No blocking issues</p>
              </div>
            </div>
          </div>
        </div>

        <div className="workspace-card overflow-hidden">
          <div className="workspace-card-header flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Terminal className="size-4 text-[#111827]" />
              <h3 className="workspace-title">Parser Terminal</h3>
            </div>
            <span className="workspace-pill">Streaming</span>
          </div>
          <div className="max-h-64 overflow-y-auto bg-white p-4 font-mono text-xs leading-6 text-[#374151]">
            {logs.map((log, index) => (
              <div key={`${log}-${index}`}>&gt; {log}</div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
