import { useState } from "react";
import { Link } from "wouter";
import {
  useListSessions,
  useCreateSession,
  useListProjects,
  getListSessionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Activity,
  Plus,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  Pause,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const STATUS_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  idle: { label: "Idle", icon: Clock, color: "text-muted-foreground border-muted-foreground/30 bg-muted/20" },
  planning: { label: "Planning", icon: Activity, color: "text-blue-400 border-blue-500/30 bg-blue-500/10" },
  running: { label: "Running", icon: Activity, color: "text-primary border-primary/30 bg-primary/10" },
  paused: { label: "Paused", icon: Pause, color: "text-yellow-400 border-yellow-500/30 bg-yellow-500/10" },
  completed: { label: "Completed", icon: CheckCircle2, color: "text-green-400 border-green-500/30 bg-green-500/10" },
  failed: { label: "Failed", icon: XCircle, color: "text-red-400 border-red-500/30 bg-red-500/10" },
};

const AI_MODELS = ["auto", "chatgpt", "deepseek", "qwen", "gemini"];

export function Sessions() {
  const queryClient = useQueryClient();
  const { data: sessions, isLoading } = useListSessions();
  const { data: projects } = useListProjects();
  const createSession = useCreateSession();

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [form, setForm] = useState({ goal: "", aiModel: "auto", projectId: "" });

  const filtered = sessions?.filter(s => filter === "all" || s.status === filter) || [];

  function handleCreate() {
    if (!form.goal) return;
    createSession.mutate(
      {
        data: {
          goal: form.goal,
          aiModel: form.aiModel as "chatgpt" | "deepseek" | "qwen" | "gemini" | "auto",
          projectId: form.projectId ? parseInt(form.projectId) : null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
          setOpen(false);
          setForm({ goal: "", aiModel: "auto", projectId: "" });
        },
      }
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-mono tracking-tight">Sessions</h1>
          <p className="text-muted-foreground text-sm mt-1">Agent execution history and active runs.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="font-mono">
              <Plus className="h-4 w-4 mr-2" />
              New Session
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle className="font-mono">Create Session</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-mono text-muted-foreground">Goal</Label>
                <Input
                  placeholder="What should the agent do?"
                  value={form.goal}
                  onChange={e => setForm(f => ({ ...f, goal: e.target.value }))}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-mono text-muted-foreground">AI Model</Label>
                <Select value={form.aiModel} onValueChange={v => setForm(f => ({ ...f, aiModel: v }))}>
                  <SelectTrigger className="font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AI_MODELS.map(m => (
                      <SelectItem key={m} value={m} className="font-mono">{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-mono text-muted-foreground">Project (optional)</Label>
                <Select value={form.projectId || "__none__"} onValueChange={v => setForm(f => ({ ...f, projectId: v === "__none__" ? "" : v }))}>
                  <SelectTrigger className="font-mono">
                    <SelectValue placeholder="No project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" className="font-mono">No project</SelectItem>
                    {projects?.map(p => (
                      <SelectItem key={p.id} value={String(p.id)} className="font-mono">{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="w-full font-mono"
                onClick={handleCreate}
                disabled={!form.goal || createSession.isPending}
              >
                {createSession.isPending ? "Creating..." : "Create Session"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-2 flex-wrap">
        {["all", "running", "planning", "paused", "completed", "failed", "idle"].map(s => (
          <Button
            key={s}
            variant={filter === s ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs font-mono"
            onClick={() => setFilter(s)}
          >
            {s}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed border-border bg-card/50">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Activity className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground font-mono text-sm">No sessions found.</p>
            <Button className="mt-6 font-mono" size="sm" onClick={() => setOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New Session
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map(session => {
            const cfg = STATUS_CONFIG[session.status] || STATUS_CONFIG.idle;
            const StatusIcon = cfg.icon;
            return (
              <Link key={session.id} href={`/sessions/${session.id}`}>
                <Card className="border-border/50 bg-card/50 hover:bg-card transition-colors cursor-pointer group">
                  <CardContent className="p-4 flex items-center gap-4">
                    <StatusIcon className={`h-4 w-4 flex-shrink-0 ${cfg.color.split(" ")[0]} ${(session.status === "running" || session.status === "planning") ? "animate-pulse" : ""}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-medium truncate">{session.goal}</span>
                        <Badge variant="outline" className={`text-[10px] font-mono px-1.5 py-0 ${cfg.color}`}>
                          {cfg.label}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 border-muted-foreground/20">
                          {session.aiModel}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground font-mono mt-0.5 flex items-center gap-2">
                        <span>#{session.id}</span>
                        {session.currentStep !== null && session.totalSteps !== null && (
                          <>
                            <span>•</span>
                            <span>Step {session.currentStep}/{session.totalSteps}</span>
                          </>
                        )}
                        {session.errorCount > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-red-400">{session.errorCount} errors</span>
                          </>
                        )}
                        <span>•</span>
                        <span>{formatDistanceToNow(new Date(session.createdAt), { addSuffix: true })}</span>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
