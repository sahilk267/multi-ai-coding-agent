import { useEffect, useRef } from "react";
import { useParams, Link } from "wouter";
import {
  useGetSession,
  useGetSessionLogs,
  useGetSessionPlan,
  useUpdateSession,
  getGetSessionQueryKey,
  getGetSessionLogsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity,
  ArrowLeft,
  Play,
  Pause,
  Square,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";

const LOG_COLORS: Record<string, string> = {
  info: "text-blue-400",
  success: "text-green-400",
  warn: "text-yellow-400",
  error: "text-red-400",
  debug: "text-muted-foreground/60",
};

const STATUS_BADGES: Record<string, string> = {
  idle: "text-muted-foreground border-muted-foreground/30 bg-muted/20",
  planning: "text-blue-400 border-blue-500/30 bg-blue-500/10",
  running: "text-primary border-primary/30 bg-primary/10",
  paused: "text-yellow-400 border-yellow-500/30 bg-yellow-500/10",
  completed: "text-green-400 border-green-500/30 bg-green-500/10",
  failed: "text-red-400 border-red-500/30 bg-red-500/10",
};

const STEP_STATUS_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  pending: Clock,
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
};

export function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const sessionId = parseInt(id, 10);
  const queryClient = useQueryClient();
  const logsEndRef = useRef<HTMLDivElement>(null);

  const { data: session, isLoading } = useGetSession(sessionId);
  const { data: logs } = useGetSessionLogs(sessionId, {
    query: { queryKey: getGetSessionLogsQueryKey(sessionId), refetchInterval: 3000 },
  });
  const { data: plan } = useGetSessionPlan(sessionId);
  const updateSession = useUpdateSession();

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  function updateStatus(status: "running" | "paused" | "completed" | "failed") {
    updateSession.mutate(
      { id: sessionId, data: { status } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });
        },
      }
    );
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground font-mono">Session not found.</p>
        <Link href="/sessions">
          <Button variant="ghost" size="sm" className="mt-4 font-mono">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Sessions
          </Button>
        </Link>
      </div>
    );
  }

  const isActive = session.status === "running" || session.status === "planning";

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="h-12 border-b border-border px-6 flex items-center justify-between bg-card/50">
        <div className="flex items-center gap-3">
          <Link href="/sessions">
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
          </Link>
          <Activity className="h-4 w-4 text-primary" />
          <span className="font-mono font-semibold text-sm truncate max-w-xs">{session.goal}</span>
          <Badge variant="outline" className={`text-[10px] font-mono px-1.5 py-0 ${STATUS_BADGES[session.status]}`}>
            {session.status}
          </Badge>
          <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 border-muted-foreground/20">
            {session.aiModel}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {session.status === "idle" || session.status === "paused" ? (
            <Button size="sm" className="h-7 text-xs font-mono" onClick={() => updateStatus("running")}>
              <Play className="h-3 w-3 mr-1" />
              Start
            </Button>
          ) : null}
          {isActive && (
            <Button variant="outline" size="sm" className="h-7 text-xs font-mono" onClick={() => updateStatus("paused")}>
              <Pause className="h-3 w-3 mr-1" />
              Pause
            </Button>
          )}
          {session.status !== "completed" && session.status !== "failed" && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs font-mono text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={() => updateStatus("failed")}
            >
              <Square className="h-3 w-3 mr-1" />
              Stop
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="w-72 border-r border-border flex flex-col bg-card/20">
          <div className="h-9 border-b border-border px-4 flex items-center">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Plan</span>
          </div>
          <ScrollArea className="flex-1">
            {!plan || plan.tasks.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground font-mono">No plan generated yet.</div>
            ) : (
              <div className="p-3 space-y-3">
                {plan.tasks.map((task: any, ti: number) => (
                  <div key={ti} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-medium">{task.name}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[9px] font-mono px-1 py-0",
                          task.status === "completed" ? "text-green-400 border-green-500/30" :
                          task.status === "failed" ? "text-red-400 border-red-500/30" :
                          task.status === "running" ? "text-primary border-primary/30" :
                          "text-muted-foreground border-muted-foreground/20"
                        )}
                      >
                        {task.status}
                      </Badge>
                    </div>
                    {task.steps?.map((step: any, si: number) => {
                      const StepIcon = STEP_STATUS_ICON[step.status] || Clock;
                      return (
                        <div key={si} className="flex items-start gap-2 pl-3">
                          <StepIcon className={cn(
                            "h-3 w-3 mt-0.5 flex-shrink-0",
                            step.status === "completed" ? "text-green-400" :
                            step.status === "failed" ? "text-red-400" :
                            step.status === "running" ? "text-primary animate-spin" :
                            "text-muted-foreground/50"
                          )} />
                          <div>
                            <div className="text-[10px] font-mono">{step.action}</div>
                            {step.path && (
                              <div className="text-[9px] text-muted-foreground font-mono truncate">{step.path}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          <div className="border-t border-border p-4 space-y-2 text-xs font-mono">
            <div className="flex justify-between text-muted-foreground">
              <span>Session ID</span>
              <span>#{session.id}</span>
            </div>
            {session.currentStep !== null && session.totalSteps !== null && (
              <div className="flex justify-between text-muted-foreground">
                <span>Progress</span>
                <span>{session.currentStep}/{session.totalSteps}</span>
              </div>
            )}
            <div className="flex justify-between text-muted-foreground">
              <span>Errors</span>
              <span className={session.errorCount > 0 ? "text-red-400" : ""}>{session.errorCount}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Created</span>
              <span>{formatDistanceToNow(new Date(session.createdAt), { addSuffix: true })}</span>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <div className="h-9 border-b border-border px-4 flex items-center">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Execution Logs</span>
          </div>
          <ScrollArea className="flex-1 bg-background/50">
            <div className="p-4 space-y-1 font-mono text-xs">
              {!logs || logs.length === 0 ? (
                <div className="text-muted-foreground/50">No logs yet.</div>
              ) : (
                logs.map(log => (
                  <div key={log.id} className="flex gap-3">
                    <span className="text-muted-foreground/40 flex-shrink-0 text-[10px] pt-0.5">
                      {format(new Date(log.createdAt), "HH:mm:ss")}
                    </span>
                    <span className={cn("flex-shrink-0 uppercase text-[10px] pt-0.5 w-12", LOG_COLORS[log.level])}>
                      [{log.level}]
                    </span>
                    <span className="text-foreground/80 break-all">{log.message}</span>
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
