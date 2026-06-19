import { useMemo, useState } from "react"
import { Check, Search, Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const sampleTools = [
  {
    id: "get_orders",
    method: "GET",
    path: "/orders",
    description: "Retrieve orders filtered by status, date range, or customer.",
    parameters: ["status", "from", "to", "customer_id"],
    selected: true,
  },
  {
    id: "refund_payment",
    method: "POST",
    path: "/payments/{id}/refund",
    description: "Refund a captured payment in cents with an audit reason.",
    parameters: ["id", "amount_cents", "reason"],
    selected: true,
  },
  {
    id: "list_inventory",
    method: "GET",
    path: "/inventory",
    description: "List SKU inventory counts by warehouse and reorder state.",
    parameters: ["warehouse_id", "sku", "low_stock"],
    selected: false,
  },
]

export function ToolsetManager({ tools, onToolsChange }) {
  const visibleTools = tools.length ? tools : sampleTools
  const [query, setQuery] = useState("")

  const filteredTools = useMemo(() => {
    const needle = query.toLowerCase()
    return visibleTools.filter((tool) =>
      [tool.id, tool.path, tool.method, tool.description].join(" ").toLowerCase().includes(needle)
    )
  }, [query, visibleTools])

  const selectedTools = visibleTools.filter((tool) => tool.selected)

  const updateTool = (id, patch) => {
    const source = tools.length ? tools : visibleTools
    onToolsChange(source.map((tool) => (tool.id === id ? { ...tool, ...patch } : tool)))
  }

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_1fr] overflow-hidden">
      <div className="border-b border-[#E5E7EB] bg-white px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[#111827]">Dynamic Toolset Manager</h2>
            <p className="mt-1 text-sm text-[#6B7280]">Keep curated groups focused: 5-30 tools is the recommended operating window.</p>
          </div>
          <div className="workspace-pill">
            {selectedTools.length} selected
          </div>
        </div>
      </div>

      <div className="grid min-h-0 gap-6 p-6 lg:grid-cols-[minmax(22rem,0.95fr)_minmax(0,1.05fr)]">
        <div className="workspace-card flex min-h-0 flex-col overflow-hidden">
          <div className="workspace-card-header">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 size-4 text-[#9CA3AF]" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search parsed routes"
                className="workspace-input pl-9 text-sm"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 border-b border-[#E5E7EB] bg-[#FAFAFA] text-xs font-medium text-[#6B7280]">
                <tr>
                  <th className="w-10 px-4 py-3"></th>
                  <th className="px-3 py-3">Route</th>
                  <th className="px-3 py-3">Method</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {filteredTools.map((tool) => (
                  <tr key={tool.id} className="transition duration-150 hover:bg-[#FAFAFA]">
                    <td className="px-4 py-3 align-top">
                      <input
                        type="checkbox"
                        checked={Boolean(tool.selected)}
                        onChange={(event) => updateTool(tool.id, { selected: event.target.checked })}
                        className="size-4 rounded border-[#D1D5DB] accent-[#111827]"
                        aria-label={`Select ${tool.id}`}
                      />
                    </td>
                    <td className="min-w-0 px-3 py-3">
                      <p className="truncate font-mono text-xs font-medium text-[#111827]">{tool.path}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#6B7280]">{tool.description}</p>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <span className="workspace-pill font-mono">{tool.method}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredTools.length === 0 && (
              <div className="flex min-h-48 items-center justify-center text-sm text-[#6B7280]">
                No tools match the current filters.
              </div>
            )}
          </div>
        </div>

        <div className="workspace-card flex min-h-0 flex-col overflow-hidden">
          <div className="workspace-card-header flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Settings2 className="size-4 text-[#111827]" />
              <h3 className="workspace-title">Curated Tool Configuration</h3>
            </div>
            <span className="workspace-pill">Form</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {selectedTools.length === 0 && (
              <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-[#D1D5DB] bg-[#FAFAFA] text-sm text-[#6B7280]">
                Select routes from the left pane to configure tool metadata.
              </div>
            )}

            <div className="space-y-3">
              {selectedTools.map((tool) => (
                <details key={tool.id} open className="rounded-xl border border-[#E5E7EB] bg-white">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-xs font-medium text-[#111827]">{tool.id}</span>
                      <span className="text-xs text-[#6B7280]">{tool.method} {tool.path}</span>
                    </span>
                    <Check className="size-4 shrink-0 text-[#111827]" />
                  </summary>
                  <div className="space-y-4 border-t border-[#E5E7EB] p-4">
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-[#374151]">Description override</span>
                      <textarea
                        value={tool.description}
                        onChange={(event) => updateTool(tool.id, { description: event.target.value })}
                        className="min-h-24 w-full resize-none rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#111827] outline-none transition focus:border-[#111827] focus:ring-4 focus:ring-[#111827]/10"
                      />
                    </label>
                    <div>
                      <p className="mb-2 text-xs font-medium text-[#374151]">Parameters</p>
                      <div className="flex flex-wrap gap-2">
                        {(tool.parameters ?? []).map((parameter) => (
                          <span key={parameter} className="workspace-pill font-mono">
                            {parameter}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </div>

          <div className="border-t border-[#E5E7EB] bg-[#FAFAFA] p-4">
            <Button className="w-full bg-[#111827] text-white hover:bg-black" disabled={selectedTools.length === 0}>
              Save Toolset
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
