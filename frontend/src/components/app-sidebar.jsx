import {
  SlidersHorizontal,
  FolderOpen,
  Wrench,
  FileCode,
  Globe,
  Bot,
  Layers,
  Code,
  Network,
  GitBranch,
  ChevronsUpDown,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const createItems = [
  { id: "tools", title: "Toolsets", icon: SlidersHorizontal },
  { id: "ingest", title: "Your APIs", icon: FolderOpen },
  { id: "custom-tools", title: "Custom Tools", icon: Wrench },
  { id: "prompts", title: "Prompts", icon: FileCode },
  { id: "environments", title: "Environments", icon: Globe },
]

const consumeItems = [
  { id: "workflows", title: "Workflow Proxy", icon: GitBranch },
  { id: "playground", title: "Playground", icon: Bot },
  { id: "dag", title: "DAG Viewer", icon: Network },
  { id: "mcp", title: "MCP", icon: Layers },
  { id: "sdks", title: "SDKs", icon: Code },
]

export function AppSidebar({ activePage, onPageChange }) {
  return (
    <Sidebar collapsible="icon" className="border-r border-[#D0CECA] bg-[#E3E1DC]">
      <SidebarHeader className="px-6 pb-2 pt-6">
        <div className="flex items-baseline gap-1.5 overflow-hidden">
          <span className="font-serif text-[26px] font-bold tracking-tight text-[#111827]">Dell</span>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-5 px-3 py-4">
        {/* CREATE SECTION */}
        <div className="space-y-1">
          <span className="px-3 text-[10px] font-bold uppercase tracking-wider text-[#787670]">Create</span>
          <SidebarMenu className="mt-1">
            {createItems.map((item) => {
              const isActive = activePage === item.id || (item.id === "tools" && activePage === "tools")
              return (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={isActive}
                    tooltip={item.title}
                    onClick={() => !item.disabled && onPageChange(item.id)}
                    className={`rounded-lg text-[#55534E] font-medium transition-all duration-150 hover:bg-[#D4D2CD] hover:text-[#111827] data-active:bg-[#D4D2CD] data-active:text-[#111827] data-active:shadow-none ${item.disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
                      }`}
                  >
                    <item.icon className="size-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </div>

        {/* CONSUME SECTION */}
        <div className="space-y-1">
          <span className="px-3 text-[10px] font-bold uppercase tracking-wider text-[#787670]">Consume</span>
          <SidebarMenu className="mt-1">
            {consumeItems.map((item) => {
              const isActive = activePage === item.id
              return (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={isActive}
                    tooltip={item.title}
                    onClick={() => !item.disabled && onPageChange(item.id)}
                    className={`rounded-lg text-[#55534E] font-medium transition-all duration-150 hover:bg-[#D4D2CD] hover:text-[#111827] data-active:bg-[#D4D2CD] data-active:text-[#111827] data-active:shadow-none ${item.disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
                      }`}
                  >
                    <item.icon className="size-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </div>
      </SidebarContent>

      <SidebarFooter className="p-3 border-t border-[#D0CECA] bg-[#E3E1DC]">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-[#D4D2CD] cursor-pointer transition-all duration-150 group">
          <div className="size-8 rounded-lg bg-gradient-to-tr from-purple-500 via-pink-500 to-orange-400 shrink-0 shadow-sm transition-transform duration-200 group-hover:scale-105" />
          <div className="flex-1 min-w-0 leading-tight">
            <p className="text-xs font-semibold text-[#111827] truncate">georges</p>
            <p className="text-[10px] text-[#787670] truncate">speakeasy-team</p>
          </div>
          <ChevronsUpDown className="size-3.5 text-[#787670] shrink-0" />
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

