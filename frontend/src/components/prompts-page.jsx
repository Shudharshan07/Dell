import { useEffect, useMemo, useState } from "react"
import { FileCode, Plus, Trash2, Copy, Check, Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const VAR_RE = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g
function detectVars(text) {
  const seen = []
  let m
  VAR_RE.lastIndex = 0
  while ((m = VAR_RE.exec(text ?? "")) !== null) if (!seen.includes(m[1])) seen.push(m[1])
  return seen
}
function render(text, values) {
  return (text ?? "").replace(VAR_RE, (full, k) => (k in (values ?? {}) && values[k] !== "" ? values[k] : full))
}

export function PromptsPage() {
  const [toolsets, setToolsets] = useState([])
  const [toolsetId, setToolsetId] = useState("")
  const [items, setItems] = useState([])
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: "", description: "", content: "" })
  const [values, setValues] = useState({})       // for the create-form live preview
  const [activeId, setActiveId] = useState(null)  // saved prompt being filled
  const [savedValues, setSavedValues] = useState({})
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch("/api/v1/toolsets").then((r) => r.json()).then((d) => {
      const list = Object.values(d ?? {})
      setToolsets(list)
      if (list.length) setToolsetId(list[0].toolset_id)
    }).catch(() => setToolsets([]))
  }, [])

  const base = toolsetId ? `/api/v1/toolsets/${toolsetId}/prompts` : null
  const refresh = () => base && fetch(base).then((r) => r.json()).then((d) => setItems(d.prompts ?? [])).catch(() => setItems([]))
  useEffect(() => { setCreating(false); setActiveId(null); refresh() }, [toolsetId]) // eslint-disable-line react-hooks/exhaustive-deps

  const formVars = useMemo(() => detectVars(form.content), [form.content])

  const create = async () => {
    const r = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) })
    if (r.ok) { setCreating(false); setForm({ name: "", description: "", content: "" }); setValues({}); refresh() }
  }
  const remove = async (id) => { await fetch(`${base}/${id}`, { method: "DELETE" }); refresh() }

  const active = items.find((it) => it.id === activeId)
  const activeVars = active ? (active.variables ?? detectVars(active.content)) : []
  const filled = active ? render(active.content, savedValues) : ""

  const sendToPlayground = (text) => {
    try { localStorage.setItem("playground_prompt", text) } catch { /* ignore */ }
    navigator.clipboard.writeText(text)
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="h-full overflow-y-auto glass-content">
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <div className="flex flex-col gap-3 rounded-xl border border-white/30 glass-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <FileCode className="size-5 text-[#111827]" />
            <div>
              <h2 className="text-sm font-bold text-[#111827]">Prompts</h2>
              <p className="mt-0.5 text-xs text-[#374151]">Templates with <code className="rounded bg-white/40 px-1 backdrop-blur-sm border border-white/20">{"{{variable}}"}</code> detection, live preview, and Send-to-Playground.</p>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <span className="text-[#374151]">Toolset</span>
            <select value={toolsetId} onChange={(e) => setToolsetId(e.target.value)}
              className="rounded-lg border border-white/30 bg-white/50 backdrop-blur-sm px-3 py-2 text-xs text-[#111827] outline-none focus:border-[#4B8BDB]">
              {toolsets.length === 0 && <option value="">No toolsets</option>}
              {toolsets.map((t) => <option key={t.toolset_id} value={t.toolset_id}>{t.toolset_id}</option>)}
            </select>
          </label>
        </div>

        {!toolsetId ? (
          <div className="rounded-xl border border-dashed border-white/40 bg-white/20 backdrop-blur-sm py-12 text-center text-xs text-[#374151]">Create a toolset first.</div>
        ) : (
          <>
            <div className="flex justify-end">
              {!creating && (
                <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 rounded-full bg-[#111827] px-4 py-2 text-xs font-semibold text-white transition hover:bg-black">
                  <Plus className="size-3.5" /> New prompt
                </button>
              )}
            </div>

            {creating && (
              <div className="grid grid-cols-1 gap-3 rounded-xl border border-white/30 glass-card p-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <Input placeholder="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                  <Input placeholder="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
                  <textarea rows={6} placeholder={"Prompt template…\nWrite a story about {{topic}} for {{audience}}."} value={form.content}
                    onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                    className="w-full rounded-lg border border-white/30 bg-white/40 backdrop-blur-sm px-3 py-2 font-mono text-xs outline-none focus:border-[#4B8BDB] placeholder:text-[#6B7280]" />
                  <div className="flex flex-wrap gap-1.5">
                    {formVars.length === 0 ? <span className="text-[11px] text-[#6B7280]">No variables detected.</span>
                      : formVars.map((v) => <span key={v} className="rounded-full bg-indigo-50/70 border border-indigo-200 px-2 py-0.5 font-mono text-[10px] font-semibold text-indigo-700 backdrop-blur-sm">{`{{${v}}}`}</span>)}
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setCreating(false); setForm({ name: "", description: "", content: "" }) }}>Cancel</Button>
                    <Button size="sm" className="bg-[#111827] text-white hover:bg-black" disabled={!form.name.trim()} onClick={create}>Save</Button>
                  </div>
                </div>
                <div className="space-y-2 rounded-lg border border-white/20 bg-white/40 backdrop-blur-sm p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">Live preview</p>
                  {formVars.map((v) => (
                    <Input key={v} placeholder={v} value={values[v] ?? ""} onChange={(e) => setValues((s) => ({ ...s, [v]: e.target.value }))} className="bg-white/50 backdrop-blur-sm border-white/30 focus-visible:ring-[#4B8BDB]/20 focus-visible:border-[#4B8BDB]" />
                  ))}
                  <pre className="mt-1 whitespace-pre-wrap rounded border border-white/30 bg-white/60 backdrop-blur-sm p-2 font-mono text-[11px] text-[#111827] shadow-sm">{render(form.content, values) || "—"}</pre>
                </div>
              </div>
            )}

            <div className="space-y-3">
              {items.length === 0 && !creating ? (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/40 bg-white/20 backdrop-blur-sm py-10 text-center text-xs text-[#374151]"><FileCode className="size-5" /> No prompts yet.</div>
              ) : items.map((it) => (
                <div key={it.id} className="rounded-xl border border-white/30 glass-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-[#111827]">{it.name}</h4>
                      {it.description && <p className="mt-0.5 text-xs text-[#374151]">{it.description}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button onClick={() => setActiveId(activeId === it.id ? null : it.id)} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-50/70">{activeId === it.id ? "Close" : "Fill & preview"}</button>
                      <button onClick={() => remove(it.id)} className="rounded-lg p-1.5 text-[#6B7280] transition hover:bg-red-100 hover:text-red-600"><Trash2 className="size-4" /></button>
                    </div>
                  </div>
                  <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-white/20 bg-white/40 backdrop-blur-sm p-2 font-mono text-[11px] text-[#374151]">{it.content}</pre>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(it.variables ?? detectVars(it.content)).map((v) => <span key={v} className="rounded-full bg-indigo-50/70 border border-indigo-200 px-2 py-0.5 font-mono text-[10px] font-semibold text-indigo-700 backdrop-blur-sm">{`{{${v}}}`}</span>)}
                  </div>

                  {activeId === it.id && (
                    <div className="mt-3 space-y-2 rounded-lg border border-white/20 bg-white/40 backdrop-blur-sm p-3">
                      {activeVars.map((v) => (
                        <Input key={v} placeholder={v} value={savedValues[v] ?? ""} onChange={(e) => setSavedValues((s) => ({ ...s, [v]: e.target.value }))} className="bg-white/50 backdrop-blur-sm border-white/30 focus-visible:ring-[#4B8BDB]/20 focus-visible:border-[#4B8BDB]" />
                      ))}
                      <pre className="whitespace-pre-wrap rounded border border-white/30 bg-white/60 backdrop-blur-sm p-2 font-mono text-[11px] text-[#111827] shadow-sm">{filled || "—"}</pre>
                      <div className="flex justify-end">
                        <button onClick={() => sendToPlayground(filled)} className="inline-flex items-center gap-1 rounded-md bg-[#111827] px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-black">
                          {copied ? <Check className="size-3" /> : <Sparkles className="size-3" />} {copied ? "Copied to clipboard" : "Send to Playground"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
