import { useEffect, useMemo, useRef, useState } from "react"
import { Bot, Clock3, Play, Send, AlertCircle, CheckCircle2, Loader2, Terminal, Coins } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

// Detect {placeholders} in a path -> these become path params in manual mode.
function pathPlaceholders(path = "") {
  return [...String(path).matchAll(/\{([^}]+)\}/g)].map((m) => m[1])
}

function MeterRow({ label, value, bold }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={`text-[11px] ${bold ? "font-semibold text-[#111827]" : "text-[#6B7280]"}`}>{label}</span>
      <span className={`font-mono text-[11px] ${bold ? "font-bold text-[#111827]" : "text-[#374151]"}`}>{value}</span>
    </div>
  )
}

// Live token-usage meter: 2-line summary that expands to a floating breakdown
// on hover or click.
function TokenMeter({ usage, live }) {
  const [hover, setHover] = useState(false)
  const [pinned, setPinned] = useState(false)
  const open = hover || pinned
  const u = usage || {}
  const total = u.total_tokens ?? 0
  const fmt = (n) => Number(n ?? 0).toLocaleString()
  const inPct = total ? Math.round(((u.input_tokens ?? 0) / total) * 100) : 0

  return (
    <div className="relative" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        type="button"
        onClick={() => setPinned((p) => !p)}
        title="Token usage — click to pin"
        className="flex flex-col items-end rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1 text-right leading-tight transition hover:border-[#111827]"
      >
        <span className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
          <Coins className="size-3" /> Tokens
          {live && <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />}
        </span>
        <span className="font-mono text-xs font-bold text-[#111827]">{fmt(total)}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-56 rounded-xl border border-[#E5E7EB] bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-[#111827]">Token usage</span>
            {live && (
              <span className="flex items-center gap-1 text-[10px] text-emerald-600">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" /> live
              </span>
            )}
          </div>
          {usage ? (
            <>
              <MeterRow label="Input" value={fmt(u.input_tokens)} />
              <MeterRow label="Output" value={fmt(u.output_tokens)} />
              {u.cached_tokens ? <MeterRow label="Cached" value={fmt(u.cached_tokens)} /> : null}
              <MeterRow label="Model calls" value={u.turns ?? 0} />
              <div className="my-2 border-t border-[#E5E7EB]" />
              <MeterRow label="Total billed" value={fmt(total)} bold />
              <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-[#F3F4F6]">
                <div className="h-full bg-[#111827]" style={{ width: `${inPct}%` }} />
                <div className="h-full bg-[#9CA3AF]" style={{ width: `${100 - inPct}%` }} />
              </div>
              <p className="mt-1 text-[9px] text-[#9CA3AF]">input {inPct}% · output {100 - inPct}%</p>
              <p className="mt-1.5 text-[9px] leading-3 text-[#9CA3AF]">
                Cumulative across {u.turns ?? 0} model call{(u.turns ?? 0) === 1 ? "" : "s"} — context is re-sent each turn, so more tools/calls cost more.
              </p>
            </>
          ) : (
            <p className="text-[11px] text-[#9CA3AF]">No run yet — send a prompt to see token usage.</p>
          )}
        </div>
      )}
    </div>
  )
}

const TOKEN_BUDGET = 4000
// Rough chars/4 token estimator matching backend heuristic
function estimateTokens(toolDefs) {
  return Math.ceil(JSON.stringify(toolDefs).length / 4)
}

export function AgentPlayground({ tools = [] }) {
  // ── shared selectors ──────────────────────────────────────────────────────
  const [mode, setMode] = useState("agent") // "agent" | "manual"
  const [providers, setProviders] = useState([])
  const [provider, setProvider] = useState("")
  const [model, setModel] = useState("")
  const [toolsets, setToolsets] = useState([])
  const [toolsetId, setToolsetId] = useState("")

  // ── tool source: "toolset" | "workflow" | "combined" ──────────────────────
  const [toolSource, setToolSource] = useState("workflow")
  const [sources, setSources] = useState([])
  const [sourceId, setSourceId] = useState("__auto__")
  const [wfTools, setWfTools] = useState([]) // wf_* tools for the active source
  const [allAgg, setAllAgg] = useState(null) // aggregate across all sources (1:∞)
  // Feature 2: per-message routing result captured from the `start` event.
  const [routed, setRouted] = useState(null) // {routed_workflows, route_terms, tool_count, aggregate_tool_count}

  // ── combined mode: multi-select toolsets + sources ────────────────────────
  const [selectedToolsetIds, setSelectedToolsetIds] = useState([])
  const [selectedSourceIds, setSelectedSourceIds] = useState([])
  // Token budget tracking: fetch deferred wf schema sizes from backend on source change
  const [combinedTokenEst, setCombinedTokenEst] = useState(0)

  // ── agent state ───────────────────────────────────────────────────────────
  const [message, setMessage] = useState("")
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Pick a provider + toolset, then send a prompt. I'll drive the toolset live." },
  ])
  const [trace, setTrace] = useState([])
  const [usage, setUsage] = useState(null)
  const [running, setRunning] = useState(false)
  const stepId = useRef(0)

  // ── manual state ──────────────────────────────────────────────────────────
  const [manualToolId, setManualToolId] = useState("")
  const [pathVals, setPathVals] = useState({})
  const [queryVals, setQueryVals] = useState({})
  const [bodyText, setBodyText] = useState("")
  const [manualResult, setManualResult] = useState(null)
  const [manualBusy, setManualBusy] = useState(false)

  // ── load providers + toolsets ───────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/v1/agent/providers")
      .then((r) => r.json())
      .then((data) => {
        const list = data.providers ?? []
        setProviders(list)
        const first = list.find((p) => p.available) ?? list[0]
        if (first) {
          setProvider(first.id)
          setModel(first.default_model || (first.models?.[0] ?? ""))
        }
      })
      .catch(() => setProviders([]))

    fetch("/api/v1/toolsets")
      .then((r) => r.json())
      .then((data) => {
        const list = Object.values(data ?? {})
        setToolsets(list)
        if (list.length) setToolsetId(list[0].toolset_id)
      })
      .catch(() => setToolsets([]))

    fetch("/api/v1/sources")
      .then((r) => r.json())
      .then((data) => {
        const list = Object.entries(data ?? {}).map(([id, s]) => ({ id, ...s }))
        setSources(list)
        // default stays "__all__" — the 1:∞ optimized path
      })
      .catch(() => setSources([]))

    fetch("/api/v1/agent/workflow-sources")
      .then((r) => r.json())
      .then((d) => {
        setAllAgg(d?.all ?? null)
        // also enrich sources with workflow_count
        const wfMap = Object.fromEntries((d?.sources ?? []).map(s => [s.source_id, s.workflow_count]))
        setSources(prev => prev.map(s => ({ ...s, workflow_count: wfMap[s.id] ?? s.workflow_count })))
      })
      .catch(() => setAllAgg(null))
  }, [])

  // load the workflow tool list for the active source (workflow mode right panel + run)
  useEffect(() => {
    if (!sourceId || sourceId === "__all__" || sourceId === "__auto__") {
      setWfTools([])
      return
    }
    fetch(`/api/v1/workflows?source_id=${encodeURIComponent(sourceId)}`)
      .then((r) => r.json())
      .then((d) => setWfTools(d?.workflows ?? []))
      .catch(() => setWfTools([]))
  }, [sourceId])

  // estimate combined token budget whenever selection changes
  useEffect(() => {
    if (toolSource !== "combined") { setCombinedTokenEst(0); return }
    // fetch deferred wf schemas for each selected source and measure
    const fetches = selectedSourceIds.map(sid =>
      fetch(`/api/v1/workflows?source_id=${encodeURIComponent(sid)}`)
        .then(r => r.json()).catch(() => ({ workflows: [] }))
    )
    Promise.all(fetches).then(results => {
      // deferred schema: ~150 chars each (very small); use rough estimate
      let tokens = 0
      results.forEach(d => {
        tokens += estimateTokens((d.workflows ?? []).map(w => ({
          name: w.id,
          description: `${w.name}: ${(w.operations ?? []).length} operations. Use search_operations.`,
          input_schema: { type: "object", properties: { operation: { type: "string" } }, required: ["operation"] }
        })))
      })
      // toolset raw tools: ~80 chars per selected tool
      selectedToolsetIds.forEach(tsid => {
        const ts = toolsets.find(t => t.toolset_id === tsid)
        const count = (ts?.tools ?? []).filter(t => t.selected).length
        tokens += count * 20 // rough: 80 chars / 4 per raw tool def
      })
      setCombinedTokenEst(tokens)
    })
  }, [toolSource, selectedSourceIds, selectedToolsetIds, toolsets])

  const activeProvider = useMemo(
    () => providers.find((p) => p.id === provider),
    [providers, provider]
  )
  const activeToolset = useMemo(
    () => toolsets.find((t) => t.toolset_id === toolsetId),
    [toolsets, toolsetId]
  )
  const selectedTools = useMemo(
    () => (activeToolset?.tools ?? []).filter((t) => t.selected),
    [activeToolset]
  )

  // keep model in sync with provider
  useEffect(() => {
    if (!activeProvider) return
    if (!activeProvider.models?.includes(model)) {
      setModel(activeProvider.default_model || (activeProvider.models?.[0] ?? ""))
    }
  }, [activeProvider]) // eslint-disable-line react-hooks/exhaustive-deps

  const manualTool = useMemo(
    () => selectedTools.find((t) => t.id === manualToolId),
    [selectedTools, manualToolId]
  )

  // workflow-mode active tool surface: wf_* chips + the two meta tools.
  const isWorkflowMode = mode === "agent" && toolSource === "workflow"
  const isAllApis = sourceId === "__all__"
  const isAuto = sourceId === "__auto__"
  const workflowChips = useMemo(
    () => [...wfTools.map((w) => w.id), "search_operations", "describe_operation"],
    [wfTools]
  )
  // In "All APIs (∞)" mode we don't enumerate every namespaced tool as a chip
  // (could be 100+); we surface the aggregate count + the two global meta tools.
  const allApisToolCount = (allAgg?.agent_tool_count ?? (allAgg?.workflow_count ?? 0) + 2)

  // reset manual form when tool changes
  useEffect(() => {
    setPathVals({})
    setQueryVals({})
    setBodyText("")
    setManualResult(null)
  }, [manualToolId])

  // ── agent run (SSE over fetch) ──────────────────────────────────────────────
  const handleTraceEvent = (ev) => {
    if (ev.type === "start") {
      setTrace([])
      setUsage(null)
      if (ev.surface === "workflow_auto" || ev.surface === "workflow_auto_fallback") {
        setRouted({
          routed_workflows: ev.routed_workflows ?? [],
          route_terms: ev.route_terms ?? [],
          routed_detail: ev.routed_detail ?? [],
          tool_count: ev.tool_count,
          aggregate_tool_count: ev.aggregate_tool_count,
          fallback: ev.surface === "workflow_auto_fallback",
        })
      }
      const routeNote =
        ev.surface === "workflow_auto" && (ev.routed_workflows ?? []).length
          ? ` · auto-assigned ${ev.routed_workflows.length} of ${ev.aggregate_tool_count ?? "?"} workflows`
          : ev.surface === "workflow_auto_fallback"
          ? " · auto-route found nothing, using all APIs"
          : ""
      setMessages((c) => [
        ...c,
        { role: "system", content: `Running on ${ev.provider} · ${ev.model || "auto"} · ${ev.tool_count} tools${routeNote}` },
      ])
    } else if (ev.type === "tool_call") {
      const id = ++stepId.current
      setTrace((c) => [
        ...c,
        { id, name: ev.name, detail: JSON.stringify(ev.args ?? {}), status: "running", duration: null },
      ])
    } else if (ev.type === "tool_result") {
      setTrace((c) => {
        const copy = [...c]
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i].status === "running") {
            copy[i] = {
              ...copy[i],
              status: ev.ok ? "ok" : "error",
              duration: ev.duration_ms,
              preview: ev.preview,
            }
            break
          }
        }
        return copy
      })
    } else if (ev.type === "usage") {
      setUsage(ev)
    } else if (ev.type === "assistant") {
      setMessages((c) => [...c, { role: "assistant", content: ev.text }])
    } else if (ev.type === "error") {
      setMessages((c) => [...c, { role: "error", content: ev.message }])
    }
  }

  const sendMessage = async (event) => {
    event.preventDefault()
    const trimmed = message.trim()
    if (!trimmed || running) return
    const isWorkflow = toolSource === "workflow"
    const isCombined = toolSource === "combined"
    if (isCombined) {
      if (!selectedToolsetIds.length && !selectedSourceIds.length) {
        setMessages(c => [...c, { role: "error", content: "Select at least one toolset or workflow source." }])
        return
      }
    } else if (isWorkflow ? !sourceId : !toolsetId) {
      setMessages((c) => [
        ...c,
        { role: "error", content: isWorkflow ? "Select a source first." : "Select a toolset first." },
      ])
      return
    }
    setMessages((c) => [...c, { role: "user", content: trimmed }])
    setMessage("")
    setRunning(true)
    setTrace([])
    setRouted(null)

    const body = isCombined
      ? { provider, model, mode: "combined", toolset_ids: selectedToolsetIds, source_ids: selectedSourceIds, token_budget: TOKEN_BUDGET, message: trimmed }
      : isWorkflow
      ? { provider, model, mode: "workflow", source_id: sourceId, message: trimmed }
      : { provider, model, toolset_id: toolsetId, message: trimmed }

    try {
      const resp = await fetch("/api/v1/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!resp.ok || !resp.body) {
        const txt = await resp.text().catch(() => "")
        throw new Error(`HTTP ${resp.status} ${txt}`)
      }
      const reader = resp.body.getReader()
      const dec = new TextDecoder()
      let buf = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const line = chunk.split("\n").find((l) => l.startsWith("data: "))
          if (!line) continue
          try {
            handleTraceEvent(JSON.parse(line.slice(6)))
          } catch {
            /* ignore malformed chunk */
          }
        }
      }
    } catch (err) {
      setMessages((c) => [...c, { role: "error", content: `Run failed: ${err.message}` }])
    } finally {
      setRunning(false)
    }
  }

  // ── manual execute (direct proxy) ───────────────────────────────────────────
  const runManual = async () => {
    if (!manualTool || manualBusy) return
    setManualBusy(true)
    setManualResult(null)
    let body = {}
    if (bodyText.trim()) {
      try {
        body = JSON.parse(bodyText)
      } catch {
        setManualResult({ error: "Body is not valid JSON." })
        setManualBusy(false)
        return
      }
    }
    const cleanQuery = Object.fromEntries(
      Object.entries(queryVals).filter(([, v]) => v !== "" && v != null)
    )
    try {
      const resp = await fetch("/api/v1/proxy/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_id: manualTool.source_id || (activeToolset?.toolset_id ?? ""),
          operation_id: manualTool.id,
          path_params: pathVals,
          query_params: cleanQuery,
          body,
        }),
      })
      setManualResult(await resp.json())
    } catch (err) {
      setManualResult({ error: err.message })
    } finally {
      setManualBusy(false)
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  return (
    <section className="grid h-full min-h-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_24rem]">
      {/* LEFT: controls + main panel */}
      <div className="flex min-h-0 flex-col overflow-hidden border-r border-[#E5E7EB] bg-[#FAFAFA]">
        {/* control bar */}
        <div className="max-h-[45vh] shrink-0 overflow-y-auto space-y-3 border-b border-[#E5E7EB] bg-white px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-[#111827]">Agent Playground</h2>
            <div className="flex rounded-lg border border-[#E5E7EB] p-0.5">
              {["agent", "manual"].map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-md px-3 py-1 text-xs font-semibold capitalize transition ${
                    mode === m ? "bg-[#111827] text-white" : "text-[#6B7280] hover:text-[#111827]"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* tool source toggle (agent mode only) */}
          {mode === "agent" && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Tool source</span>
              <div className="flex rounded-lg border border-[#E5E7EB] p-0.5">
                {[
                  ["toolset", "Toolset"],
                  ["workflow", "Workflows"],
                  ["combined", "Combined"],
                ].map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setToolSource(v)}
                    className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                      toolSource === v ? "bg-[#111827] text-white" : "text-[#6B7280] hover:text-[#111827]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {toolSource === "workflow" && (
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                  progressive disclosure
                </span>
              )}
              {toolSource === "combined" && (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                  ≤{TOKEN_BUDGET} tokens
                </span>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {/* toolset (manual mode, or agent + toolset source) */}
            {(mode === "manual" || toolSource === "toolset") && (
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Toolset</span>
                <select
                  value={toolsetId}
                  onChange={(e) => setToolsetId(e.target.value)}
                  className="rounded-lg border border-[#E5E7EB] bg-white px-2 py-1.5 text-xs text-[#111827] outline-none focus:border-[#111827]"
                >
                  {toolsets.length === 0 && <option value="">No toolsets</option>}
                  {toolsets.map((t) => (
                    <option key={t.toolset_id} value={t.toolset_id}>
                      {t.toolset_id} ({(t.tools ?? []).filter((x) => x.selected).length})
                    </option>
                  ))}
                </select>
              </label>
            )}

            {mode === "agent" && toolSource === "toolset" && selectedTools.length > 12 && (
              <p className="text-[10px] leading-3 text-amber-600 sm:col-span-3">
                ⚠ Raw mode — all {selectedTools.length} tool schemas are sent to the model every turn. Switch to <b>Workflows</b> for ~10–50× fewer tokens.
              </p>
            )}

            {/* combined mode: multi-select toolsets + sources + token budget bar */}
            {mode === "agent" && toolSource === "combined" && (
              <div className="sm:col-span-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {/* toolsets */}
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Toolsets</p>
                    <div className="max-h-32 overflow-y-auto rounded-lg border border-[#E5E7EB] bg-white p-2 space-y-1">
                      {toolsets.length === 0 && <span className="text-[11px] text-[#9CA3AF]">No toolsets</span>}
                      {toolsets.map(t => {
                        const checked = selectedToolsetIds.includes(t.toolset_id)
                        return (
                          <label key={t.toolset_id} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setSelectedToolsetIds(prev =>
                                checked ? prev.filter(x => x !== t.toolset_id) : [...prev, t.toolset_id]
                              )}
                              className="accent-[#111827]"
                            />
                            <span className="text-[11px] text-[#374151]">{t.toolset_id}</span>
                            <span className="ml-auto text-[10px] text-[#9CA3AF]">{(t.tools ?? []).filter(x => x.selected).length} tools</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                  {/* workflow sources */}
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Workflow Sources</p>
                    <div className="max-h-32 overflow-y-auto rounded-lg border border-[#E5E7EB] bg-white p-2 space-y-1">
                      {sources.length === 0 && <span className="text-[11px] text-[#9CA3AF]">No sources</span>}
                      {sources.map(s => {
                        const checked = selectedSourceIds.includes(s.id)
                        return (
                          <label key={s.id} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setSelectedSourceIds(prev =>
                                checked ? prev.filter(x => x !== s.id) : [...prev, s.id]
                              )}
                              className="accent-[#111827]"
                            />
                            <span className="text-[11px] text-[#374151]">{s.id}</span>
                            <span className="ml-auto text-[10px] text-[#9CA3AF]">{s.workflow_count ?? s.total_tools} wf</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                </div>
                {/* token budget bar */}
                {(selectedToolsetIds.length > 0 || selectedSourceIds.length > 0) && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-[#6B7280]">Est. token cost</span>
                      <span className={`font-mono text-[10px] font-bold ${
                        combinedTokenEst > TOKEN_BUDGET ? "text-red-600" : combinedTokenEst > TOKEN_BUDGET * 0.8 ? "text-amber-600" : "text-emerald-600"
                      }`}>{combinedTokenEst.toLocaleString()} / {TOKEN_BUDGET.toLocaleString()}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#F3F4F6]">
                      <div
                        className={`h-full rounded-full transition-all ${
                          combinedTokenEst > TOKEN_BUDGET ? "bg-red-500" : combinedTokenEst > TOKEN_BUDGET * 0.8 ? "bg-amber-400" : "bg-emerald-500"
                        }`}
                        style={{ width: `${Math.min(100, (combinedTokenEst / TOKEN_BUDGET) * 100)}%` }}
                      />
                    </div>
                    {combinedTokenEst > TOKEN_BUDGET && (
                      <p className="mt-1 text-[10px] text-amber-600">⚠ Over budget — backend will trim to fit {TOKEN_BUDGET.toLocaleString()} tokens.</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* source (agent + workflow source) */}
            {mode === "agent" && toolSource === "workflow" && (
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Source</span>
                <select
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                  className="rounded-lg border border-[#E5E7EB] bg-white px-2 py-1.5 text-xs text-[#111827] outline-none focus:border-[#111827]"
                >
                  <option value="__auto__">
                    ⚡ Auto (task-routed){allAgg ? ` — ~3-5 of ${allApisToolCount} tools` : ""}
                  </option>
                  <option value="__all__">
                    🌐 All APIs (∞){allAgg ? ` — ${allApisToolCount} tools across ${allAgg.source_count}` : ""}
                  </option>
                  {sources.length === 0 && <option value="">No sources</option>}
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id} ({s.total_tools})
                    </option>
                  ))}
                </select>
              </label>
            )}

            {/* provider (agent only) */}
            {mode === "agent" && (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Provider</span>
                  <select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    className="rounded-lg border border-[#E5E7EB] bg-white px-2 py-1.5 text-xs text-[#111827] outline-none focus:border-[#111827]"
                  >
                    <option value="auto">Auto</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id} disabled={!p.available}>
                        {p.label}{!p.available ? (p.needs_key ? " (needs key)" : " (offline)") : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Model</span>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="rounded-lg border border-[#E5E7EB] bg-white px-2 py-1.5 text-xs text-[#111827] outline-none focus:border-[#111827]"
                  >
                    {(activeProvider?.models ?? []).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                    {(activeProvider?.models ?? []).length === 0 && <option value="">auto</option>}
                  </select>
                </label>
              </>
            )}
          </div>
        </div>

        {/* AGENT mode */}
        {mode === "agent" && (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              <div className="mx-auto flex max-w-3xl flex-col gap-3">
                {messages.map((item, index) => (
                  <div
                    key={`${item.role}-${index}`}
                    className={`max-w-[82%] rounded-xl border px-4 py-3 text-sm leading-6 whitespace-pre-wrap ${
                      item.role === "user"
                        ? "ml-auto border-[#111827] bg-[#111827] text-white"
                        : item.role === "error"
                        ? "border-red-200 bg-red-50 text-red-700"
                        : item.role === "system"
                        ? "mx-auto border-dashed border-[#D1D5DB] bg-white text-[11px] font-mono text-[#6B7280]"
                        : "border-[#E5E7EB] bg-white text-[#374151]"
                    }`}
                  >
                    {item.content}
                  </div>
                ))}
                {running && (
                  <div className="flex items-center gap-2 text-xs text-[#6B7280]">
                    <Loader2 className="size-3.5 animate-spin" /> working…
                  </div>
                )}
              </div>
            </div>

            <form onSubmit={sendMessage} className="border-t border-[#E5E7EB] bg-white p-4">
              <div className="mx-auto flex max-w-3xl gap-2">
                <Input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Ask the agent to perform a workflow with the toolset"
                  className="workspace-input"
                  disabled={running}
                />
                <Button type="submit" disabled={running} className="bg-[#111827] text-white hover:bg-black">
                  <Send />
                  Send
                </Button>
              </div>
            </form>
          </>
        )}

        {/* MANUAL mode */}
        {mode === "manual" && (
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="mx-auto max-w-3xl space-y-4">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Tool</span>
                <select
                  value={manualToolId}
                  onChange={(e) => setManualToolId(e.target.value)}
                  className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#111827] outline-none focus:border-[#111827]"
                >
                  <option value="">Select a tool…</option>
                  {selectedTools.map((t) => (
                    <option key={t.id} value={t.id}>{t.method} {t.path} — {t.id}</option>
                  ))}
                </select>
              </label>

              {manualTool && (
                <div className="space-y-4 rounded-xl border border-[#E5E7EB] bg-white p-4">
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className="font-bold text-emerald-600">{manualTool.method}</span>
                    <span className="text-[#55534E]">{manualTool.path}</span>
                  </div>

                  {pathPlaceholders(manualTool.path).length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Path params</p>
                      {pathPlaceholders(manualTool.path).map((ph) => (
                        <Input
                          key={ph}
                          placeholder={ph}
                          value={pathVals[ph] ?? ""}
                          onChange={(e) => setPathVals((v) => ({ ...v, [ph]: e.target.value }))}
                          className="workspace-input"
                        />
                      ))}
                    </div>
                  )}

                  {(manualTool.parameters ?? []).length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Query params</p>
                      {(manualTool.parameters ?? [])
                        .filter((p) => !pathPlaceholders(manualTool.path).includes(p))
                        .map((p) => (
                          <Input
                            key={p}
                            placeholder={String(p)}
                            value={queryVals[p] ?? ""}
                            onChange={(e) => setQueryVals((v) => ({ ...v, [p]: e.target.value }))}
                            className="workspace-input"
                          />
                        ))}
                    </div>
                  )}

                  {manualTool.method !== "GET" && (
                    <div className="space-y-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Body (JSON)</p>
                      <textarea
                        value={bodyText}
                        onChange={(e) => setBodyText(e.target.value)}
                        rows={4}
                        placeholder='{ "key": "value" }'
                        className="w-full rounded-lg border border-[#E5E7EB] bg-[#FAFAFA] px-3 py-2 font-mono text-xs text-[#111827] outline-none focus:border-[#111827]"
                      />
                    </div>
                  )}

                  <Button onClick={runManual} disabled={manualBusy} className="bg-[#111827] text-white hover:bg-black">
                    {manualBusy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                    Execute
                  </Button>

                  {manualResult && (
                    <pre className="max-h-80 overflow-auto rounded-lg border border-[#E5E7EB] bg-[#1E1E1E] p-3 text-[11px] leading-5 text-emerald-300">
                      {JSON.stringify(manualResult, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* RIGHT: live execution trace */}
      <aside className="flex min-h-0 flex-col overflow-hidden bg-white">
        <div className="border-b border-[#E5E7EB] px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[#111827]">Live Execution Trace</h3>
              <p className="mt-1 text-xs text-[#6B7280]">
                {toolSource === "combined"
                  ? `${selectedToolsetIds.length} toolset(s) + ${selectedSourceIds.length} source(s) · ≤${TOKEN_BUDGET.toLocaleString()} tokens`
                  : isWorkflowMode
                  ? isAuto
                    ? "Tools auto-assigned per task (token-minimizing)"
                    : isAllApis
                    ? `${allApisToolCount} workflow tools across ${allAgg?.source_count ?? "all"} APIs`
                    : `${workflowChips.length} workflow tools`
                  : `${selectedTools.length || 0} tools in toolset`}
              </p>
            </div>
            <TokenMeter usage={usage} live={running} />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mb-4 rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-[#111827]">
              <Bot className="size-4" />
              {isWorkflowMode ? "Active Workflow Tools" : toolSource === "combined" ? "Combined Tool Surface" : "Active Toolset"}
            </div>
            {toolSource === "combined" && mode === "agent" ? (
              <>
                <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-2xl font-bold text-emerald-700">≤{TOKEN_BUDGET.toLocaleString()}</span>
                    <span className="text-[11px] text-[#6B7280]">token budget</span>
                  </div>
                  <p className="mt-1 text-[10px] leading-3 text-[#9CA3AF]">
                    Mix any toolsets + workflow sources. Backend fits as many tools as possible within the budget, workflows-first (deferred = cheapest).
                  </p>
                </div>
                {(selectedToolsetIds.length > 0 || selectedSourceIds.length > 0) ? (
                  <>
                    {selectedSourceIds.length > 0 && (
                      <>
                        <p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF]">Workflow sources</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {selectedSourceIds.map(sid => (
                            <span key={sid} className="workspace-pill border-indigo-200 bg-indigo-50 font-mono text-indigo-700">{sid}</span>
                          ))}
                        </div>
                      </>
                    )}
                    {selectedToolsetIds.length > 0 && (
                      <>
                        <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF]">Toolsets</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {selectedToolsetIds.map(tsid => (
                            <span key={tsid} className="workspace-pill border-amber-200 bg-amber-50 font-mono text-amber-800">{tsid}</span>
                          ))}
                        </div>
                      </>
                    )}
                    {combinedTokenEst > 0 && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-[#6B7280]">Est. tokens</span>
                          <span className={`font-mono text-[10px] font-bold ${
                            combinedTokenEst > TOKEN_BUDGET ? "text-red-600" : "text-emerald-600"
                          }`}>{combinedTokenEst.toLocaleString()} / {TOKEN_BUDGET.toLocaleString()}</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#F3F4F6]">
                          <div
                            className={`h-full rounded-full ${
                              combinedTokenEst > TOKEN_BUDGET ? "bg-red-500" : "bg-emerald-500"
                            }`}
                            style={{ width: `${Math.min(100, (combinedTokenEst / TOKEN_BUDGET) * 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="mt-3 text-[11px] text-[#9CA3AF]">No toolsets or sources selected yet.</p>
                )}
              </>
            ) : isWorkflowMode && isAuto ? (
              <>
                {routed ? (
                  <>
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-2xl font-bold text-amber-700">{routed.tool_count}</span>
                        <span className="text-[11px] text-[#6B7280]">
                          tools sent (of {routed.aggregate_tool_count ?? "?"} available)
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] text-[#9CA3AF]">
                        Router picked the task-relevant workflows for this message — the model only sees these.
                      </p>
                      {(routed.route_terms ?? []).length > 0 && (
                        <p className="mt-1 text-[10px] text-[#9CA3AF]">
                          terms: <span className="font-mono text-amber-700">{routed.route_terms.join(", ")}</span>
                        </p>
                      )}
                    </div>
                    <p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF]">
                      {routed.fallback ? "Fallback (all APIs)" : "Auto-assigned workflows"}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {(routed.routed_workflows ?? []).map((name) => (
                        <span key={name} className="workspace-pill border-amber-200 bg-amber-50 font-mono text-amber-800">
                          {name}
                        </span>
                      ))}
                      {["search_operations", "describe_operation"].map((name) => (
                        <span key={name} className="workspace-pill border-indigo-200 bg-indigo-50 font-mono text-indigo-700">
                          {name}
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-2xl font-bold text-amber-700">~3-5</span>
                      <span className="text-[11px] text-[#6B7280]">
                        tools per task (of {allApisToolCount} available)
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] leading-3 text-[#9CA3AF]">
                      ⚡ Tools auto-assigned per task. Send a message — a deterministic router selects only the
                      task-relevant workflows so the model sees a tiny tailored surface instead of all {allApisToolCount}.
                    </p>
                  </div>
                )}
              </>
            ) : isWorkflowMode && isAllApis ? (
              <>
                <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-2xl font-bold text-indigo-700">{allApisToolCount}</span>
                    <span className="text-[11px] text-[#6B7280]">
                      workflow tools across {allAgg?.source_count ?? "all"} APIs
                    </span>
                  </div>
                  {allAgg && (
                    <p className="mt-1 text-[10px] text-[#9CA3AF]">
                      fronting {allAgg.raw_tools?.toLocaleString?.() ?? allAgg.raw_tools} raw endpoints — catalogs stay deferred
                    </p>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {["search_operations", "describe_operation"].map((name) => (
                    <span key={name} className="workspace-pill border-indigo-200 bg-indigo-50 font-mono text-indigo-700">
                      {name}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-[10px] leading-3 text-[#9CA3AF]">
                  Namespaced <span className="font-mono">{"<source>__<wf>"}</span> tools (deferred) + 2 GLOBAL meta tools.
                  search_operations / describe_operation resolve across ALL sources. Adding a 50th API barely grows the
                  tool-definition tokens.
                </p>
              </>
            ) : isWorkflowMode ? (
              <>
                <div className="mt-3 flex max-h-48 flex-wrap gap-2 overflow-y-auto pr-1">
                  {workflowChips.map((name) => (
                    <span
                      key={name}
                      className={`workspace-pill font-mono ${
                        name === "search_operations" || name === "describe_operation"
                          ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                          : ""
                      }`}
                    >
                      {name}
                    </span>
                  ))}
                  {workflowChips.length === 0 && (
                    <span className="text-xs text-[#6B7280]">No source selected.</span>
                  )}
                </div>
                <p className="mt-2 text-[10px] leading-3 text-[#9CA3AF]">
                  {wfTools.length} coarse wf_* tools + 2 meta tools (deferred descriptions). The agent
                  uses search_operations / describe_operation to discover specifics on demand.
                </p>
              </>
            ) : (
              <div className="mt-3 flex max-h-40 flex-wrap gap-2 overflow-y-auto pr-1">
                {(selectedTools.length ? selectedTools : tools.slice(0, 3)).map((tool) => (
                  <span key={tool.id} className="workspace-pill font-mono">
                    {tool.id}
                  </span>
                ))}
                {selectedTools.length === 0 && tools.length === 0 && (
                  <span className="text-xs text-[#6B7280]">No tools in this toolset.</span>
                )}
              </div>
            )}
          </div>

          {trace.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-xs text-[#9CA3AF]">
              <Terminal className="size-5" />
              Tool calls will stream here as the agent runs.
            </div>
          ) : (
            <div className="space-y-3">
              {trace.map((step) => (
                <div key={step.id} className="rounded-xl border border-[#E5E7EB] bg-white p-4 transition duration-150 hover:bg-[#FAFAFA]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      {step.status === "running" ? (
                        <Loader2 className="size-4 shrink-0 animate-spin text-[#111827]" />
                      ) : step.status === "ok" ? (
                        <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                      ) : (
                        <AlertCircle className="size-4 shrink-0 text-red-500" />
                      )}
                      <span className="truncate font-mono text-xs font-medium text-[#111827]">{step.name}</span>
                    </div>
                    {step.duration != null && (
                      <span className="flex items-center gap-1 text-xs text-[#6B7280]">
                        <Clock3 className="size-3" />
                        {step.duration}ms
                      </span>
                    )}
                  </div>
                  <p className="mt-2 break-all font-mono text-[10px] leading-4 text-[#6B7280]">{step.detail}</p>
                  {step.preview && (
                    <pre className="mt-2 max-h-32 overflow-auto rounded border border-[#E5E7EB] bg-[#FAFAFA] p-2 text-[10px] leading-4 text-[#374151]">
                      {step.preview}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </section>
  )
}
