import { useEffect, useState } from "react"
import { Copy, Check, Plus, Trash2, Boxes, FileText, Server, Code2, KeyRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

function CopyButton({ value, label = "Copy" }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(typeof value === "string" ? value : JSON.stringify(value, null, 2))
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
      className="inline-flex items-center gap-1 rounded-md border border-[#D0CECA] bg-white px-2 py-1 text-[11px] font-semibold text-[#55534E] transition hover:bg-[#EAE8E3]"
    >
      {done ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
      {done ? "Copied" : label}
    </button>
  )
}

function CodeBlock({ text }) {
  return (
    <pre className="max-h-80 overflow-auto rounded-lg border border-[#D0CECA] bg-[#1E1E1E] p-3 font-mono text-[11px] leading-5 text-emerald-300">
      {text}
    </pre>
  )
}

function EmptyState({ icon: Icon, text }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#D0CECA] py-10 text-center text-xs text-[#787670]">
      <Icon className="size-5" />
      {text}
    </div>
  )
}

export function ToolsetExtras({ toolsetId, activeTab, tools = [] }) {
  const base = `/api/v1/toolsets/${toolsetId}`

  // collection state
  const [items, setItems] = useState([])
  const [mcp, setMcp] = useState(null)
  const [sdk, setSdk] = useState(null)
  const [sdkLang, setSdkLang] = useState("python")
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({})

  const collectionPath = {
    "Custom Tools": "custom-tools",
    Prompts: "prompts",
    Environments: "environments",
  }[activeTab]

  const collectionKey = {
    "Custom Tools": "custom_tools",
    Prompts: "prompts",
    Environments: "environments",
  }[activeTab]

  // fetch on tab / toolset change
  useEffect(() => {
    setCreating(false)
    setForm({})
    if (collectionPath) {
      fetch(`${base}/${collectionPath}`)
        .then((r) => r.json())
        .then((d) => setItems(d[collectionKey] ?? []))
        .catch(() => setItems([]))
    } else if (activeTab === "MCP") {
      fetch(`${base}/mcp-config`).then((r) => r.json()).then(setMcp).catch(() => setMcp(null))
    } else if (activeTab === "SDK") {
      fetch(`${base}/sdk?lang=${sdkLang}`).then((r) => r.json()).then(setSdk).catch(() => setSdk(null))
    }
  }, [toolsetId, activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === "SDK") {
      fetch(`${base}/sdk?lang=${sdkLang}`).then((r) => r.json()).then(setSdk).catch(() => setSdk(null))
    }
  }, [sdkLang]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () =>
    fetch(`${base}/${collectionPath}`)
      .then((r) => r.json())
      .then((d) => setItems(d[collectionKey] ?? []))

  const createItem = async (payload) => {
    const r = await fetch(`${base}/${collectionPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (r.ok) {
      await refresh()
      setCreating(false)
      setForm({})
    }
  }

  const deleteItem = async (id) => {
    await fetch(`${base}/${collectionPath}/${id}`, { method: "DELETE" })
    refresh()
  }

  // ── MCP ────────────────────────────────────────────────────────────────────
  if (activeTab === "MCP") {
    if (!mcp) return <EmptyState icon={Server} text="Loading MCP configuration…" />
    const rows = [
      ["SSE transport URL", mcp.sse_url],
      ["FastMCP run command", mcp.fastmcp_command],
    ]
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-[#D1CFCA] bg-white p-5 space-y-4">
          <div>
            <h4 className="text-sm font-bold text-[#111827]">Model Context Protocol</h4>
            <p className="mt-1 text-xs text-[#787670]">
              Connect an MCP client (Claude Desktop, Cursor) to this toolset's {mcp.tool_count} tools over SSE.
            </p>
          </div>
          {rows.map(([label, val]) => (
            <div key={label} className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-[#787670]">{label}</span>
              <div className="flex items-center justify-between gap-2 rounded-lg border border-[#D0CECA] bg-[#FAFAFA] px-3 py-2 font-mono text-xs text-[#55534E]">
                <span className="truncate">{val}</span>
                <CopyButton value={val} />
              </div>
            </div>
          ))}
        </div>
        {[
          ["Claude Desktop · claude_desktop_config.json", mcp.claude_desktop_config],
          ["Cursor · mcp.json", mcp.cursor_config],
        ].map(([label, cfg]) => (
          <div key={label} className="rounded-xl border border-[#D1CFCA] bg-white p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#111827]">{label}</span>
              <CopyButton value={cfg} label="Copy JSON" />
            </div>
            <CodeBlock text={JSON.stringify(cfg, null, 2)} />
          </div>
        ))}
      </div>
    )
  }

  // ── SDK ────────────────────────────────────────────────────────────────────
  if (activeTab === "SDK") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {["python", "typescript", "curl"].map((l) => (
              <button
                key={l}
                onClick={() => setSdkLang(l)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize transition ${
                  sdkLang === l
                    ? "border-[#111827] bg-[#111827] text-white"
                    : "border-[#D1CFCA] bg-white text-[#787670] hover:bg-[#EAE8E3]"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          {sdk?.code && <CopyButton value={sdk.code} label="Copy code" />}
        </div>
        {sdk ? (
          <>
            <p className="text-xs text-[#787670]">
              Client snippet for this toolset's {sdk.tool_count} tools — calls run through the local proxy.
            </p>
            <CodeBlock text={sdk.code} />
          </>
        ) : (
          <EmptyState icon={Code2} text="Generating SDK…" />
        )}
      </div>
    )
  }

  // ── collection tabs (Custom Tools / Prompts / Environments) ─────────────────
  const headerByTab = {
    "Custom Tools": { icon: Boxes, blurb: "Compose higher-order tools from one or more existing operations." },
    Prompts: { icon: FileText, blurb: "Reusable prompt templates exposed alongside this toolset." },
    Environments: { icon: KeyRound, blurb: "Named variable/secret sets (API keys, base-url overrides) kept separate from tool logic." },
  }[activeTab] || { icon: Boxes, blurb: "" }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-[#787670]">{headerByTab.blurb}</p>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#111827] px-4 py-2 text-xs font-semibold text-white transition hover:bg-black"
          >
            <Plus className="size-3.5" /> New
          </button>
        )}
      </div>

      {/* create form */}
      {creating && (
        <div className="space-y-3 rounded-xl border border-[#D1CFCA] bg-white p-4">
          <Input
            placeholder="Name"
            value={form.name ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="bg-white"
          />

          {activeTab === "Prompts" && (
            <>
              <Input
                placeholder="Description"
                value={form.description ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
              <textarea
                placeholder="Prompt template…"
                rows={4}
                value={form.content ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                className="w-full rounded-lg border border-[#D0CECA] bg-[#FAFAFA] px-3 py-2 font-mono text-xs outline-none focus:border-[#111827]"
              />
            </>
          )}

          {activeTab === "Environments" && (
            <textarea
              placeholder={"VARIABLES (one KEY=VALUE per line)\nAPI_KEY=sk-...\nBASE_URL=https://api.example.com"}
              rows={4}
              value={form.varsText ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, varsText: e.target.value }))}
              className="w-full rounded-lg border border-[#D0CECA] bg-[#FAFAFA] px-3 py-2 font-mono text-xs outline-none focus:border-[#111827]"
            />
          )}

          {activeTab === "Custom Tools" && (
            <>
              <Input
                placeholder="Description"
                value={form.description ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
              <div>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#787670]">Steps (ordered operations)</p>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-[#D0CECA] bg-[#FAFAFA] p-2">
                  {tools.length === 0 && <p className="px-1 text-xs text-[#787670]">No tools in this toolset.</p>}
                  {tools.map((t) => {
                    const steps = form.steps ?? []
                    const checked = steps.includes(t.id)
                    return (
                      <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-white">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setForm((f) => ({
                              ...f,
                              steps: checked ? steps.filter((s) => s !== t.id) : [...steps, t.id],
                            }))
                          }
                        />
                        <span className="font-mono text-[11px] text-emerald-600">{t.method}</span>
                        <span className="truncate font-mono text-[11px] text-[#55534E]">{t.id}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              size="sm"
              className="bg-[#111827] text-white hover:bg-black"
              disabled={!form.name?.trim()}
              onClick={() => {
                if (activeTab === "Prompts")
                  createItem({ name: form.name, description: form.description ?? "", content: form.content ?? "" })
                else if (activeTab === "Environments") {
                  const variables = {}
                  ;(form.varsText ?? "").split("\n").forEach((line) => {
                    const i = line.indexOf("=")
                    if (i > 0) variables[line.slice(0, i).trim()] = line.slice(i + 1).trim()
                  })
                  createItem({ name: form.name, variables })
                } else
                  createItem({ name: form.name, description: form.description ?? "", steps: form.steps ?? [] })
              }}
            >
              Save
            </Button>
          </div>
        </div>
      )}

      {/* list */}
      {items.length === 0 && !creating ? (
        <EmptyState icon={headerByTab.icon} text={`No ${activeTab.toLowerCase()} yet.`} />
      ) : (
        <div className="space-y-3">
          {items.map((it) => (
            <div key={it.id} className="rounded-xl border border-[#D1CFCA] bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-[#111827]">{it.name}</h4>
                  {it.description && <p className="mt-0.5 text-xs text-[#787670]">{it.description}</p>}
                </div>
                <button onClick={() => deleteItem(it.id)} className="shrink-0 rounded-lg p-1.5 text-[#787670] transition hover:bg-red-50 hover:text-red-600">
                  <Trash2 className="size-4" />
                </button>
              </div>

              {activeTab === "Prompts" && it.content && (
                <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-[#D0CECA] bg-[#FAFAFA] p-2 font-mono text-[11px] text-[#55534E]">{it.content}</pre>
              )}
              {activeTab === "Environments" && (
                <div className="mt-2 space-y-1">
                  {Object.entries(it.variables ?? {}).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2 font-mono text-[11px]">
                      <span className="font-semibold text-[#111827]">{k}</span>
                      <span className="text-[#9CA3AF]">=</span>
                      <span className="truncate text-[#55534E]">{String(v)}</span>
                    </div>
                  ))}
                  {Object.keys(it.variables ?? {}).length === 0 && (
                    <p className="text-[11px] text-[#787670]">No variables.</p>
                  )}
                </div>
              )}
              {activeTab === "Custom Tools" && (it.steps ?? []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {it.steps.map((s, idx) => (
                    <span key={`${s}-${idx}`} className="rounded bg-[#EAE8E3] px-2 py-0.5 font-mono text-[10px] text-[#55534E]">
                      {idx + 1}. {s}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
