import { useEffect, useMemo, useState } from "react"
import { Globe, Plus, Trash2, Check, Power, PowerOff, Pencil, Loader2, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

// Dedicated Environments page. Source-scoped envs that REALLY drive the proxy:
// activating an env overrides BASE_URL + injects auth in proxy_call.
function parseVars(text) {
  const out = {}
  ;(text ?? "").split("\n").forEach((line) => {
    const i = line.indexOf("=")
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  })
  return out
}
function varsToText(vars) {
  return Object.entries(vars ?? {}).map(([k, v]) => `${k}=${v}`).join("\n")
}

export function EnvironmentsPage() {
  const [sources, setSources] = useState({})
  const [sourceId, setSourceId] = useState("")
  const [data, setData] = useState({ active: null, environments: [] })
  const [creating, setCreating] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({ name: "", varsText: "" })
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  useEffect(() => {
    fetch("/api/v1/sources")
      .then((r) => r.json())
      .then((s) => {
        setSources(s || {})
        const keys = Object.keys(s || {})
        if (keys.length) setSourceId(keys[0])
      })
      .catch(() => setSources({}))
  }, [])

  const base = sourceId ? `/api/v1/sources/${sourceId}/environments` : null
  const refresh = () => {
    if (!base) return
    fetch(base).then((r) => r.json()).then(setData).catch(() => setData({ active: null, environments: [] }))
  }
  useEffect(() => {
    setCreating(false); setEditId(null); setForm({ name: "", varsText: "" }); setTestResult(null)
    refresh()
  }, [sourceId]) // eslint-disable-line react-hooks/exhaustive-deps

  const downstream = sources[sourceId]?.base_url

  const save = async () => {
    const payload = { name: form.name, variables: parseVars(form.varsText) }
    const url = editId ? `${base}/${editId}` : base
    const method = editId ? "PUT" : "POST"
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
    if (r.ok) { setCreating(false); setEditId(null); setForm({ name: "", varsText: "" }); refresh() }
  }
  const remove = async (id) => { await fetch(`${base}/${id}`, { method: "DELETE" }); refresh() }
  const activate = async (id) => {
    await fetch(`${base}/activate`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ env_id: id }),
    })
    refresh()
  }

  const runTest = async () => {
    setTesting(true); setTestResult(null)
    try {
      // probe the first listable operation through the proxy so the override is visible
      const tr = await fetch(`/api/v1/sources/${sourceId}/tools`).then((r) => r.json()).catch(() => null)
      const op = tr?.tools?.[0]?.operation_id
      if (!op) { setTestResult({ error: "No operations on this source." }); return }
      const res = await fetch("/api/v1/proxy/call", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_id: sourceId, operation_id: op }),
      }).then((r) => r.json())
      setTestResult({ operation_id: op, ...res })
    } finally { setTesting(false) }
  }

  return (
    <div className="h-full overflow-y-auto bg-[#EDEDEB]">
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <div className="flex flex-col gap-3 rounded-xl border border-[#D1CFCA] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Globe className="size-5 text-[#111827]" />
            <div>
              <h2 className="text-sm font-bold text-[#111827]">Environments</h2>
              <p className="mt-0.5 text-xs text-[#6B7280]">
                Variable sets per source. <span className="font-semibold">Activating</span> one overrides the proxy's
                <code className="mx-1 rounded bg-[#EAE8E3] px-1">BASE_URL</code> and injects auth
                (<code className="rounded bg-[#EAE8E3] px-1">AUTH_TOKEN</code>/<code className="rounded bg-[#EAE8E3] px-1">API_KEY</code>).
              </p>
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
          <div className="rounded-xl border border-[#D1CFCA] bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-[#6B7280]">
                Downstream default base URL: <code className="rounded bg-[#EAE8E3] px-1 font-mono">{downstream || "—"}</code>
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold ${data.active ? "bg-emerald-50 text-emerald-700" : "bg-[#EAE8E3] text-[#787670]"}`}>
                  {data.active ? <Power className="size-3" /> : <PowerOff className="size-3" />}
                  {data.active ? `Active: ${data.active}` : "No active env (default behavior)"}
                </span>
                <Button size="sm" variant="outline" onClick={runTest} disabled={testing}>
                  {testing ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Play className="mr-1 size-3" />} Test proxy
                </Button>
              </div>
            </div>
            {testResult && (
              <pre className="mt-3 max-h-48 overflow-auto rounded-lg border border-[#D0CECA] bg-[#1E1E1E] p-3 font-mono text-[11px] text-emerald-300">
                {JSON.stringify(testResult, null, 2)}
              </pre>
            )}
          </div>
        )}

        <div className="flex justify-end">
          {!creating && !editId && sourceId && (
            <button onClick={() => { setCreating(true); setForm({ name: "", varsText: "BASE_URL=\nAUTH_TOKEN=" }) }}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#111827] px-4 py-2 text-xs font-semibold text-white transition hover:bg-black">
              <Plus className="size-3.5" /> New environment
            </button>
          )}
        </div>

        {(creating || editId) && (
          <div className="space-y-3 rounded-xl border border-[#D1CFCA] bg-white p-4">
            <Input placeholder="Environment name (e.g. staging, prod)" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <textarea rows={4} placeholder={"KEY=VALUE per line\nBASE_URL=https://api.example.com\nAUTH_TOKEN=sk-..."}
              value={form.varsText} onChange={(e) => setForm((f) => ({ ...f, varsText: e.target.value }))}
              className="w-full rounded-lg border border-[#D0CECA] bg-[#FAFAFA] px-3 py-2 font-mono text-xs outline-none focus:border-[#111827]" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setCreating(false); setEditId(null); setForm({ name: "", varsText: "" }) }}>Cancel</Button>
              <Button size="sm" className="bg-[#111827] text-white hover:bg-black" disabled={!form.name.trim()} onClick={save}>Save</Button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {data.environments.length === 0 && !creating ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[#D0CECA] py-10 text-center text-xs text-[#787670]">
              <Globe className="size-5" /> No environments for this source yet.
            </div>
          ) : data.environments.map((env) => {
            const isActive = data.active === env.id
            return (
              <div key={env.id} className={`rounded-xl border bg-white p-4 ${isActive ? "border-emerald-400 ring-1 ring-emerald-200" : "border-[#D1CFCA]"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-[#111827]">{env.name}</h4>
                      {isActive && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700"><Check className="size-3" /> active</span>}
                    </div>
                    <div className="mt-2 space-y-1">
                      {Object.entries(env.variables ?? {}).map(([k, v]) => (
                        <div key={k} className="flex items-center gap-2 font-mono text-[11px]">
                          <span className="font-semibold text-[#111827]">{k}</span>
                          <span className="text-[#9CA3AF]">=</span>
                          <span className="truncate text-[#55534E]">{/secret|token|key|auth|bearer/i.test(k) ? "••••••" : String(v)}</span>
                        </div>
                      ))}
                      {Object.keys(env.variables ?? {}).length === 0 && <p className="text-[11px] text-[#787670]">No variables.</p>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button onClick={() => isActive ? activate(null) : activate(env.id)}
                      className={`rounded-lg px-2 py-1 text-[11px] font-semibold transition ${isActive ? "bg-[#EAE8E3] text-[#787670] hover:bg-[#ddd]" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}>
                      {isActive ? "Deactivate" : "Activate"}
                    </button>
                    <button onClick={() => { setEditId(env.id); setCreating(false); setForm({ name: env.name, varsText: varsToText(env.variables) }) }}
                      className="rounded-lg p-1.5 text-[#787670] transition hover:bg-[#EAE8E3] hover:text-[#111827]"><Pencil className="size-4" /></button>
                    <button onClick={() => remove(env.id)} className="rounded-lg p-1.5 text-[#787670] transition hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
