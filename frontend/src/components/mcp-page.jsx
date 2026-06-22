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
      className="inline-flex items-center gap-1 rounded-md border border-white/30 bg-white/50 backdrop-blur-sm px-2 py-1 text-[11px] font-semibold text-[#374151] transition hover:bg-white/70">
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
    <div className="h-full overflow-y-auto glass-content">
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <div className="flex items-center justify-between rounded-xl border border-white/30 glass-card p-4">
          <div className="flex items-center gap-2">
            <Layers className="size-5 text-[#111827]" />
            <div>
              <h2 className="text-sm font-bold text-[#111827]">Model Context Protocol</h2>
              <p className="mt-0.5 text-xs text-[#374151]">Live MCP server status + workflow tools exposed across all sources.</p>
            </div>
          </div>
          <button onClick={load} className="inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-white/50 backdrop-blur-sm px-3 py-2 text-xs font-semibold text-[#374151] transition hover:bg-white/70">
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>

        {loading && !status ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/40 bg-white/20 backdrop-blur-sm py-12 text-xs text-[#374151]">
            <Loader2 className="size-4 animate-spin" /> Pinging MCP server…
          </div>
        ) : status ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-white/30 glass-card p-4">
                <p className="text-xs font-semibold text-[#374151]">Server reachability</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className={`size-3 rounded-full ${status.reachable ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-red-500"}`} />
                  <span className={`text-sm font-bold ${status.reachable ? "text-emerald-700" : "text-red-600"}`}>{status.reachable ? "Reachable" : "Offline"}</span>
                </div>
                <p className="mt-1 font-mono text-[10px] text-[#374151] opacity-70">{status.sse_url}</p>
              </div>
              <div className="rounded-xl border border-white/30 glass-card p-4">
                <p className="text-xs font-semibold text-[#374151]">Workflow tools exposed</p>
                <p className="mt-2 font-mono text-2xl font-bold text-[#111827]">{status.tool_count}</p>
              </div>
              <div className="rounded-xl border border-white/30 glass-card p-4">
                <p className="text-xs font-semibold text-[#374151]">Sources</p>
                <p className="mt-2 font-mono text-2xl font-bold text-[#111827]">{status.source_count}</p>
              </div>
            </div>

            <div className="rounded-xl border border-white/30 glass-panel p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-[#111827]">MCP transport URL</h3>
                <CopyButton value={status.sse_url} />
              </div>
              <code className="mt-2 block rounded-lg border border-white/20 bg-white/40 px-3 py-2 font-mono text-xs text-[#374151] backdrop-blur-sm">{status.sse_url}</code>
            </div>

            <div className="rounded-xl border border-white/30 glass-panel p-4">
              <h3 className="text-xs font-bold text-[#111827]">Tools per source</h3>
              <div className="mt-2 space-y-2">
                {(status.sources ?? []).map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/20 bg-white/40 backdrop-blur-sm px-3 py-2">
                    <span className="truncate font-mono text-[11px] text-[#374151]">{s.id}</span>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-white/60 border border-white/30 px-2 py-0.5 text-[10px] font-bold text-[#374151]">{s.workflow_tools} tools</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-bold text-[#111827]">Connect your AI IDE / agent</h3>
              <p className="mb-3 text-[11px] text-[#374151]">
                Copy the block for your client. Any MCP-capable agent connects over streamable-http at the URL above; stdio-only clients are bridged via <code className="font-mono bg-white/30 px-1 rounded">mcp-remote</code>.
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {status.clients && Object.entries(status.clients).map(([key, cfg]) => {
                  const conf = cfg?.config ?? cfg
                  const label = cfg?.label ?? CLIENT_LABELS[key] ?? key
                  return (
                    <div key={key} className="rounded-xl border border-white/30 glass-card p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-[#111827]">{label}</div>
                          {cfg?.path && cfg.path !== "—" && (
                            <div className="truncate font-mono text-[10px] text-[#374151] opacity-70">{cfg.path}</div>
                          )}
                        </div>
                        <CopyButton value={conf} label="Copy" />
                      </div>
                      <pre className="mt-2 max-h-60 overflow-auto rounded-lg border border-white/20 bg-black/60 backdrop-blur-md p-3 font-mono text-[11px] leading-5 text-emerald-300 shadow-inner">
                        {JSON.stringify(conf, null, 2)}
                      </pre>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-white/40 bg-white/20 backdrop-blur-sm py-12 text-center text-xs text-[#374151]">Failed to load MCP status.</div>
        )}
      </div>
    </div>
  )
}
