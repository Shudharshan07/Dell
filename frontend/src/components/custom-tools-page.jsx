import { useEffect, useState } from "react"
import { Wrench, Plus, Trash2, Play, Loader2, ArrowUp, ArrowDown, X, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function CustomToolsPage() {
  const [sources, setSources] = useState({})
  const [sourceId, setSourceId] = useState("")
  const [ops, setOps] = useState([])
  const [query, setQuery] = useState("")
  const [items, setItems] = useState([])
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: "", description: "", steps: [] })
  const [running, setRunning] = useState(null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    fetch("/api/v1/sources").then((r) => r.json()).then((s) => {
      setSources(s || {})
      const keys = Object.keys(s || {})
      if (keys.length) setSourceId(keys[0])
    }).catch(() => setSources({}))
  }, [])

  const base = sourceId ? `/api/v1/sources/${sourceId}/custom-tools` : null
  const refresh = () => base && fetch(base).then((r) => r.json()).then((d) => setItems(d.custom_tools ?? [])).catch(() => setItems([]))
  useEffect(() => {
    setCreating(false); setForm({ name: "", description: "", steps: [] }); setResult(null); setRunning(null)
    refresh()
    if (sourceId) {
      fetch(`/api/v1/sources/${sourceId}/tools`).then((r) => r.json())
        .then((d) => setOps((d.tools ?? []).map((t) => ({ operation_id: t.operation_id, method: t.method, path: t.path }))))
        .catch(() => setOps([]))
    }
  }, [sourceId]) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredOps = ops.filter((o) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return `${o.operation_id} ${o.method} ${o.path}`.toLowerCase().includes(q)
  }).slice(0, 60)

  const addStep = (op) => setForm((f) => ({ ...f, steps: [...f.steps, { operation_id: op.operation_id, method: op.method, path: op.path }] }))
  const removeStep = (i) => setForm((f) => ({ ...f, steps: f.steps.filter((_, idx) => idx !== i) }))
  const moveStep = (i, dir) => setForm((f) => {
    const j = i + dir
    if (j < 0 || j >= f.steps.length) return f
    const s = [...f.steps];[s[i], s[j]] = [s[j], s[i]]; return { ...f, steps: s }
  })

  const save = async () => {
    const payload = { name: form.name, description: form.description, source_id: sourceId, steps: form.steps.map((s) => ({ operation_id: s.operation_id })) }
    const r = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
    if (r.ok) { setCreating(false); setForm({ name: "", description: "", steps: [] }); refresh() }
  }
  const remove = async (id) => { await fetch(`${base}/${id}`, { method: "DELETE" }); refresh() }

  const run = async (tool) => {
    setRunning(tool.id); setResult(null)
    try {
      const res = await fetch("/api/v1/custom-tools/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_id: sourceId, tool_id: tool.id, limit: 3 }),
      }).then((r) => r.json())
      setResult({ tool_id: tool.id, ...res })
    } finally { setRunning(null) }
  }

  return (
    <div className="h-full overflow-y-auto bg-[#EDEDEB]">
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <div className="flex flex-col gap-3 rounded-xl border border-[#D1CFCA] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Wrench className="size-5 text-[#111827]" />
            <div>
              <h2 className="text-sm font-bold text-[#111827]">Custom Tools</h2>
              <p className="mt-0.5 text-xs text-[#6B7280]">Compose an ordered mini-plan from a source's operations, save it, and run it.</p>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <span className="text-[#9CA3AF]">Source</span>
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}
              className="rounded-lg border border-[#D1CFCA] bg-white px-3 py-2 text-xs text-[#111827] outline-none focus:border-[#111827]">
              {Object.keys(sources).length === 0 && <option value="">No sources</option>}
              {Object.keys(sources).map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </label>
        </div>

        {sourceId && (
          <div className="flex justify-end">
            {!creating && (
              <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 rounded-full bg-[#111827] px-4 py-2 text-xs font-semibold text-white transition hover:bg-black">
                <Plus className="size-3.5" /> Compose tool
              </button>
            )}
          </div>
        )}

        {creating && (
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-[#D1CFCA] bg-white p-4 lg:grid-cols-2">
            <div className="space-y-3">
              <Input placeholder="Tool name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              <Input placeholder="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              <div>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#787670]">Plan steps (in order)</p>
                <div className="space-y-1 rounded-lg border border-[#D0CECA] bg-[#FAFAFA] p-2 min-h-16">
                  {form.steps.length === 0 && <p className="px-1 py-2 text-xs text-[#787670]">Add operations from the right →</p>}
                  {form.steps.map((s, i) => (
                    <div key={`${s.operation_id}-${i}`} className="flex items-center gap-2 rounded bg-white px-2 py-1">
                      <span className="text-[10px] font-bold text-[#9CA3AF]">{i + 1}</span>
                      <span className="font-mono text-[11px] text-emerald-600">{s.method}</span>
                      <span className="flex-1 truncate font-mono text-[11px] text-[#55534E]">{s.operation_id}</span>
                      <button onClick={() => moveStep(i, -1)} className="text-[#9CA3AF] hover:text-[#111827]"><ArrowUp className="size-3" /></button>
                      <button onClick={() => moveStep(i, 1)} className="text-[#9CA3AF] hover:text-[#111827]"><ArrowDown className="size-3" /></button>
                      <button onClick={() => removeStep(i)} className="text-[#9CA3AF] hover:text-red-600"><X className="size-3" /></button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => { setCreating(false); setForm({ name: "", description: "", steps: [] }) }}>Cancel</Button>
                <Button size="sm" className="bg-[#111827] text-white hover:bg-black" disabled={!form.name.trim() || form.steps.length === 0} onClick={save}>Save</Button>
              </div>
            </div>
            <div className="space-y-2 rounded-lg border border-[#E5E7EB] bg-[#FAFAFA] p-3">
              <div className="flex items-center gap-2 rounded-lg border border-[#D0CECA] bg-white px-2 py-1.5">
                <Search className="size-3.5 text-[#9CA3AF]" />
                <input placeholder="Filter operations…" value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1 bg-transparent text-xs outline-none" />
              </div>
              <div className="max-h-80 space-y-1 overflow-y-auto">
                {filteredOps.map((o) => (
                  <button key={o.operation_id} onClick={() => addStep(o)} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-white">
                    <Plus className="size-3 text-[#9CA3AF]" />
                    <span className="font-mono text-[11px] text-emerald-600">{o.method}</span>
                    <span className="truncate font-mono text-[11px] text-[#55534E]">{o.path}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {items.length === 0 && !creating ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[#D0CECA] py-10 text-center text-xs text-[#787670]"><Wrench className="size-5" /> No custom tools for this source yet.</div>
          ) : items.map((it) => (
            <div key={it.id} className="rounded-xl border border-[#D1CFCA] bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-[#111827]">{it.name}</h4>
                  {it.description && <p className="mt-0.5 text-xs text-[#787670]">{it.description}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="outline" onClick={() => run(it)} disabled={running === it.id}>
                    {running === it.id ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Play className="mr-1 size-3" />} Run
                  </Button>
                  <button onClick={() => remove(it.id)} className="rounded-lg p-1.5 text-[#787670] transition hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(it.steps ?? []).map((s, i) => (
                  <span key={i} className="rounded bg-[#EAE8E3] px-2 py-0.5 font-mono text-[10px] text-[#55534E]">{i + 1}. {typeof s === "string" ? s : s.operation_id}</span>
                ))}
              </div>
              {result?.tool_id === it.id && (
                <div className="mt-3">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#787670]">Run trace · {result.steps_executed} step(s)</p>
                  <pre className="max-h-72 overflow-auto rounded-lg border border-[#D0CECA] bg-[#1E1E1E] p-3 font-mono text-[11px] text-emerald-300">
                    {JSON.stringify(result.trace ?? result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
