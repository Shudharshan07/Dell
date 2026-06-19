import { useEffect, useState } from "react"
import { Layers, RefreshCw, Copy, Check, Loader2 } from "lucide-react"

function CopyButton({ value, label = "Copy" }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(typeof value === "string" ? value : JSON.stringify(value, null, 2))
        setDone(true); setTimeout(() => setDone(false), 1500)
      }}
      className="inline-flex items-center gap-1 rounded-md border border-[#D0CECA] bg-white px-2 py-1 text-[11px] font-semibold text-[#55534E] transition hover:bg-[#EAE8E3]">
      {done ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}{done ? "Copied" : label}
    </button>
  )
}

const CLIENT_LABELS = {
  claude_desktop: "Claude Desktop · claude_desktop_config.json",
  cursor: "Cursor · mcp.json",
  windsurf: "Windsurf · mcp_config.json",
}

export function McpPage() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    fetch("/api/v1/mcp/status").then((r) => r.json()).then(setStatus).catch(() => setStatus(null)).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  return (
    <div className="h-full overflow-y-auto bg-[#EDEDEB]">
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <div className="flex items-center justify-between rounded-xl border border-[#D1CFCA] bg-white p-4">
          <div className="flex items-center gap-2">
            <Layers className="size-5 text-[#111827]" />
            <div>
              <h2 className="text-sm font-bold text-[#111827]">Model Context Protocol</h2>
              <p className="mt-0.5 text-xs text-[#6B7280]">Live SSE server status + workflow tools exposed across all sources.</p>
            </div>
          </div>
          <button onClick={load} className="inline-flex items-center gap-1.5 rounded-full border border-[#D1CFCA] bg-white px-3 py-2 text-xs font-semibold text-[#55534E] transition hover:bg-[#EAE8E3]">
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>

        {loading && !status ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-[#D0CECA] py-12 text-xs text-[#787670]">
            <Loader2 className="size-4 animate-spin" /> Pinging MCP server…
          </div>
        ) : status ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[#D1CFCA] bg-white p-4">
                <p className="text-xs font-semibold text-[#6B7280]">Server reachability</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className={`size-3 rounded-full ${status.reachable ? "bg-emerald-500" : "bg-red-500"}`} />
                  <span className={`text-sm font-bold ${status.reachable ? "text-emerald-700" : "text-red-600"}`}>{status.reachable ? "Reachable" : "Offline"}</span>
                </div>
                <p className="mt-1 font-mono text-[10px] text-[#9CA3AF]">{status.sse_url}</p>
              </div>
              <div className="rounded-xl border border-[#D1CFCA] bg-white p-4">
                <p className="text-xs font-semibold text-[#6B7280]">Workflow tools exposed</p>
                <p className="mt-2 font-mono text-2xl font-bold text-[#111827]">{status.tool_count}</p>
              </div>
              <div className="rounded-xl border border-[#D1CFCA] bg-white p-4">
                <p className="text-xs font-semibold text-[#6B7280]">Sources</p>
                <p className="mt-2 font-mono text-2xl font-bold text-[#111827]">{status.source_count}</p>
              </div>
            </div>

            <div className="rounded-xl border border-[#D1CFCA] bg-white p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-[#111827]">SSE transport URL</h3>
                <CopyButton value={status.sse_url} />
              </div>
              <code className="mt-2 block rounded-lg border border-[#D0CECA] bg-[#FAFAFA] px-3 py-2 font-mono text-xs text-[#55534E]">{status.sse_url}</code>
            </div>

            <div className="rounded-xl border border-[#D1CFCA] bg-white p-4">
              <h3 className="text-xs font-bold text-[#111827]">Tools per source</h3>
              <div className="mt-2 space-y-2">
                {(status.sources ?? []).map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-[#E5E7EB] bg-[#FAFAFA] px-3 py-2">
                    <span className="truncate font-mono text-[11px] text-[#55534E]">{s.id}</span>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-[#EAE8E3] px-2 py-0.5 text-[10px] font-bold text-[#55534E]">{s.workflow_tools} tools</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {status.clients && Object.entries(status.clients).map(([key, cfg]) => (
              <div key={key} className="rounded-xl border border-[#D1CFCA] bg-white p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#111827]">{CLIENT_LABELS[key] ?? key}</span>
                  <CopyButton value={cfg} label="Copy JSON" />
                </div>
                <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-[#D0CECA] bg-[#1E1E1E] p-3 font-mono text-[11px] leading-5 text-emerald-300">
                  {JSON.stringify(cfg, null, 2)}
                </pre>
              </div>
            ))}
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-[#D0CECA] py-12 text-center text-xs text-[#787670]">Failed to load MCP status.</div>
        )}
      </div>
    </div>
  )
}
