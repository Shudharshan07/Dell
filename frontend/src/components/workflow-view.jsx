import { useEffect, useState } from "react"
import { Boxes, Coins, Play, ChevronDown, ChevronRight, Loader2, Zap, GitBranch, Search, Sparkles, Workflow, Check, X, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"

function MetricCard({ icon: Icon, label, from, to, pct, note }) {
  const good = pct >= 0
  return (
    <div className="flex-1 rounded-xl border border-white/30 glass-card p-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-[#374151]">
        <Icon className="size-4" /> {label}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-mono text-2xl font-bold text-[#111827]">{to?.toLocaleString?.() ?? to}</span>
        <span className="text-xs text-[#6B7280]">from {from?.toLocaleString?.() ?? from}</span>
      </div>
      <div className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${good ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
        {good ? "▼" : "▲"} {Math.abs(pct)}% {good ? "fewer" : "more"}
      </div>
      {note && <p className="mt-1.5 text-[10px] leading-3 text-[#6B7280]">{note}</p>}
    </div>
  )
}

function PendingCard({ item, onApprove, onReject }) {
  const [steps, setSteps] = useState(JSON.stringify(item.steps, null, 2))
  const [stepsErr, setStepsErr] = useState(null)
  const [busy, setBusy] = useState(false)

  const handleApprove = async () => {
    let parsed
    try { parsed = JSON.parse(steps) } catch { setStepsErr("Invalid JSON"); return }
    setStepsErr(null)
    setBusy(true)
    await onApprove(item, parsed)
    setBusy(false)
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/60 backdrop-blur-sm p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold text-[#111827]">{item.name}</span>
            <span className="rounded-full bg-amber-200/50 px-2 py-0.5 text-[10px] font-bold text-amber-800">agent-proposed</span>
            <span className="text-[10px] text-[#6B7280]">{item.source_id} / {item.workflow_id}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-[#374151]">{item.description}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button onClick={handleApprove} disabled={busy}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700">
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} Approve
          </button>
          <button onClick={() => onReject(item.id)}
            className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white/50 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-100">
            <X className="size-3" /> Reject
          </button>
        </div>
      </div>
      <div>
        <p className="mb-1 text-[10px] font-semibold text-[#6B7280]">Steps (editable JSON)</p>
        <textarea
          rows={Math.min(8, item.steps.length * 2 + 2)}
          value={steps}
          onChange={e => { setSteps(e.target.value); setStepsErr(null) }}
          className="w-full rounded border border-white/50 bg-white/40 px-2 py-1.5 font-mono text-[10px] outline-none focus:border-[#4B8BDB] backdrop-blur-sm"
        />
        {stepsErr && <p className="text-[10px] text-red-600">{stepsErr}</p>}
      </div>
    </div>
  )
}

export function WorkflowView() {
  const [sources, setSources] = useState({})
  const [sourceId, setSourceId] = useState("")
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [result, setResult] = useState(null)
  const [profile, setProfile] = useState("auto")
  const [searchQuery, setSearchQuery] = useState("")
  const [searchHits, setSearchHits] = useState(null)
  const [searching, setSearching] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [discovery, setDiscovery] = useState(null)
  const [plansByWf, setPlansByWf] = useState({})
  const [pending, setPending] = useState([])
  const [runParamsOpen, setRunParamsOpen] = useState(null)
  const [runParams, setRunParams] = useState({})

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

  const loadPending = () =>
    fetch("/api/v1/workflows/pending").then(r => r.json()).then(d => setPending(d.pending ?? [])).catch(() => {})

  const loadPlans = (sid) => {
    if (!sid) return
    fetch(`/api/v1/workflows/plans?source_id=${encodeURIComponent(sid)}`)
      .then((r) => r.json())
      .then((p) => {
        const map = {}
        for (const w of p.workflows ?? []) map[w.workflow_id] = w.plans ?? []
        setPlansByWf(map)
      })
      .catch(() => setPlansByWf({}))
  }

  useEffect(() => {
    if (!sourceId) return
    setData(null)
    setResult(null)
    setDiscovery(null)
    setPlansByWf({})
    fetch(`/api/v1/workflows?source_id=${encodeURIComponent(sourceId)}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null))
    loadPlans(sourceId)
    loadPending()
  }, [sourceId])

  // Feature 1: one-click "Generate Dynamic Workflows" — cluster + synthesize
  // plans + (if a provider key is present) AI discovery, all tailored to THIS
  // ingested spec. Backed by /generate?discover=true (degrades gracefully).
  const generate = async () => {
    setBusy(true)
    setDiscovery(null)
    try {
      const r = await fetch(
        `/api/v1/workflows/generate?source_id=${encodeURIComponent(sourceId)}&profile=${encodeURIComponent(profile)}&discover=true&provider=groq`,
        { method: "POST" }
      )
      const d = await r.json()
      setData(d)
      if (d.discovery) setDiscovery(d.discovery)
      loadPlans(sourceId)
    } finally {
      setBusy(false)
    }
  }

  const search = async (e) => {
    e?.preventDefault?.()
    if (!sourceId || !searchQuery.trim()) return
    setSearching(true)
    try {
      const r = await fetch(
        `/api/v1/workflows/search?source_id=${encodeURIComponent(sourceId)}&query=${encodeURIComponent(searchQuery.trim())}`
      )
      setSearchHits(await r.json())
    } catch (err) {
      setSearchHits({ error: err.message })
    } finally {
      setSearching(false)
    }
  }

  const run = async (workflow_id, operation, extraParams = {}) => {
    setResult({ loading: true })
    setRunParamsOpen(null)
    try {
      let body = {}
      if (extraParams.bodyText) try { body = JSON.parse(extraParams.bodyText) } catch { body = {} }
      const r = await fetch("/api/v1/workflows/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_id: sourceId, workflow_id, operation,
          path_params: extraParams.path ?? {},
          query_params: extraParams.query ?? {},
          body,
          report_limit: 3,
        }),
      })
      setResult(await r.json())
    } catch (e) {
      setResult({ error: e.message })
    }
  }

  const approvePending = async (item, editedSteps) => {
    await fetch(`/api/v1/workflows/pending/${item.id}/approve`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: item.name, description: item.description, steps: editedSteps }),
    })
    loadPending()
    if (sourceId) loadPlans(sourceId)
  }

  const rejectPending = async (id) => {
    await fetch(`/api/v1/workflows/pending/${id}/reject`, { method: "POST" })
    loadPending()
  }

  // Task D: design-time AI discovery (Groq). Refreshes the workflow list so the
  // newly-stored AI plans show up under their owning workflows immediately.
  const discover = async () => {
    setDiscovering(true)
    setDiscovery(null)
    try {
      const r = await fetch(
        `/api/v1/workflows/discover?source_id=${encodeURIComponent(sourceId)}&provider=groq`,
        { method: "POST" }
      )
      const d = await r.json()
      setDiscovery(d)
      // reload workflows + plans (with their freshly-merged AI plans)
      const wfr = await fetch(`/api/v1/workflows?source_id=${encodeURIComponent(sourceId)}`)
      setData(await wfr.json())
      loadPlans(sourceId)
    } catch (e) {
      setDiscovery({ ok: false, message: e.message })
    } finally {
      setDiscovering(false)
    }
  }

  const m = data?.metrics
  const workflows = data?.workflows ?? []

  return (
    <div className="h-full overflow-y-auto glass-content">
      <div className="mx-auto max-w-5xl space-y-5 p-6">
        {/* header */}
        <div className="flex flex-col gap-4 rounded-xl border border-white/30 glass-card p-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 text-base font-bold text-[#111827]">
              <GitBranch className="size-5" /> Workflow Proxy
            </h2>
            <p className="max-w-xl text-xs text-[#6B7280]">
              Cluster a spec's raw endpoints into a handful of coarse, workflow-level MCP tools — collapsing hundreds of fine-grained tools (and tens of thousands of tokens) into something an agent can actually reason about.
            </p>
          </div>
          {/* Added flex-wrap here to prevent horizontal layout blowout */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              className="rounded-lg border border-white/30 bg-white/50 backdrop-blur-sm px-3 py-2 text-xs text-[#111827] outline-none focus:border-[#4B8BDB]"
            >
              {Object.keys(sources).length === 0 && <option value="">No APIs ingested</option>}
              {Object.entries(sources).map(([id, s]) => (
                <option key={id} value={id}>{id} ({s.total_tools})</option>
              ))}
            </select>
            <select
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              title="Clustering profile"
              className="rounded-lg border border-white/30 bg-white/50 backdrop-blur-sm px-3 py-2 text-xs text-[#111827] outline-none focus:border-[#4B8BDB]"
            >
              <option value="auto">Profile: Auto</option>
              <option value="redfish">Profile: Redfish</option>
              <option value="none">Profile: None</option>
            </select>
            <Button onClick={generate} disabled={!sourceId || busy} className="bg-[#111827] text-white hover:bg-black">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
              Generate Dynamic Workflows
            </Button>
            <Button
              onClick={discover}
              disabled={!sourceId || discovering}
              title="Re-run only the AI discovery pass (Groq) to propose more multi-step workflows, validated against this spec"
              className="bg-violet-600 text-white hover:bg-violet-700"
            >
              {discovering ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Discover (AI)
            </Button>
          </div>
        </div>

        {/* Feature 1: tailored-generate summary — these workflows are specific to
            the ingested spec (auto-clustered + synthesized + AI). */}
        {data?.source_name && (data.auto_plan_count != null || data.ai_plan_count != null) && (
          <div className="rounded-xl border border-emerald-400 bg-emerald-50/70 backdrop-blur-md p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-2 text-xs font-bold text-emerald-800">
                <Zap className="size-4" /> Workflows tailored to
              </span>
              <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-800">
                {data.source_name}
              </span>
              {data.raw_tool_count != null && (
                <span className="text-[11px] text-emerald-700">
                  {data.raw_tool_count} raw endpoints → {workflows.length} workflow tools
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">
                {data.auto_plan_count ?? 0} auto plans
              </span>
              <span className="rounded-full bg-violet-100 px-2 py-0.5 font-semibold text-violet-700">
                {data.ai_plan_count ?? 0} AI plans
              </span>
              {data.discovery && data.discovery.ok === false && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">
                  AI: {data.discovery.message}
                </span>
              )}
            </div>
          </div>
        )}

        {/* AI discovery result banner */}
        {discovery && (
          <div className="rounded-xl border border-violet-400 bg-violet-50/70 backdrop-blur-md p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-bold text-violet-800">
                <Sparkles className="size-4" /> AI-discovered workflows
              </span>
              <button onClick={() => setDiscovery(null)} className="text-xs text-violet-400 hover:text-violet-800">clear</button>
            </div>
            {discovery.ok === false ? (
              <p className="text-xs text-amber-700">{discovery.message}</p>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-violet-700">
                  {discovery.accepted_count} accepted / {discovery.proposed_count} proposed · all op IDs validated against {discovery.catalog_size} spec operations.
                </p>
                {(discovery.accepted ?? []).map((a) => (
                  <div key={a.name} className="rounded-lg border border-violet-200 bg-white px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-violet-800">{a.name}</span>
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">AI</span>
                      <span className="ml-auto rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[10px] text-[#6B7280]">{a.workflow_id}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-[#6B7280]">{a.description}</p>
                    <p className="mt-1 font-mono text-[10px] text-[#9CA3AF]">{(a.steps ?? []).map((s) => s.operation_id).join(" → ")}</p>
                  </div>
                ))}
                {(discovery.rejected_reasons ?? []).length > 0 && (
                  <details className="text-[10px] text-[#9CA3AF]">
                    <summary className="cursor-pointer">{discovery.rejected_reasons.length} rejected</summary>
                    {discovery.rejected_reasons.map((r, i) => <p key={i}>{r}</p>)}
                  </details>
                )}
              </div>
            )}
          </div>
        )}

        {/* metrics */}
        {m && (
          <div className="flex flex-col gap-3 sm:flex-row">
            <MetricCard icon={Boxes} label="MCP tools" from={m.raw_tool_count} to={m.workflow_tool_count} pct={m.tool_reduction_pct} />
            <MetricCard
              icon={Coins}
              label="Tool-definition tokens"
              from={m.raw_tokens}
              to={m.workflow_tokens_deferred ?? m.workflow_tokens}
              pct={m.deferred_token_reduction_pct ?? m.token_reduction_pct}
              note={
                m.workflow_tokens_inline != null
                  ? `with progressive disclosure · ${m.workflow_tokens_inline.toLocaleString()} inline (${m.token_reduction_pct}%)`
                  : undefined
              }
            />
          </div>
        )}

        {/* progressive-disclosure browse: search operations */}
        {workflows.length > 0 && (
          <div className="rounded-xl border border-white/30 glass-card p-4">
            <form onSubmit={search} className="flex items-center gap-2">
              <div className="flex flex-1 items-center gap-2 rounded-lg border border-white/30 bg-white/50 backdrop-blur-sm px-3">
                <Search className="size-4 shrink-0 text-[#6B7280]" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search operations (progressive disclosure) — e.g. ability score"
                  className="w-full bg-transparent py-2 text-xs text-[#111827] outline-none placeholder:text-[#6B7280]"
                />
              </div>
              <Button type="submit" disabled={searching || !searchQuery.trim()} className="bg-[#111827] text-white hover:bg-black">
                {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                Search
              </Button>
              {searchHits && (
                <button type="button" onClick={() => { setSearchHits(null); setSearchQuery("") }} className="text-xs text-[#9CA3AF] hover:text-[#111827]">
                  clear
                </button>
              )}
            </form>
            {searchHits && (
              <div className="mt-3">
                {searchHits.error ? (
                  <p className="text-xs text-red-600">{searchHits.error}</p>
                ) : (searchHits.results ?? []).length === 0 ? (
                  <p className="text-xs text-[#9CA3AF]">No operations matched “{searchHits.query}”.</p>
                ) : (
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF]">{searchHits.count} hit(s)</p>
                    {searchHits.results.map((h) => (
                      <div key={`${h.workflow_id}-${h.operation_id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 font-mono text-[11px] hover:bg-[#FAFAFA]">
                        <span className="w-12 shrink-0 font-bold text-emerald-600">{h.method}</span>
                        <span className="truncate text-[#55534E]">{h.path}</span>
                        <span className="ml-auto shrink-0 rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[10px] text-[#6B7280]">{h.workflow_id}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Pending approvals — agent-proposed workflows awaiting human review */}
        {pending.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-amber-600" />
              <span className="text-xs font-bold text-amber-800">Pending Approvals ({pending.length})</span>
              <span className="text-[11px] text-amber-600">Agent-proposed workflows — review, edit, then approve or reject</span>
            </div>
            {pending.map(item => <PendingCard key={item.id} item={item} onApprove={approvePending} onReject={rejectPending} />)}
          </div>
        )}

        {/* workflow list */}
        {workflows.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF]">
              {workflows.length} workflow-level tools
            </p>
            {workflows.map((w) => {
              const open = expanded === w.id
              return (
                <div key={w.id} className="rounded-xl border border-white/30 glass-card">
                  <button
                    onClick={() => setExpanded(open ? null : w.id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {open ? <ChevronDown className="size-4 shrink-0 text-[#9CA3AF]" /> : <ChevronRight className="size-4 shrink-0 text-[#9CA3AF]" />}
                      <span className="font-mono text-sm font-semibold text-[#111827]">{w.id}</span>
                      <span className="rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[10px] font-semibold text-[#6B7280]">{w.operations.length} ops</span>
                      {w.profile && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">{w.profile}</span>}
                      {w.report && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">orchestration</span>}
                    </div>
                  </button>

                  {open && (
                    <div className="space-y-1 border-t border-white/20 p-3">
                      {/* synthesized + AI multi-step plans */}
                      {(plansByWf[w.id] ?? []).length > 0 && (
                        <div className="mb-2 space-y-1">
                          <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF]">
                            <Workflow className="size-3" /> Synthesized plans
                          </p>
                          {(plansByWf[w.id] ?? []).map((p) => {
                            const isAi = p.source === "ai"
                            return (
                              <div key={p.name} className="flex items-center justify-between gap-2 rounded-lg bg-white/40 border border-white/20 px-3 py-2 backdrop-blur-sm">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-xs font-semibold text-[#111827]">{p.name}</span>
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${isAi ? "bg-violet-100 text-violet-700" : "bg-emerald-100 text-emerald-700"}`}>
                                      {isAi ? "AI" : "auto"}
                                    </span>
                                    <span className="rounded-full bg-[#EEF2FF] px-2 py-0.5 text-[10px] font-semibold text-indigo-600">{(p.steps ?? []).length} steps</span>
                                  </div>
                                  <p className="mt-0.5 truncate text-[11px] text-[#6B7280]">{p.description}</p>
                                </div>
                                <button
                                  onClick={() => run(w.id, `plan:${p.name}`)}
                                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/30 bg-white/60 px-2 py-1 text-[11px] font-semibold text-[#374151] hover:bg-white/80"
                                >
                                  <Play className="size-3" /> Run
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                      {w.report && (
                        <div className="mb-1 flex items-center justify-between gap-2 rounded-lg bg-indigo-50/70 border border-indigo-200 px-3 py-2 backdrop-blur-sm">
                          <div className="min-w-0">
                            <span className="font-mono text-xs font-semibold text-indigo-700">__report__</span>
                            <span className="ml-2 text-[11px] text-[#6B7280]">list collection → fetch item details (multi-step)</span>
                          </div>
                          <button onClick={() => run(w.id, "__report__")} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-indigo-300 bg-white/70 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100">
                            <Play className="size-3" /> Run
                          </button>
                        </div>
                      )}
                      {w.operations.map((o) => {
                        const key = `${w.id}:${o.operation_id}`
                        const open = runParamsOpen === key
                        const p = runParams[key] ?? {}
                        const pathPlaceholders = [...(o.path?.matchAll(/\{([^}]+)\}/g) ?? [])].map(m => m[1])
                        const queryParams = (o.params ?? []).filter(pp => !pathPlaceholders.includes(pp))
                        const needsBody = ["POST","PUT","PATCH"].includes(o.method)
                        const setP = (patch) => setRunParams(prev => ({ ...prev, [key]: { ...(prev[key] ?? {}), ...patch } }))
                        return (
                          <div key={o.operation_id} className="rounded-lg hover:bg-white/40 transition">
                            <div className="flex items-center justify-between gap-2 px-3 py-1.5">
                              <div className="flex min-w-0 items-center gap-2 font-mono text-[11px]">
                                <span className="w-12 shrink-0 font-bold text-emerald-600">{o.method}</span>
                                <span className="truncate text-[#55534E]">{o.path}</span>
                                {o.params.length > 0 && <span className="shrink-0 text-[10px] text-[#9CA3AF]">({o.params.join(", ")})</span>}
                              </div>
                              <button
                                onClick={() => setRunParamsOpen(open ? null : key)}
                                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/30 bg-white/50 px-2 py-1 text-[10px] font-semibold text-[#374151] hover:bg-white/70"
                              >
                                <Play className="size-3" /> Run
                              </button>
                            </div>
                            {open && (
                              <div className="mx-3 mb-2 space-y-2 rounded-lg border border-white/30 bg-white/40 backdrop-blur-sm p-3">
                                {pathPlaceholders.map(ph => (
                                  <div key={ph} className="flex items-center gap-2">
                                    <span className="w-28 shrink-0 font-mono text-[10px] text-[#9CA3AF]">{ph} (path)</span>
                                    <input
                                      value={p.path?.[ph] ?? ""}
                                      onChange={e => setP({ path: { ...(p.path ?? {}), [ph]: e.target.value } })}
                                      placeholder={ph}
                                      className="flex-1 rounded border border-white/30 bg-white/50 px-2 py-1 font-mono text-[11px] outline-none focus:border-[#4B8BDB] backdrop-blur-sm"
                                    />
                                  </div>
                                ))}
                                {queryParams.map(qp => (
                                  <div key={qp} className="flex items-center gap-2">
                                    <span className="w-28 shrink-0 font-mono text-[10px] text-[#9CA3AF]">{qp} (query)</span>
                                    <input
                                      value={p.query?.[qp] ?? ""}
                                      onChange={e => setP({ query: { ...(p.query ?? {}), [qp]: e.target.value } })}
                                      placeholder={qp}
                                      className="flex-1 rounded border border-white/30 bg-white/50 px-2 py-1 font-mono text-[11px] outline-none focus:border-[#4B8BDB] backdrop-blur-sm"
                                    />
                                  </div>
                                ))}
                                {needsBody && (
                                  <div className="flex items-start gap-2">
                                    <span className="w-28 shrink-0 pt-1 font-mono text-[10px] text-[#9CA3AF]">body (JSON)</span>
                                    <textarea
                                      rows={3}
                                      value={p.bodyText ?? ""}
                                      onChange={e => setP({ bodyText: e.target.value })}
                                      placeholder='{"key": "value"}'
                                      className="flex-1 rounded border border-white/30 bg-white/50 px-2 py-1 font-mono text-[11px] outline-none focus:border-[#4B8BDB] backdrop-blur-sm"
                                    />
                                  </div>
                                )}
                                <button
                                  onClick={() => run(w.id, o.operation_id, p)}
                                  className="inline-flex items-center gap-1 rounded-md bg-[#111827] px-3 py-1 text-[11px] font-semibold text-white hover:bg-black"
                                >
                                  <Play className="size-3" /> Execute
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/40 bg-white/20 backdrop-blur-sm py-12 text-center text-sm text-[#374151]">
            {sourceId ? "Click Generate to cluster this API into workflow tools." : "Ingest an API first (Your APIs)."}
          </div>
        )}

        {/* execution result */}
        {result && (
          <div className="rounded-xl border border-white/30 glass-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-[#111827]">Execution result</span>
              <button onClick={() => setResult(null)} className="text-xs text-[#9CA3AF] hover:text-[#111827]">clear</button>
            </div>
            {result.loading ? (
              <div className="flex items-center gap-2 text-xs text-[#6B7280]"><Loader2 className="size-3.5 animate-spin" /> running…</div>
            ) : (
              <pre className="max-h-80 overflow-auto rounded-lg border border-white/20 bg-black/60 backdrop-blur-md p-3 text-[11px] leading-5 text-emerald-300">
                {JSON.stringify(result, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
