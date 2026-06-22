import { useEffect, useState } from "react"
import { Code, Copy, Check, Download, Loader2 } from "lucide-react"

function CopyButton({ value, label = "Copy" }) {
  const [done, setDone] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500) }}
      className="inline-flex items-center gap-1 rounded-md border border-white/30 bg-white/50 backdrop-blur-sm px-2 py-1 text-[11px] font-semibold text-[#374151] transition hover:bg-white/70">
      {done ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}{done ? "Copied" : label}
    </button>
  )
}

export function SdkPage() {
  const [sources, setSources] = useState({})
  const [sourceId, setSourceId] = useState("")
  const [lang, setLang] = useState("python")
  const [sdk, setSdk] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch("/api/v1/sources").then((r) => r.json()).then((s) => {
      setSources(s || {})
      const keys = Object.keys(s || {})
      if (keys.length) setSourceId(keys[0])
    }).catch(() => setSources({}))
  }, [])

  useEffect(() => {
    if (!sourceId) return
    setLoading(true)
    fetch(`/api/v1/sdk?source_id=${encodeURIComponent(sourceId)}&lang=${lang}`)
      .then((r) => r.json()).then(setSdk).catch(() => setSdk(null)).finally(() => setLoading(false))
  }, [sourceId, lang])

  const download = () => {
    if (!sdk?.code) return
    const blob = new Blob([sdk.code], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = sdk.filename || "client.txt"
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="h-full overflow-y-auto glass-content">
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <div className="flex flex-col gap-3 rounded-xl border border-white/30 glass-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Code className="size-5 text-[#111827]" />
            <div>
              <h2 className="text-sm font-bold text-[#111827]">SDK</h2>
              <p className="mt-0.5 text-xs text-[#374151]">A complete, typed client module for a source — calls route through the local proxy.</p>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <span className="text-[#374151]">Source</span>
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}
              className="rounded-lg border border-white/30 bg-white/50 backdrop-blur-sm px-3 py-2 text-xs text-[#111827] outline-none focus:border-[#4B8BDB]">
              {Object.keys(sources).length === 0 && <option value="">No sources</option>}
              {Object.keys(sources).map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            {["python", "typescript", "curl"].map((l) => (
              <button key={l} onClick={() => setLang(l)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize transition backdrop-blur-sm ${lang === l ? "border-[#111827] bg-[#111827] text-white" : "border-white/30 bg-white/40 text-[#374151] hover:bg-white/60"}`}>
                {l}
              </button>
            ))}
          </div>
          {sdk?.code && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#374151] font-medium bg-white/40 backdrop-blur-sm px-2 py-0.5 rounded-full border border-white/20">{sdk.operation_count} ops · {sdk.filename}</span>
              <CopyButton value={sdk.code} label="Copy code" />
              <button onClick={download} className="inline-flex items-center gap-1 rounded-md bg-[#111827] px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-black">
                <Download className="size-3" /> Download
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/40 bg-white/20 backdrop-blur-sm py-12 text-xs text-[#374151]">
            <Loader2 className="size-4 animate-spin" /> Generating client…
          </div>
        ) : sdk ? (
          <pre className="max-h-[70vh] overflow-auto rounded-lg border border-white/20 bg-black/30 backdrop-blur-2xl p-4 font-mono text-[11px] leading-5 text-emerald-300 shadow-inner">
            {sdk.code}
          </pre>
        ) : (
          <div className="rounded-xl border border-dashed border-white/40 bg-white/20 backdrop-blur-sm py-12 text-center text-xs text-[#374151]">No SDK generated.</div>
        )}
      </div>
    </div>
  )
}
