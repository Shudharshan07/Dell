import { Bot, ChevronDown, FileUp, Network, Settings, SlidersHorizontal, Workflow } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const items = [
  { id: "ingest", title: "Ingestion", icon: FileUp },
  { id: "tools", title: "Toolsets", icon: SlidersHorizontal },
  { id: "playground", title: "Playground", icon: Bot },
  { id: "dag", title: "DAG Viewer", icon: Network },
]

export function AppSidebar({ activePage, onPageChange }) {
  return (
    <Sidebar collapsible="icon" className="border-r border-[#E5E7EB] bg-[#F7F7F7]">
      <SidebarHeader className="px-3 pb-3 pt-4">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#111827]">
            <Workflow className="size-4 text-white" />
          </div>
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="whitespace-nowrap text-sm font-semibold text-[#111827]">Dell Project Workspace</span>
            <span className="text-xs text-[#6B7280]">Enterprise MCP</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-1 px-2 py-3">
        <SidebarGroup>
          <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden">
            <span className="flex w-full items-center justify-between text-[11px] uppercase tracking-wide text-[#9CA3AF]">
              Workspace
              <ChevronDown className="size-3" />
            </span>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={activePage === item.id}
                    tooltip={item.title}
                    onClick={() => onPageChange(item.id)}
                    className="rounded-lg text-[#6B7280] transition duration-200 hover:bg-[#EDEFF2] hover:text-[#111827] data-active:bg-[#EDEFF2] data-active:text-[#111827] data-active:shadow-none"
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden">
            <span className="text-[11px] uppercase tracking-wide text-[#9CA3AF]">Admin</span>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Settings" className="rounded-lg text-[#6B7280] transition duration-200 hover:bg-[#EDEFF2] hover:text-[#111827]">
                  <Settings />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
