import { useMemo, useState } from "react"
import { Bot, Clock3, Play, Send, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const cannedTrace = [
  { id: 1, label: "Intent parsed", detail: "Mapped request to curated toolset", duration: "82ms" },
  { id: 2, label: "Tool selected", detail: "refund_payment with amount_cents argument", duration: "141ms" },
  { id: 3, label: "Response synthesized", detail: "Validated payload and generated final answer", duration: "64ms" },
]

export function AgentPlayground({ tools }) {
  const selectedTools = useMemo(() => tools.filter((tool) => tool.selected), [tools])
  const [message, setMessage] = useState("")
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Ready to test the current MCP toolset." },
  ])
  const [trace, setTrace] = useState(cannedTrace.slice(0, 1))

  const sendMessage = (event) => {
    event.preventDefault()
    const trimmed = message.trim()
    if (!trimmed) return

    setMessages((current) => [
      ...current,
      { role: "user", content: trimmed },
      { role: "assistant", content: "Simulated run complete. The trace drawer has the execution chain." },
    ])
    setTrace(cannedTrace)
    setMessage("")
  }

  return (
    <section className="grid h-full min-h-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex min-h-0 flex-col border-r border-[#E5E7EB] bg-[#FAFAFA]">
        <div className="border-b border-[#E5E7EB] bg-white px-6 py-4">
          <h2 className="text-sm font-semibold text-[#111827]">Agent Playground</h2>
          <p className="mt-1 text-sm text-[#6B7280]">Send prompts and inspect the execution chain as it develops.</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {messages.map((item, index) => (
              <div
                key={`${item.role}-${index}`}
                className={`max-w-[82%] rounded-xl border px-4 py-3 text-sm leading-6 ${
                  item.role === "user"
                    ? "ml-auto border-[#111827] bg-[#111827] text-white"
                    : "border-[#E5E7EB] bg-white text-[#374151]"
                }`}
              >
                {item.content}
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={sendMessage} className="border-t border-[#E5E7EB] bg-white p-4">
          <div className="mx-auto flex max-w-3xl gap-2">
            <Input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Ask the agent to perform a workflow"
              className="workspace-input"
            />
            <Button type="submit" className="bg-[#111827] text-white hover:bg-black">
              <Send />
              Send
            </Button>
          </div>
        </form>
      </div>

      <aside className="flex min-h-0 flex-col bg-white">
        <div className="border-b border-[#E5E7EB] px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[#111827]">Live Execution Trace</h3>
              <p className="mt-1 text-xs text-[#6B7280]">{selectedTools.length || 0} curated tools available</p>
            </div>
            <div className="workspace-icon-box size-8">
              <Play className="size-4" />
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mb-4 rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-[#111827]">
              <Bot className="size-4" />
              Active Toolset
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(selectedTools.length ? selectedTools : tools.slice(0, 3)).map((tool) => (
                <span key={tool.id} className="workspace-pill font-mono">
                  {tool.id}
                </span>
              ))}
              {tools.length === 0 && <span className="text-xs text-[#6B7280]">No ingested tools yet.</span>}
            </div>
          </div>

          <div className="space-y-3">
            {trace.map((step) => (
              <div key={step.id} className="rounded-xl border border-[#E5E7EB] bg-white p-4 transition duration-150 hover:bg-[#FAFAFA]">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Wrench className="size-4 text-[#111827]" />
                    <span className="text-sm font-medium text-[#111827]">{step.label}</span>
                  </div>
                  <span className="flex items-center gap-1 text-xs text-[#6B7280]">
                    <Clock3 className="size-3" />
                    {step.duration}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-[#6B7280]">{step.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </section>
  )
}
