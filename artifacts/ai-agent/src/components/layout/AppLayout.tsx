import { Link, useLocation } from "wouter";
import { 
  TerminalSquare, 
  FolderGit2, 
  Activity, 
  BrainCircuit,
  Radio,
  GitFork,
  ChevronRight
} from "lucide-react";
import { useHealthCheck } from "@workspace/api-client-react";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  
  const { data: health } = useHealthCheck();
  const isHealthy = health?.status === "ok";

  const navItems = [
    { href: "/", label: "Overview", icon: TerminalSquare },
    { href: "/pipeline", label: "Pipeline", icon: GitFork },
    { href: "/projects", label: "Projects", icon: FolderGit2 },
    { href: "/sessions", label: "Sessions", icon: Activity },
    { href: "/memory", label: "Memory", icon: BrainCircuit },
    { href: "/agent", label: "Agent Live", icon: Radio },
  ];

  return (
    <div className="flex h-[100dvh] w-full bg-background overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-card flex flex-col">
        <div className="h-14 flex items-center px-4 border-b border-border">
          <div className="flex items-center gap-2 text-primary font-mono font-bold tracking-tight">
            <TerminalSquare className="h-5 w-5" />
            <span>AGENT_OS</span>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          <div className="text-xs font-mono text-muted-foreground mb-4 mt-2 px-2 uppercase tracking-wider">
            System Nav
          </div>
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href}>
                <div 
                  className={`flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors ${
                    isActive 
                      ? "bg-primary/10 text-primary" 
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                  {isActive && <ChevronRight className="h-4 w-4 ml-auto opacity-50" />}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border bg-card/50">
          <div className="flex items-center gap-3">
            <div className={`h-2.5 w-2.5 rounded-full ${isHealthy ? 'bg-green-500' : 'bg-red-500'} shadow-[0_0_8px_rgba(0,0,0,0.5)] ${isHealthy ? 'shadow-green-500/50' : 'shadow-red-500/50'}`} />
            <div className="flex flex-col">
              <span className="text-xs font-mono text-foreground">API Status</span>
              <span className="text-[10px] font-mono text-muted-foreground">
                {isHealthy ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
