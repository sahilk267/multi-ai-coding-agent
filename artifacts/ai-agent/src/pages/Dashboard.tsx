import { useGetStats, useListProjects, useListSessions } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  FolderGit2, 
  Activity, 
  CheckCircle2, 
  XCircle, 
  FileCode2, 
  Terminal,
  Play,
  ArrowRight,
  ChevronRight
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetStats();
  const { data: projects, isLoading: projectsLoading } = useListProjects();
  const { data: sessions, isLoading: sessionsLoading } = useListSessions();

  const activeSessions = sessions?.filter(s => s.status === 'running' || s.status === 'planning') || [];
  const recentSessions = sessions?.slice(0, 5) || [];
  const recentProjects = projects?.slice(0, 5) || [];

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-mono tracking-tight">System Overview</h1>
          <p className="text-muted-foreground text-sm mt-1">Autonomous coding agent status and metrics.</p>
        </div>
        <Link href="/sessions/new">
          <Button className="font-mono">
            <Play className="h-4 w-4 mr-2" />
            New Session
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          title="Total Projects" 
          value={stats?.totalProjects} 
          icon={FolderGit2} 
          loading={statsLoading} 
        />
        <StatCard 
          title="Active Sessions" 
          value={activeSessions.length} 
          icon={Activity} 
          loading={sessionsLoading} 
          valueColor={activeSessions.length > 0 ? "text-primary" : undefined}
        />
        <StatCard 
          title="Files Modified" 
          value={stats?.totalFilesModified} 
          icon={FileCode2} 
          loading={statsLoading} 
        />
        <StatCard 
          title="Commands Run" 
          value={stats?.totalCommandsRun} 
          icon={Terminal} 
          loading={statsLoading} 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-mono font-medium">Recent Sessions</CardTitle>
              <CardDescription>Latest agent activity</CardDescription>
            </div>
            <Link href="/sessions">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {sessionsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : recentSessions.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm font-mono border border-dashed border-border rounded-md">
                No sessions found
              </div>
            ) : (
              <div className="space-y-3">
                {recentSessions.map(session => (
                  <Link key={session.id} href={`/sessions/${session.id}`}>
                    <div className="flex items-center justify-between p-3 rounded-md border border-border/50 bg-secondary/30 hover:bg-secondary/80 transition-colors cursor-pointer group">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <StatusIcon status={session.status} />
                        <div className="truncate">
                          <div className="text-sm font-medium truncate">{session.goal}</div>
                          <div className="text-xs text-muted-foreground font-mono flex items-center gap-2 mt-0.5">
                            <span>{session.aiModel}</span>
                            <span>•</span>
                            <span>{formatDistanceToNow(new Date(session.createdAt), { addSuffix: true })}</span>
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-mono font-medium">Recent Projects</CardTitle>
              <CardDescription>Recently modified workspaces</CardDescription>
            </div>
            <Link href="/projects">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {projectsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : recentProjects.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm font-mono border border-dashed border-border rounded-md">
                No projects found
              </div>
            ) : (
              <div className="space-y-3">
                {recentProjects.map(project => (
                  <Link key={project.id} href={`/projects/${project.id}`}>
                    <div className="flex items-center justify-between p-3 rounded-md border border-border/50 bg-secondary/30 hover:bg-secondary/80 transition-colors cursor-pointer group">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="p-1.5 bg-background rounded border border-border">
                          <FolderGit2 className="h-4 w-4 text-primary" />
                        </div>
                        <div className="truncate">
                          <div className="text-sm font-medium font-mono truncate">{project.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{project.path}</div>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, loading, valueColor = "" }: any) {
  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur">
      <CardContent className="p-6">
        <div className="flex items-center justify-between space-y-0 pb-2">
          <p className="text-sm font-medium font-mono text-muted-foreground">{title}</p>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        {loading ? (
          <Skeleton className="h-8 w-16 mt-2" />
        ) : (
          <div className={`text-3xl font-bold font-mono tracking-tight mt-2 ${valueColor}`}>
            {value ?? 0}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed': return <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />;
    case 'failed': return <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />;
    case 'running': 
    case 'planning': return <Activity className="h-4 w-4 text-primary flex-shrink-0 animate-pulse" />;
    default: return <div className="h-4 w-4 rounded-full border-2 border-muted-foreground flex-shrink-0" />;
  }
}
