import { useEffect, useMemo, useState } from "react"
import { ToolsetExtras } from "@/components/toolset-extras"

const BLURB = {
  "Custom Tools": "Compose higher-order tools from a toolset's operations.",
  Prompts: "Reusable prompt templates exposed alongside a toolset.",
  Environments: "Named variable/secret sets (API keys, base-url overrides) per toolset.",
  MCP: "Connect any MCP client (Claude Desktop, Cursor) to a toolset over SSE.",
  SDK: "Generated client code for a toolset's tools (Python / TypeScript / cURL).",
}

// Top-level dashboard page for a per-toolset resource. Reuses ToolsetExtras
// (the same panels shown in the Toolset detail tabs) with a toolset picker.
export function ResourcePage({ tab }) {
  const [toolsets, setToolsets] = useState([])
  const [toolsetId, setToolsetId] = useState("")

  useEffect(() => {
    fetch("/api/v1/toolsets")
      .then((r) => r.json())
      .then((d) => {
        const list = Object.values(d ?? {})
        setToolsets(list)
        if (list.length) setToolsetId(list[0].toolset_id)
      })
      .catch(() => setToolsets([]))
  }, [])

  const active = useMemo(() => toolsets.find((t) => t.toolset_id === toolsetId), [toolsets, toolsetId])
  const selectedTools = (active?.tools ?? []).filter((t) => t.selected)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <div className="flex flex-col gap-3 rounded-xl border border-white/30 glass-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-bold text-[#111827]">{tab}</h2>
            <p className="mt-0.5 text-xs text-[#6B7280]">{BLURB[tab]}</p>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <span className="text-[#9CA3AF]">Toolset</span>
            <select
              value={toolsetId}
              onChange={(e) => setToolsetId(e.target.value)}
              className="rounded-lg border border-white/30 bg-white/50 backdrop-blur-sm px-3 py-2 text-xs text-[#111827] outline-none focus:border-[#4B8BDB]"
            >
              {toolsets.length === 0 && <option value="">No toolsets yet</option>}
              {toolsets.map((t) => (
                <option key={t.toolset_id} value={t.toolset_id}>{t.toolset_id}</option>
              ))}
            </select>
          </label>
        </div>

        {toolsetId ? (
          <ToolsetExtras toolsetId={toolsetId} activeTab={tab} tools={selectedTools} />
        ) : (
          <div className="rounded-xl border border-dashed border-white/30 py-12 text-center text-sm text-[#9CA3AF]">
            Create a toolset first on the <span className="font-semibold">Toolsets</span> page.
          </div>
        )}
      </div>
    </div>
  )
}
