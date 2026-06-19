import { Home, Network, Settings, BarChart2, FileCode2 } from "lucide-react"
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
  { title: "Dashboard", url: "#", icon: Home },
  { title: "DAG Viewer", url: "#", icon: Network, active: true },
  { title: "Analytics", url: "#", icon: BarChart2 },
  { title: "Specs", url: "#", icon: FileCode2 },
  { title: "Settings", url: "#", icon: Settings },
]

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 pt-4 pb-3">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="flex size-8 items-center justify-center rounded-lg bg-violet-600 shrink-0">
            <Network className="size-4 text-white" />
          </div>
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold text-sidebar-foreground whitespace-nowrap">DAG Proxy</span>
            <span className="text-xs text-sidebar-foreground/50">Visualizer</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden">Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={item.active}>
                    <a href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
