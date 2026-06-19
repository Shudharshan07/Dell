import { useEffect, useRef, useState, useCallback } from "react"
import * as d3 from "d3"
import { Search, X, ZoomIn, ZoomOut, Maximize2, RefreshCw, AlertCircle, Loader2 } from "lucide-react"

const API_BASE = ""

const METHOD_COLORS = {
  GET:    { bg: "#22c55e", text: "#052e16", glow: "rgba(34,197,94,0.45)" },
  POST:   { bg: "#3b82f6", text: "#eff6ff", glow: "rgba(59,130,246,0.45)" },
  PUT:    { bg: "#f59e0b", text: "#1c1003", glow: "rgba(245,158,11,0.45)" },
  DELETE: { bg: "#ef4444", text: "#fff1f2", glow: "rgba(239,68,68,0.45)" },
  PATCH:  { bg: "#a855f7", text: "#faf5ff", glow: "rgba(168,85,247,0.45)" },
}

function methodColor(method) {
  return METHOD_COLORS[method] ?? { bg: "#6b7280", text: "#f9fafb", glow: "rgba(107,114,128,0.4)" }
}

// ── Stats bar ────────────────────────────────────────────────────────────────
function StatsBar({ summary }) {
  if (!summary) return null
  return (
    <div className="flex gap-4 px-4 py-2 border-b border-neutral-800 bg-neutral-900/60 text-xs text-neutral-400 select-none">
      <span>Endpoints: <strong className="text-white">{summary.total_endpoints}</strong></span>
      <span>Dependencies: <strong className="text-white">{summary.detected_dependencies}</strong></span>
      <span>Complexity:&nbsp;
        <strong className={
          summary.detected_dependencies > 80 ? "text-red-400"
          : summary.detected_dependencies > 30 ? "text-amber-400"
          : "text-green-400"
        }>
          {summary.detected_dependencies > 80 ? "High" : summary.detected_dependencies > 30 ? "Medium" : "Low"}
        </strong>
      </span>
    </div>
  )
}

// ── Node detail panel ────────────────────────────────────────────────────────
function DetailPanel({ node, links, onClose }) {
  if (!node) return null
  const c = methodColor(node.method)
  const incoming = links.filter(l => (l.target?.id ?? l.target) === node.id).map(l => l.source?.id ?? l.source)
  const outgoing = links.filter(l => (l.source?.id ?? l.source) === node.id).map(l => l.target?.id ?? l.target)

  return (
    <div className="absolute right-4 top-4 z-20 w-80 rounded-xl border border-neutral-700 bg-neutral-900/90 backdrop-blur-md p-4 shadow-2xl">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide"
            style={{ background: c.bg, color: c.text }}>{node.method}</span>
          <span className="text-xs font-mono text-neutral-200 truncate">{node.path}</span>
        </div>
        <button onClick={onClose} className="shrink-0 text-neutral-500 hover:text-white transition-colors">
          <X className="size-4" />
        </button>
      </div>

      {node.summary && node.summary !== node.path && (
        <p className="text-xs text-neutral-400 mb-3 leading-relaxed">{node.summary}</p>
      )}

      <div className="space-y-2">
        {incoming.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">Incoming ({incoming.length})</p>
            <ul className="space-y-1">
              {incoming.slice(0, 5).map(s => (
                <li key={s} className="text-[11px] font-mono text-neutral-300 truncate bg-neutral-800 rounded px-2 py-0.5">{s}</li>
              ))}
              {incoming.length > 5 && <li className="text-[11px] text-neutral-500">+{incoming.length - 5} more</li>}
            </ul>
          </div>
        )}
        {outgoing.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">Outgoing ({outgoing.length})</p>
            <ul className="space-y-1">
              {outgoing.slice(0, 5).map(t => (
                <li key={t} className="text-[11px] font-mono text-neutral-300 truncate bg-neutral-800 rounded px-2 py-0.5">{t}</li>
              ))}
              {outgoing.length > 5 && <li className="text-[11px] text-neutral-500">+{outgoing.length - 5} more</li>}
            </ul>
          </div>
        )}
        {incoming.length === 0 && outgoing.length === 0 && (
          <p className="text-xs text-neutral-500">No dependencies detected for this endpoint.</p>
        )}
      </div>
    </div>
  )
}

// ── D3 Graph ─────────────────────────────────────────────────────────────────
function D3Graph({ nodes, links, filter, onNodeClick, selectedId }) {
  const svgRef = useRef(null)
  const simRef = useRef(null)
  const zoomRef = useRef(null)

  // expose zoom helpers via callback refs
  const zoomInFn = useRef(null)
  const zoomOutFn = useRef(null)
  const resetFn = useRef(null)

  useEffect(() => {
    if (!nodes.length) return

    const el = svgRef.current
    const W = el.clientWidth || 900
    const H = el.clientHeight || 600

    // clean up previous render
    d3.select(el).selectAll("*").remove()

    const svg = d3.select(el)
      .attr("width", W).attr("height", H)

    // defs: arrowhead + glow filter
    const defs = svg.append("defs")

    defs.append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -4 10 8")
      .attr("refX", 22).attr("refY", 0)
      .attr("markerWidth", 6).attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-4L10,0L0,4")
      .attr("fill", "#6b7280")

    // per-method glow filters
    Object.entries(METHOD_COLORS).forEach(([method, c]) => {
      const f = defs.append("filter").attr("id", `glow-${method}`).attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%")
      f.append("feGaussianBlur").attr("stdDeviation", "4").attr("result", "coloredBlur")
      const feMerge = f.append("feMerge")
      feMerge.append("feMergeNode").attr("in", "coloredBlur")
      feMerge.append("feMergeNode").attr("in", "SourceGraphic")
    })

    const g = svg.append("g")

    const zoom = d3.zoom()
      .scaleExtent([0.05, 4])
      .on("zoom", e => g.attr("transform", e.transform))
    svg.call(zoom)
    zoomRef.current = zoom

    zoomInFn.current  = () => svg.transition().duration(300).call(zoom.scaleBy, 1.4)
    zoomOutFn.current = () => svg.transition().duration(300).call(zoom.scaleBy, 0.72)
    resetFn.current   = () => svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity)

    // working copies so D3 can mutate positions
    const nodeData = nodes.map(n => ({ ...n }))
    const linkData = links.map(l => ({ ...l }))

    const sim = d3.forceSimulation(nodeData)
      .force("link", d3.forceLink(linkData).id(d => d.id).distance(90).strength(0.5))
      .force("charge", d3.forceManyBody().strength(-280))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force("collision", d3.forceCollide(28))
    simRef.current = sim

    // links
    const link = g.append("g").attr("class", "links")
      .selectAll("line")
      .data(linkData)
      .enter().append("line")
      .attr("stroke", "#374151")
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", "5 3")
      .attr("marker-end", "url(#arrow)")
      .attr("opacity", 0.7)

    // nodes
    const node = g.append("g").attr("class", "nodes")
      .selectAll("g")
      .data(nodeData)
      .enter().append("g")
      .attr("cursor", "pointer")
      .call(
        d3.drag()
          .on("start", (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
          .on("drag",  (event, d) => { d.fx = event.x; d.fy = event.y })
          .on("end",   (event, d) => { if (!event.active) sim.alphaTarget(0); d.fx = null; d.fy = null })
      )
      .on("click", (_, d) => onNodeClick(d))

    node.append("circle")
      .attr("r", 14)
      .attr("fill", d => methodColor(d.method).bg)
      .attr("stroke", "#1f2937")
      .attr("stroke-width", 2)

    node.append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("font-size", "8px")
      .attr("font-weight", "700")
      .attr("fill", d => methodColor(d.method).text)
      .attr("pointer-events", "none")
      .text(d => d.method.slice(0, 3))

    node.append("title").text(d => `${d.method} ${d.path}`)

    sim.on("tick", () => {
      link
        .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x).attr("y2", d => d.target.y)
      node.attr("transform", d => `translate(${d.x},${d.y})`)
    })

    return () => { sim.stop() }
  }, [nodes, links])

  // filter dimming
  useEffect(() => {
    if (!svgRef.current) return
    const lower = filter.toLowerCase()
    d3.select(svgRef.current).selectAll(".nodes g")
      .attr("opacity", d => !lower || d.id.toLowerCase().includes(lower) ? 1 : 0.15)
  }, [filter])

  // selected highlight
  useEffect(() => {
    if (!svgRef.current) return
    d3.select(svgRef.current).selectAll(".nodes g circle")
      .attr("stroke", d => d.id === selectedId ? "#a78bfa" : "#1f2937")
      .attr("stroke-width", d => d.id === selectedId ? 3 : 2)
      .attr("filter", d => d.id === selectedId ? `url(#glow-${d.method})` : null)
  }, [selectedId])

  return (
    <div className="relative size-full">
      <svg ref={svgRef} className="size-full" />
      {/* zoom controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1.5">
        {[
          { icon: ZoomIn,    fn: () => zoomInFn.current?.(),  label: "Zoom in" },
          { icon: ZoomOut,   fn: () => zoomOutFn.current?.(), label: "Zoom out" },
          { icon: Maximize2, fn: () => resetFn.current?.(),   label: "Reset" },
        ].map(({ icon: Icon, fn, label }) => (
          <button key={label} onClick={fn} title={label}
            className="size-8 flex items-center justify-center rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-300 hover:text-white hover:bg-neutral-700 transition-colors shadow">
            <Icon className="size-4" />
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Main DagViewer component ──────────────────────────────────────────────────
export function DagViewer() {
  const [specs, setSpecs]           = useState([])
  const [selectedSpec, setSelectedSpec] = useState("")
  const [dagData, setDagData]       = useState(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)
  const [filter, setFilter]         = useState("")
  const [selectedNode, setSelectedNode] = useState(null)

  // fetch available specs on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/specs`)
      .then(r => r.json())
      .then(data => {
        setSpecs(data.specs ?? [])
        if (data.specs?.length) setSelectedSpec(data.specs[0])
      })
      .catch(() => setError("Could not connect to backend. Make sure the compiler server is running on port 8000."))
  }, [])

  // fetch DAG when selection changes
  useEffect(() => {
    if (!selectedSpec) return
    setLoading(true)
    setError(null)
    setSelectedNode(null)
    setDagData(null)
    fetch(`${API_BASE}/api/dag?filename=${encodeURIComponent(selectedSpec)}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(data => { setDagData(data); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [selectedSpec])

  const handleNodeClick = useCallback((node) => {
    setSelectedNode(prev => prev?.id === node.id ? null : node)
  }, [])

  return (
    <div className="flex flex-col h-full bg-neutral-950">
      {/* toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-neutral-800 bg-neutral-900/50 flex-wrap">
        {/* spec selector */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-neutral-400 whitespace-nowrap">Spec file</label>
          <select
            value={selectedSpec}
            onChange={e => setSelectedSpec(e.target.value)}
            className="bg-neutral-800 border border-neutral-700 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-500 max-w-xs"
          >
            {specs.map(s => <option key={s} value={s}>{s}</option>)}
            {specs.length === 0 && <option value="">Loading specs…</option>}
          </select>
        </div>

        {/* search filter */}
        <div className="relative flex items-center">
          <Search className="absolute left-2 size-3.5 text-neutral-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Filter endpoints…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="bg-neutral-800 border border-neutral-700 text-white text-xs rounded-lg pl-7 pr-7 py-1.5 w-52 focus:outline-none focus:ring-1 focus:ring-violet-500 placeholder:text-neutral-500"
          />
          {filter && (
            <button onClick={() => setFilter("")} className="absolute right-2 text-neutral-500 hover:text-white">
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* reload */}
        <button
          onClick={() => setSelectedSpec(s => { const v = s; setSelectedSpec(""); setTimeout(() => setSelectedSpec(v), 10); return v })}
          title="Reload"
          className="ml-auto flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white bg-neutral-800 border border-neutral-700 rounded-lg px-2.5 py-1.5 transition-colors"
        >
          <RefreshCw className="size-3.5" />
          Reload
        </button>
      </div>

      {/* stats */}
      {dagData && <StatsBar summary={dagData.summary} />}

      {/* main canvas */}
      <div className="relative flex-1 overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-neutral-950/80">
            <Loader2 className="size-8 text-violet-400 animate-spin" />
            <p className="text-sm text-neutral-400">Parsing spec and building graph…</p>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 px-8 text-center">
            <AlertCircle className="size-8 text-red-400" />
            <p className="text-sm text-red-300 max-w-md">{error}</p>
          </div>
        )}

        {!loading && !error && dagData && dagData.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-neutral-500 text-sm">No endpoints detected in this spec.</p>
          </div>
        )}

        {dagData && dagData.nodes.length > 0 && (
          <D3Graph
            nodes={dagData.nodes}
            links={dagData.links}
            filter={filter}
            onNodeClick={handleNodeClick}
            selectedId={selectedNode?.id}
          />
        )}

        {selectedNode && (
          <DetailPanel
            node={selectedNode}
            links={dagData?.links ?? []}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </div>

      {/* method legend */}
      {dagData && dagData.nodes.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 border-t border-neutral-800 bg-neutral-900/40 flex-wrap">
          {Object.entries(METHOD_COLORS).map(([method, c]) => (
            <span key={method} className="flex items-center gap-1.5 text-xs text-neutral-400">
              <span className="size-2.5 rounded-full" style={{ background: c.bg }} />
              {method}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
