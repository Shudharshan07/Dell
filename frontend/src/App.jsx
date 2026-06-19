import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { DagViewer } from "@/components/dag-viewer"

export default function App() {
  return (
    <div className="dark min-h-screen bg-neutral-950 text-white antialiased">
      <SidebarProvider>
        <AppSidebar />
        <main className="flex flex-1 flex-col overflow-hidden">
          <header className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2.5">
            <SidebarTrigger className="text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-md" />
          </header>
          <div className="flex-1 overflow-hidden">
            <DagViewer />
          </div>
        </main>
      </SidebarProvider>
    </div>
  )
}
