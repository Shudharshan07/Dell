import { useState, useEffect, useMemo } from "react"
import {
  Check,
  Search,
  Trash2,
  Plus,
  Play,
  Copy,
  ChevronDown,
  Wrench,
  Bot,
  ExternalLink,
  ChevronRight,
  ArrowLeft,
  X,
  SlidersHorizontal,
  FolderOpen,
  FileCode,
  Globe,
  CheckSquare,
  Square
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SidebarTrigger } from "@/components/ui/sidebar"

export function ToolsetManager({
  tools,
  onToolsChange,
  sources = {},
  selectedSource = "",
  onSourceChange,
  onSaveToolset,
  onNavigatePage
}) {
  // Navigation / sub-page state
  const [view, setView] = useState("list") // "list", "detail", "update"
  const [toolsets, setToolsets] = useState([])
  const [selectedToolset, setSelectedToolset] = useState(null)
  
  // Dialog / Creation state
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newDesc, setNewDesc] = useState("New Toolset Description")
  const [newSource, setNewSource] = useState("")

  // Search & Filter state for detail/update views
  const [searchQuery, setSearchQuery] = useState("")
  const [tagFilter, setTagFilter] = useState("All") // HTTP methods: All, GET, POST, etc.

  // Tabs for detail view
  const [activeTab, setActiveTab] = useState("Tools") // "Tools", "Prompts", "MCP"

  // Dropdown states
  const [activeToolsDropdownOpen, setActiveToolsDropdownOpen] = useState(false)
  const [listDropdownOpenId, setListDropdownOpenId] = useState(null)

  // Feedback states
  const [copied, setCopied] = useState(false)
  const [isEditingDesc, setIsEditingDesc] = useState(false)
  const [editedDesc, setEditedDesc] = useState("")

  // Update View temporary tool selections
  const [tempSelectedToolIds, setTempSelectedToolIds] = useState(new Set())

  // Fetch toolsets from backend
  const fetchToolsets = async () => {
    try {
      const response = await fetch("/api/v1/toolsets")
      if (response.ok) {
        const data = await response.json()
        setToolsets(Object.values(data))
      }
    } catch (err) {
      console.error("Failed to fetch toolsets", err)
    }
  }

  useEffect(() => {
    fetchToolsets()
  }, [])

  // Auto-initialize source select when create dialog is opened
  useEffect(() => {
    if (isCreateOpen && Object.keys(sources).length > 0 && !newSource) {
      setNewSource(Object.keys(sources)[0])
    }
  }, [isCreateOpen, sources, newSource])

  // Handles copying to clipboard
  const handleCopyName = (text) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Handle saving inline description
  const handleSaveDescription = async () => {
    if (!selectedToolset) return
    setIsEditingDesc(false)
    const updated = {
      ...selectedToolset,
      description: editedDesc
    }
    setSelectedToolset(updated)

    try {
      const response = await fetch("/api/v1/toolsets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolset_id: updated.toolset_id,
          tools: updated.tools,
          description: updated.description
        })
      })
      if (response.ok) {
        fetchToolsets()
      }
    } catch (err) {
      console.error("Error updating toolset description", err)
    }
  }

  // Handle creating new toolset
  const handleCreateToolset = async () => {
    if (!newName.trim() || !newSource) return
    
    // Fetch source tools first
    try {
      const response = await fetch(`/api/v1/sources/${newSource}/tools`)
      if (response.ok) {
        const data = await response.json()
        const initialTools = (data.tools ?? []).map((t, idx) => ({
          id: t.operation_id ?? t.id ?? t.name ?? `${t.method}_${idx}`,
          method: t.method ?? "POST",
          path: t.path ?? "/",
          description: t.description ?? t.summary ?? "Generated tool route",
          parameters: t.parameters ?? [],
          selected: false // start with none selected
        }))

        const payload = {
          toolset_id: newName.trim(),
          description: newDesc,
          tools: initialTools
        }

        const saveRes = await fetch("/api/v1/toolsets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        })

        if (saveRes.ok) {
          await fetchToolsets()
          setIsCreateOpen(false)
          setNewName("")
          setNewDesc("New Toolset Description")
          
          // Open the detail page of the new toolset
          setSelectedToolset(payload)
          setView("detail")
        } else {
          alert("Failed to save toolset to backend.")
        }
      }
    } catch (err) {
      console.error("Error creating toolset", err)
    }
  }

  // Handle deleting toolset
  const handleDeleteToolset = async (id) => {
    if (!confirm(`Are you sure you want to delete toolset '${id}'?`)) return
    try {
      const response = await fetch(`/api/v1/toolsets/${id}`, { method: "DELETE" })
      if (response.ok) {
        await fetchToolsets()
        if (selectedToolset?.toolset_id === id) {
          setSelectedToolset(null)
          setView("list")
        }
      }
    } catch (err) {
      console.error("Failed to delete toolset", err)
    }
  }

  // Handle opening Update View
  const handleOpenUpdate = async () => {
    if (!selectedToolset) return
    
    // Determine the source of this toolset
    // We assume the source name matches or is linked, or we query
    const sourceId = Object.keys(sources).find(s => 
      selectedToolset.toolset_id.toLowerCase().includes(s.toLowerCase())
    ) || Object.keys(sources)[0]

    if (!sourceId) {
      alert("No active API sources found. Please ingest an OpenAPI spec first.")
      return
    }

    try {
      const response = await fetch(`/api/v1/sources/${sourceId}/tools`)
      if (response.ok) {
        const data = await response.json()
        
        // Find existing tool choices
        const existingSelectedIds = new Set(
          selectedToolset.tools.filter(t => t.selected).map(t => t.id)
        )

        // Build list of all tools from source schema
        const allSourceTools = (data.tools ?? []).map((t, idx) => ({
          id: t.operation_id ?? t.id ?? t.name ?? `${t.method}_${idx}`,
          method: t.method ?? "POST",
          path: t.path ?? "/",
          description: t.description ?? t.summary ?? "Generated tool route",
          parameters: t.parameters ?? [],
          selected: existingSelectedIds.has(t.operation_id ?? t.id ?? t.name)
        }))

        // Update selected set
        setTempSelectedToolIds(new Set(selectedToolset.tools.filter(t => t.selected).map(t => t.id)))
        
        // Temporarily store full tools list inside selectedToolset for update view
        setSelectedToolset({
          ...selectedToolset,
          source_id: sourceId,
          all_available_tools: allSourceTools
        })
        setView("update")
        setSearchQuery("")
        setTagFilter("All")
      }
    } catch (err) {
      console.error("Failed to open update tools list", err)
    }
  }

  // Handle checkbox toggles in Update View
  const toggleTempTool = (id) => {
    const next = new Set(tempSelectedToolIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    setTempSelectedToolIds(next)
  }

  // Enable All filtered tools
  const handleEnableAllFiltered = (filteredList) => {
    const next = new Set(tempSelectedToolIds)
    filteredList.forEach(t => next.add(t.id))
    setTempSelectedToolIds(next)
  }

  // Handle saving from Update View
  const handleSaveUpdate = async () => {
    if (!selectedToolset) return

    const updatedTools = (selectedToolset.all_available_tools ?? []).map(t => ({
      ...t,
      selected: tempSelectedToolIds.has(t.id)
    }))

    const updatedToolset = {
      ...selectedToolset,
      tools: updatedTools
    }
    delete updatedToolset.all_available_tools

    try {
      const response = await fetch("/api/v1/toolsets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolset_id: updatedToolset.toolset_id,
          tools: updatedToolset.tools,
          description: updatedToolset.description
        })
      })
      if (response.ok) {
        await fetchToolsets()
        setSelectedToolset(updatedToolset)
        setView("detail")
      }
    } catch (err) {
      console.error("Failed to save toolset updates", err)
    }
  }

  // Filter tools for Detail / Update view
  const filteredTools = useMemo(() => {
    if (!selectedToolset) return []
    const list = view === "update" 
      ? (selectedToolset.all_available_tools ?? []) 
      : selectedToolset.tools.filter(t => t.selected)
    
    return list.filter((tool) => {
      const matchesSearch = [tool.id, tool.path, tool.method, tool.description]
        .join(" ")
        .toLowerCase()
        .includes(searchQuery.toLowerCase())
      
      const matchesTag = tagFilter === "All" || tool.method.toUpperCase() === tagFilter.toUpperCase()
      
      return matchesSearch && matchesTag
    })
  }, [selectedToolset, searchQuery, tagFilter, view])

  // Count active tools
  const activeToolsCount = selectedToolset?.tools?.filter(t => t.selected)?.length ?? 0

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#EDEDEB]">
      {/* Header bar styled like the mockup */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#D0CECA] bg-white px-6">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="rounded-lg text-[#787670] hover:bg-[#EAE8E3] hover:text-[#111827]" />
          <span className="text-[#D0CECA] font-light">|</span>
          <nav className="flex items-center gap-2 text-xs font-semibold text-[#55534E]">
            <button 
              onClick={() => setView("list")} 
              className={`hover:text-[#111827] transition ${view === "list" ? "text-[#111827]" : ""}`}
            >
              Toolsets
            </button>
            {view !== "list" && (
              <>
                <span className="text-[#A2A09A]">/</span>
                <button 
                  onClick={() => setView("detail")} 
                  className={`hover:text-[#111827] transition ${view === "detail" ? "text-[#111827]" : ""}`}
                >
                  {selectedToolset?.toolset_id}
                </button>
              </>
            )}
            {view === "update" && (
              <>
                <span className="text-[#A2A09A]">/</span>
                <span className="text-[#111827]">Update</span>
              </>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {view !== "list" && (
            <button
              onClick={() => handleDeleteToolset(selectedToolset.toolset_id)}
              className="p-2 text-[#787670] hover:bg-red-50 hover:text-red-600 rounded-lg transition"
              title="Delete Toolset"
            >
              <Trash2 className="size-4" />
            </button>
          )}
          <button
            onClick={() => {
              setNewName("")
              setIsCreateOpen(true)}
            }
            className="p-2 text-[#787670] hover:bg-[#EAE8E3] hover:text-[#111827] rounded-lg transition"
            title="Create New Toolset"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </header>

      {/* Main View Area */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* LIST VIEW */}
        {view === "list" && (
          <div className="max-w-5xl mx-auto p-8 space-y-6">
            <div className="space-y-4">
              {toolsets.map((ts) => {
                const activeTools = ts.tools?.filter(t => t.selected) ?? []
                return (
                  <div 
                    key={ts.toolset_id}
                    className="relative bg-white rounded-xl border border-[#D0CECA] p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 transition duration-150 hover:shadow-md cursor-pointer"
                    onClick={() => {
                      setSelectedToolset(ts)
                      setView("detail")
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-bold text-[#111827]">{ts.toolset_id}</h3>
                      <p className="text-sm text-[#787670] mt-1">{ts.description || "New Toolset Description"}</p>
                    </div>
                    
                    <div className="relative shrink-0" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => setListDropdownOpenId(listDropdownOpenId === ts.toolset_id ? null : ts.toolset_id)}
                        className="workspace-pill hover:bg-[#EAE8E3] transition px-3 py-1.5 flex items-center gap-1.5"
                      >
                        {activeTools.length} Tools
                        <ChevronDown className="size-3 text-[#787670]" />
                      </button>

                      {/* Dropdown Menu listing tools */}
                      {listDropdownOpenId === ts.toolset_id && (
                        <div className="absolute right-0 mt-2 w-64 bg-[#1E1E1E] text-white text-xs font-mono rounded-lg shadow-xl border border-[#2B2B2B] py-2 z-30 max-h-60 overflow-y-auto">
                          {activeTools.length === 0 ? (
                            <div className="px-4 py-2 text-[#787670] italic">No active tools</div>
                          ) : (
                            activeTools.map(tool => (
                              <div key={tool.id} className="px-4 py-1.5 hover:bg-[#333333] truncate">
                                {tool.id}
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

              {/* Add New Toolset card at bottom */}
              <button 
                onClick={() => {
                  setNewName("")
                  setIsCreateOpen(true)}
                }
                className="w-full bg-[#EDEDEB] hover:bg-white rounded-xl border border-dashed border-[#D0CECA] py-8 flex flex-col items-center justify-center gap-2 transition cursor-pointer text-[#787670] hover:text-[#111827] font-semibold"
              >
                <Plus className="size-6" />
                <span>+ New Toolset</span>
              </button>
            </div>
          </div>
        )}

        {/* DETAIL VIEW */}
        {view === "detail" && selectedToolset && (
          <div className="max-w-5xl mx-auto p-8 space-y-6">
            {/* Title, copy, description, and right actions */}
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-3xl font-bold tracking-tight text-[#111827]">{selectedToolset.toolset_id}</h2>
                  <button 
                    onClick={() => handleCopyName(selectedToolset.toolset_id)}
                    className="p-1 text-[#787670] hover:text-[#111827] rounded transition relative"
                    title="Copy Toolset Name"
                  >
                    {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
                  </button>
                </div>
                
                {isEditingDesc ? (
                  <div className="flex items-center gap-2 max-w-xl">
                    <Input 
                      value={editedDesc}
                      onChange={(e) => setEditedDesc(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSaveDescription()}
                      className="bg-white border-[#D0CECA] focus-visible:ring-1 focus-visible:ring-[#111827]"
                      autoFocus
                    />
                    <Button onClick={handleSaveDescription} size="sm" className="bg-[#111827] text-white hover:bg-black">Save</Button>
                    <Button onClick={() => setIsEditingDesc(false)} size="sm" variant="outline">Cancel</Button>
                  </div>
                ) : (
                  <p 
                    onClick={() => {
                      setEditedDesc(selectedToolset.description || "New Toolset Description")
                      setIsEditingDesc(true)
                    }}
                    className="text-sm text-[#787670] cursor-pointer hover:underline decoration-dashed"
                  >
                    {selectedToolset.description || "New Toolset Description"}
                  </p>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap items-center gap-3">
                <Button 
                  onClick={() => onNavigatePage?.("playground")}
                  variant="outline" 
                  className="bg-white border-[#D0CECA] hover:bg-[#EAE8E3] text-xs font-semibold px-4 rounded-full h-10 gap-1.5 text-[#111827]"
                >
                  Playground <Bot className="size-4" />
                </Button>
                <button 
                  onClick={handleOpenUpdate}
                  className="bg-[#111827] hover:bg-black text-white text-xs font-semibold px-5 py-2.5 rounded-full flex items-center gap-2 transition duration-150"
                >
                  <Plus className="size-3.5" /> Add/Remove Tools
                </button>
                
                {/* Active tools count popover */}
                <div className="relative">
                  <button 
                    onClick={() => setActiveToolsDropdownOpen(!activeToolsDropdownOpen)}
                    className="bg-[#EAE8E3] text-[#111827] border border-[#D0CECA] text-xs font-semibold px-4 py-2.5 rounded-full flex items-center gap-1.5 hover:bg-[#D4D2CD] transition"
                  >
                    {activeToolsCount === 0 ? "No Tools" : `${activeToolsCount} Tools`}
                    <ChevronDown className="size-3 text-[#787670]" />
                  </button>

                  {activeToolsDropdownOpen && (
                    <div className="absolute right-0 mt-2 w-64 bg-[#1E1E1E] text-white text-xs font-mono rounded-lg shadow-xl border border-[#2B2B2B] py-2 z-30 max-h-60 overflow-y-auto">
                      {activeToolsCount === 0 ? (
                        <div className="px-4 py-2 text-[#787670] italic">No active tools</div>
                      ) : (
                        selectedToolset.tools.filter(t => t.selected).map(tool => (
                          <div key={tool.id} className="px-4 py-1.5 hover:bg-[#333333] truncate">
                            {tool.id}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Navigation tabs */}
            <div className="flex gap-2.5 border-b border-[#D0CECA] pb-3">
              {["Tools", "Prompts", "MCP"].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition duration-150 ${
                    activeTab === tab 
                      ? "bg-[#111827] text-white border-[#111827]" 
                      : "bg-white text-[#787670] border-[#D1CFCA] hover:bg-[#EAE8E3]"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* TAB CONTENT: Tools */}
            {activeTab === "Tools" && (
              <div className="space-y-4">
                {activeToolsCount === 0 ? (
                  <button 
                    onClick={handleOpenUpdate}
                    className="w-full bg-[#EDEDEB] hover:bg-white rounded-xl border border-dashed border-[#D0CECA] py-14 flex flex-col items-center justify-center gap-2 transition cursor-pointer text-[#787670] hover:text-[#111827] font-semibold"
                  >
                    <Plus className="size-6" />
                    <span>+ Add Tool</span>
                  </button>
                ) : (
                  <div className="grid gap-4 md:grid-cols-1">
                    {selectedToolset.tools.filter(t => t.selected).map((tool) => (
                      <div key={tool.id} className="bg-white border border-[#D1CFCA] rounded-xl p-5 space-y-3 shadow-xs">
                        <div className="flex justify-between items-start">
                          <span className="font-mono text-xs font-bold text-[#111827]">{tool.id}</span>
                          <span className="bg-[#EAE8E3] text-[#111827] px-2 py-0.5 rounded text-[10px] font-mono border border-[#D1CFCA]">
                            {selectedToolset.toolset_id.split(" ")[0]}
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-emerald-600 font-bold">{tool.method}</span>
                          <span className="font-mono text-xs text-[#55534E]">{tool.path}</span>
                        </div>

                        {tool.description && (
                          <div 
                            className="border-l-2 border-[#D1CFCA] pl-3 text-xs text-[#55534E] leading-relaxed italic bg-[#FAFAFA] py-2 pr-2 rounded-r"
                            dangerouslySetInnerHTML={{ __html: tool.description }}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT: Prompts */}
            {activeTab === "Prompts" && (
              <div className="space-y-4">
                <div className="bg-white border border-[#D1CFCA] rounded-xl p-6 space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-sm font-bold text-[#111827]">Generate API Client</h4>
                      <p className="text-xs text-[#787670] mt-1">Prompt template to generate SDK libraries.</p>
                    </div>
                    <span className="workspace-pill">System</span>
                  </div>
                  <div className="bg-[#FAFAFA] p-3 rounded-lg border border-[#D0CECA] font-mono text-xs text-[#55534E] leading-relaxed whitespace-pre-wrap">
                    {"Write a production-ready SDK wrapper client for the Stripe Charges API in Go. Implement robust error handling, retries, and clean logging."}
                  </div>
                </div>
              </div>
            )}

            {/* TAB CONTENT: MCP */}
            {activeTab === "MCP" && (
              <div className="space-y-4">
                <div className="bg-white border border-[#D1CFCA] rounded-xl p-6 space-y-4">
                  <div>
                    <h4 className="text-sm font-bold text-[#111827]">Model Context Protocol Integration</h4>
                    <p className="text-xs text-[#787670] mt-1">Configure your local workspace LLM to query this toolset via SSE.</p>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <span className="text-[10px] uppercase font-bold text-[#787670]">SSE Transport Host</span>
                      <div className="bg-[#FAFAFA] px-3 py-2 rounded-lg border border-[#D0CECA] flex items-center justify-between font-mono text-xs text-[#55534E]">
                        <span>http://localhost:8002/sse</span>
                        <button 
                          onClick={() => handleCopyName("http://localhost:8002/sse")}
                          className="text-[#787670] hover:text-[#111827]"
                        >
                          <Copy className="size-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="text-[10px] uppercase font-bold text-[#787670]">Fastmcp run CLI</span>
                      <div className="bg-[#FAFAFA] px-3 py-2 rounded-lg border border-[#D0CECA] flex items-center justify-between font-mono text-xs text-[#55534E]">
                        <span>fastmcp run app/mcp_server.py --port 8002</span>
                        <button 
                          onClick={() => handleCopyName("fastmcp run app/mcp_server.py --port 8002")}
                          className="text-[#787670] hover:text-[#111827]"
                        >
                          <Copy className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* UPDATE / EDIT STATE */}
        {view === "update" && selectedToolset && (
          <div className="max-w-5xl mx-auto p-8 space-y-6">
            {/* Header info */}
            <div className="flex justify-between items-start gap-4">
              <div>
                <h2 className="text-3xl font-bold tracking-tight text-[#111827]">{selectedToolset.toolset_id}</h2>
                <p className="text-sm text-[#787670] mt-1">{selectedToolset.description || "New Toolset Description"}</p>
              </div>
              <span className="bg-[#EAE8E3] text-[#111827] border border-[#D0CECA] text-xs font-semibold px-4 py-2.5 rounded-full shrink-0">
                {tempSelectedToolIds.size === 0 ? "No Tools" : `${tempSelectedToolIds.size} Selected`}
              </span>
            </div>

            {/* Filter and search bar */}
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative shrink-0 w-full md:w-48">
                <select
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  className="w-full appearance-none rounded-lg border border-[#D0CECA] bg-white px-4 py-2.5 text-sm text-[#111827] outline-none font-medium pr-10 cursor-pointer"
                >
                  <option value="All">Filter By Tag</option>
                  <option value="GET">GET Methods</option>
                  <option value="POST">POST Methods</option>
                  <option value="PUT">PUT Methods</option>
                  <option value="DELETE">DELETE Methods</option>
                  <option value="PATCH">PATCH Methods</option>
                </select>
                <ChevronDown className="absolute right-3 top-3.5 size-4 text-[#787670] pointer-events-none" />
              </div>

              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-3.5 size-4 text-[#787670]" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search routes"
                  className="bg-white border-[#D0CECA] pl-10 h-11 text-sm focus-visible:ring-1 focus-visible:ring-[#111827]"
                />
              </div>
            </div>

            {/* Tools table list */}
            <div className="bg-white rounded-xl border border-[#D0CECA] overflow-hidden">
              {/* Header row */}
              <div className="flex items-center justify-between bg-[#FAFAFA] border-b border-[#D0CECA] px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="font-bold text-sm text-[#111827] capitalize">
                    {selectedToolset.source_id || selectedToolset.toolset_id.split(" ")[0]}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs font-semibold text-[#55534E]">
                    {tempSelectedToolIds.size} / {(selectedToolset.all_available_tools ?? []).length} Tools
                  </span>
                  <button 
                    onClick={() => handleEnableAllFiltered(filteredTools)}
                    className="bg-white border border-[#D0CECA] hover:bg-[#EAE8E3] text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition text-[#111827]"
                  >
                    <Check className="size-3.5 text-emerald-600" /> Enable All
                  </button>
                </div>
              </div>

              {/* Rows */}
              <div className="divide-y divide-[#D0CECA]">
                {filteredTools.map((tool) => {
                  const isChecked = tempSelectedToolIds.has(tool.id)
                  return (
                    <div 
                      key={tool.id}
                      onClick={() => toggleTempTool(tool.id)}
                      className="flex items-start gap-4 px-6 py-4 hover:bg-[#FAFAFA] cursor-pointer transition"
                    >
                      <div className="mt-1 shrink-0">
                        {isChecked ? (
                          <CheckSquare className="size-4 text-[#111827] fill-[#111827] text-white" />
                        ) : (
                          <Square className="size-4 text-[#787670]" />
                        )}
                      </div>
                      
                      <div className="flex-1 min-w-0 md:max-w-md">
                        <p className="font-mono text-xs font-bold text-[#111827] truncate">{tool.id}</p>
                        <div className="flex items-center gap-1.5 mt-1 font-mono text-[10px]">
                          <span className="text-emerald-600 font-bold">{tool.method}</span>
                          <span className="text-[#787670] truncate">{tool.path}</span>
                        </div>
                      </div>

                      {tool.description && (
                        <div 
                          className="flex-1 text-xs text-[#55534E] leading-relaxed truncate md:line-clamp-2 md:whitespace-normal italic pl-4 border-l border-[#D0CECA] hidden md:block"
                          dangerouslySetInnerHTML={{ __html: tool.description }}
                        />
                      )}
                    </div>
                  )
                })}

                {filteredTools.length === 0 && (
                  <div className="px-6 py-12 text-center text-sm text-[#787670] italic">
                    No tools match the filters.
                  </div>
                )}
              </div>
            </div>

            {/* Sticky Bottom Actions Bar */}
            <div className="sticky bottom-4 z-20 bg-[#E3E1DC] border border-[#D0CECA] rounded-xl p-4 flex justify-end gap-3 shadow-lg">
              <Button 
                onClick={() => setView("detail")} 
                variant="outline" 
                className="bg-white border-[#D0CECA] text-xs font-semibold px-4 h-10 text-[#111827]"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleSaveUpdate}
                className="bg-[#111827] text-white hover:bg-black text-xs font-semibold px-5 h-10"
              >
                Save Changes
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Creation Modal / Dialog */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-white rounded-xl border border-[#D0CECA] max-w-md w-full p-6 space-y-4 shadow-xl m-4">
            <div className="flex justify-between items-start">
              <h3 className="text-lg font-bold text-[#111827]">Create New Toolset</h3>
              <button 
                onClick={() => setIsCreateOpen(false)}
                className="p-1 hover:bg-[#EAE8E3] rounded-lg transition"
              >
                <X className="size-4 text-[#787670]" />
              </button>
            </div>

            <div className="space-y-4">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-[#55534E]">Toolset Name / ID</span>
                <Input 
                  value={newName} 
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Stripe Charges"
                  className="bg-white border-[#D0CECA] focus-visible:ring-1 focus-visible:ring-[#111827]"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-[#55534E]">Description</span>
                <textarea 
                  value={newDesc} 
                  onChange={(e) => setNewDesc(e.target.value)}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-[#D0CECA] bg-white px-3 py-2 text-sm text-[#111827] outline-none focus:border-[#111827]"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-[#55534E]">Source Schema</span>
                {Object.keys(sources).length === 0 ? (
                  <div className="text-xs text-red-600 bg-red-50 border border-red-200 p-2.5 rounded-lg">
                    No active API sources found. Please upload a schema first under the "Your APIs" page.
                  </div>
                ) : (
                  <div className="relative">
                    <select
                      value={newSource}
                      onChange={(e) => setNewSource(e.target.value)}
                      className="w-full appearance-none rounded-lg border border-[#D0CECA] bg-white px-3 py-2.5 text-sm text-[#111827] outline-none font-medium pr-10 cursor-pointer"
                    >
                      {Object.keys(sources).map((src) => (
                        <option key={src} value={src}>
                          {src} ({sources[src].total_tools} tools)
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-3.5 size-4 text-[#787670] pointer-events-none" />
                  </div>
                )}
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#D0CECA]">
              <Button 
                onClick={() => setIsCreateOpen(false)} 
                variant="outline" 
                size="sm"
                className="border-[#D0CECA]"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleCreateToolset}
                disabled={!newName.trim() || Object.keys(sources).length === 0}
                size="sm"
                className="bg-[#111827] text-white hover:bg-black"
              >
                Create
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
