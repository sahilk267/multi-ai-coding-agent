import { useState, useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bot, Brain, Code2, Eye, FlaskConical, GitFork,
  Play, Square, RefreshCw, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, Clock, Loader2, AlertTriangle,
  ArrowRight, Cpu, Zap, Wifi, WifiOff,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentInfo {
  id: number;
  role: string;
  status: string;
  aiModel: string;
  currentTask: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface AgentTask {
  id: number;
  title: string;
  description: string;
  assignedTo: string;
  status: string;
  priority: number;
  result: string | null;
  errorMessage: string | null;
  taskIndex: number;
}

interface AgentMessage {
  id: number;
  fromAgent: string;
  toAgent: string;
  messageType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface PipelineSession {
  id: number;
  goal: string;
  status: string;
}

interface PipelineStatus {
  session: PipelineSession;
  agents: AgentInfo[];
  tasks: AgentTask[];
  messages: AgentMessage[];
}

interface ProviderStatus {
  active_provider: string;
  ollama?: {
    available: boolean;
    host: string;
    model: string;
  };
  cloud?: Record<string, boolean>;
  fallback_mode?: boolean;
}

interface WsAgentMessage {
  type: string;
  payload: Record<string, unknown>;
}

interface LiveLogEntry {
  agent: string;
  level: string;
  message: string;
  timestamp: number;
  type: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLE_META: Record<string, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  model: string;
  desc: string;
}> = {
  orchestrator: { label: "Orchestrator", icon: GitFork,      color: "text-purple-400 border-purple-500/30 bg-purple-500/10", model: "Controller", desc: "Manages the full pipeline" },
  planner:      { label: "Planner",      icon: Brain,        color: "text-blue-400   border-blue-500/30   bg-blue-500/10",   model: "ChatGPT",    desc: "Decomposes goals into tasks" },
  researcher:   { label: "Researcher",   icon: Cpu,          color: "text-cyan-400   border-cyan-500/30   bg-cyan-500/10",   model: "Gemini",     desc: "Indexes codebase & gathers context" },
  coder:        { label: "Coder",        icon: Code2,        color: "text-green-400  border-green-500/30  bg-green-500/10",  model: "DeepSeek",   desc: "Writes & modifies code" },
  reviewer:     { label: "Reviewer",     icon: Eye,          color: "text-amber-400  border-amber-500/30  bg-amber-500/10",  model: "ChatGPT",    desc: "Audits quality & security" },
  tester:       { label: "Tester",       icon: FlaskConical, color: "text-rose-400   border-rose-500/30   bg-rose-500/10",   model: "Qwen",       desc: "Runs tests & validates output" },
};

const STATUS_STYLE: Record<string, string> = {
  idle:      "text-zinc-400",
  running:   "text-green-400 animate-pulse",
  waiting:   "text-amber-400",
  completed: "text-emerald-400",
  failed:    "text-red-400",
  pending:   "text-zinc-500",
};

const PIPELINE_STEPS = ["orchestrator", "planner", "researcher", "coder", "reviewer", "tester"];

// Determine the WebSocket URL — use the Vite proxy in dev so it works in Replit preview
function getPythonWsUrl(): string {
  const loc = window.location;
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/python-ws`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const color: Record<string, string> = {
    idle:      "bg-zinc-500",
    running:   "bg-green-400",
    waiting:   "bg-amber-400",
    completed: "bg-emerald-400",
    failed:    "bg-red-400",
    pending:   "bg-zinc-600",
  };
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full shrink-0 ${color[status] ?? "bg-zinc-500"} ${
        status === "running" ? "animate-pulse" : ""
      }`}
    />
  );
}

function ProviderStatusCard({
  provider,
}: {
  provider: ProviderStatus | null;
}) {
  const active = provider?.active_provider ?? "unknown";
  const isFallback = Boolean(provider?.fallback_mode) || active.includes("fallback");
  const isOllama = active.startsWith("ollama/");
  const cloud = provider?.cloud ?? {};
  const cloudActive = Object.entries(cloud).filter(([, enabled]) => enabled).map(([k]) => k);

  return (
    <Card className="border-border/60 bg-card/40 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Cpu className="h-4 w-4 text-primary" />
        <span className="text-xs font-mono font-semibold uppercase tracking-wider">
          LLM Backend
        </span>
        <Badge
          variant="outline"
          className={`ml-auto text-[10px] font-mono ${
            isFallback ? "border-amber-500/40 text-amber-400" : isOllama ? "border-cyan-500/40 text-cyan-400" : "border-emerald-500/40 text-emerald-400"
          }`}
        >
          {active}
        </Badge>
      </div>

      <div className="grid gap-2 text-[10px] font-mono text-muted-foreground">
        <div className="flex items-center justify-between gap-3">
          <span>Mode</span>
          <span className={isFallback ? "text-amber-400" : isOllama ? "text-cyan-400" : "text-emerald-400"}>
            {isFallback ? "fallback" : isOllama ? "ollama" : "cloud"}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span>Ollama</span>
          <span className={provider?.ollama?.available ? "text-cyan-400" : "text-zinc-500"}>
            {provider?.ollama?.available ? `${provider.ollama.model}` : "offline"}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span>Cloud</span>
          <span className={cloudActive.length ? "text-emerald-400" : "text-zinc-500"}>
            {cloudActive.length ? cloudActive.join(", ") : "none"}
          </span>
        </div>
      </div>
    </Card>
  );
}

function AgentCard({
  role,
  agent,
  isActive,
}: {
  role: string;
  agent?: AgentInfo;
  isActive: boolean;
}) {
  const meta = ROLE_META[role];
  const Icon = meta.icon;
  const status = agent?.status ?? "idle";

  return (
    <div
      className={`relative flex flex-col gap-2 p-4 rounded-xl border transition-all duration-300 ${
        isActive
          ? `${meta.color} shadow-lg`
          : "border-border/40 bg-card/30 text-muted-foreground"
      }`}
    >
      {isActive && (
        <div className="absolute inset-0 rounded-xl pointer-events-none ring-1 ring-inset ring-white/5" />
      )}
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 shrink-0 ${isActive ? "" : "opacity-40"}`} />
        <span className="text-xs font-mono font-semibold uppercase tracking-wider">
          {meta.label}
        </span>
        <StatusDot status={status} />
        <span className={`ml-auto text-[10px] font-mono ${STATUS_STYLE[status] ?? ""}`}>
          {status}
        </span>
      </div>
      <p className="text-[10px] text-muted-foreground leading-relaxed">{meta.desc}</p>
      <div className="flex items-center gap-1.5 mt-1">
        <Zap className="h-2.5 w-2.5 text-muted-foreground" />
        <span className="text-[10px] font-mono text-muted-foreground">{meta.model}</span>
      </div>
      {agent?.currentTask && (
        <p className="text-[10px] font-mono text-foreground/80 truncate mt-1 border-t border-border/30 pt-1.5">
          ↳ {agent.currentTask}
        </p>
      )}
    </div>
  );
}

function TaskRow({ task }: { task: AgentTask }) {
  const [open, setOpen] = useState(false);
  const meta = ROLE_META[task.assignedTo];
  const Icon = meta?.icon ?? Bot;

  const statusIcon: Record<string, React.ReactNode> = {
    pending:   <Clock className="h-3.5 w-3.5 text-zinc-500" />,
    running:   <Loader2 className="h-3.5 w-3.5 text-green-400 animate-spin" />,
    completed: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
    failed:    <XCircle className="h-3.5 w-3.5 text-red-400" />,
  };

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-secondary/30 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        {statusIcon[task.status] ?? <Clock className="h-3.5 w-3.5" />}
        <span className="text-xs font-mono font-medium flex-1 truncate">{task.title}</span>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`text-[10px] font-mono flex items-center gap-1 ${
              meta?.color ?? ""
            } px-1.5 py-0.5 rounded border`}
          >
            <Icon className="h-2.5 w-2.5" />
            {meta?.label ?? task.assignedTo}
          </span>
          {open ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
        </div>
      </button>
      {open && (
        <div className="px-4 pb-3 pt-1 bg-secondary/10 border-t border-border/30 space-y-2">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {task.description}
          </p>
          {task.result && (
            <div className="rounded bg-background/60 border border-border/40 p-2">
              <p className="text-[10px] font-mono text-muted-foreground mb-1">Result</p>
              <p className="text-[11px] font-mono text-foreground whitespace-pre-wrap">
                {task.result.slice(0, 600)}
              </p>
            </div>
          )}
          {task.errorMessage && (
            <div className="rounded bg-red-950/20 border border-red-900/30 p-2">
              <p className="text-[10px] font-mono text-red-400">{task.errorMessage}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ msg }: { msg: AgentMessage }) {
  const fromMeta = ROLE_META[msg.fromAgent];
  const toMeta = ROLE_META[msg.toAgent];
  const FromIcon = fromMeta?.icon ?? Bot;
  const ToIcon = toMeta?.icon ?? Bot;

  const typeStyle: Record<string, string> = {
    task_assign:     "border-blue-800/40 bg-blue-950/20",
    task_result:     "border-emerald-800/40 bg-emerald-950/20",
    task_failed:     "border-red-800/40 bg-red-950/20",
    review_result:   "border-amber-800/40 bg-amber-950/20",
    review_request:  "border-amber-700/30 bg-amber-950/10",
    test_result:     "border-rose-800/40 bg-rose-950/20",
    test_request:    "border-rose-700/30 bg-rose-950/10",
    research_result: "border-cyan-800/40 bg-cyan-950/20",
    status_update:   "border-zinc-800/40 bg-zinc-950/20",
  };

  return (
    <div
      className={`flex flex-wrap gap-2 p-3 rounded-lg border text-xs ${
        typeStyle[msg.messageType] ?? "border-border/40 bg-card/20"
      }`}
    >
      <div className="flex items-center gap-1.5 shrink-0">
        <span
          className={`font-mono font-semibold ${
            fromMeta?.color?.split(" ")[0] ?? "text-muted-foreground"
          }`}
        >
          <FromIcon className="inline h-3 w-3 mr-1" />
          {msg.fromAgent}
        </span>
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
        <span
          className={`font-mono font-semibold ${
            toMeta?.color?.split(" ")[0] ?? "text-muted-foreground"
          }`}
        >
          <ToIcon className="inline h-3 w-3 mr-1" />
          {msg.toAgent}
        </span>
      </div>
      <span className="text-muted-foreground">·</span>
      <span className="font-mono text-muted-foreground">{msg.messageType}</span>
      <span className="ml-auto text-[10px] text-zinc-600 shrink-0 font-mono">
        {new Date(msg.createdAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}
      </span>
    </div>
  );
}

function PipelineFlowDiagram({
  agents,
  activeRoles,
}: {
  agents: AgentInfo[];
  activeRoles: Set<string>;
}) {
  const agentMap = new Map(agents.map((a) => [a.role, a]));
  return (
    <div className="flex items-center gap-1 flex-wrap justify-center">
      {PIPELINE_STEPS.map((role, i) => {
        const agent = agentMap.get(role);
        const isActive = activeRoles.has(role) || agent?.status === "completed";
        const meta = ROLE_META[role];
        const Icon = meta.icon;
        return (
          <div key={role} className="flex items-center gap-1">
            <div
              className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg border transition-all ${
                isActive ? meta.color : "border-border/30 text-muted-foreground/40"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="text-[9px] font-mono uppercase tracking-wider">
                {meta.label}
              </span>
              {agent && <StatusDot status={agent.status} />}
            </div>
            {i < PIPELINE_STEPS.length - 1 && (
              <ArrowRight
                className={`h-3.5 w-3.5 shrink-0 ${
                  isActive ? "text-primary" : "text-muted-foreground/20"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Live feed hook ───────────────────────────────────────────────────────────

function useLiveFeed(sessionId: number | null, onUpdate: () => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const [liveMessages, setLiveMessages] = useState<LiveLogEntry[]>([]);
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    if (!sessionId) return;

    let reconnectTimer: ReturnType<typeof setTimeout>;
    let unmounted = false;

    function connect() {
      if (unmounted) return;
      const wsUrl = getPythonWsUrl();
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        reconnectTimer = setTimeout(connect, 5000);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => setWsConnected(true);

      ws.onmessage = (e) => {
        try {
          const msg: WsAgentMessage = JSON.parse(e.data);
          const isRelevant = [
            "agent_log", "agent_status", "agent_message",
            "pipeline_state", "pipeline_update",
          ].includes(msg.type);
          if (!isRelevant) return;

          const p = msg.payload ?? {};
          setLiveMessages((prev) =>
            [
              {
                agent: (p.agent as string) ?? msg.type,
                level: (p.level as string) ?? "info",
                message:
                  (p.message as string) ??
                  (msg.type === "pipeline_state"
                    ? `State → ${p.state}`
                    : JSON.stringify(p).slice(0, 140)),
                timestamp: Date.now(),
                type: msg.type,
              },
              ...prev,
            ].slice(0, 300)
          );

          if (["pipeline_update", "agent_status", "pipeline_state"].includes(msg.type)) {
            onUpdate();
          }
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!unmounted) reconnectTimer = setTimeout(connect, 4000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();
    return () => {
      unmounted = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [sessionId, onUpdate]);

  return { liveMessages, wsConnected };
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function Pipeline() {
  useQueryClient();
  const [goal, setGoal] = useState("");
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"tasks" | "messages" | "feed">("tasks");
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async (sid: number) => {
    try {
      const res = await fetch(`/api/pipeline/${sid}/status`);
      if (res.ok) {
        const data: PipelineStatus = await res.json();
        setStatus(data);
        // Stop polling when pipeline is in a terminal state
        const s = data.session.status;
        if (["completed", "failed", "paused"].includes(s) && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch { /* silent */ }
  }, []);

  const fetchProvider = useCallback(async () => {
    try {
      const res = await fetch("/python-api/provider/status");
      if (res.ok) {
        const data: ProviderStatus = await res.json();
        setProvider(data);
      }
    } catch { /* silent */ }
  }, []);

  const onWsUpdate = useCallback(() => {
    if (sessionId) fetchStatus(sessionId);
  }, [sessionId, fetchStatus]);

  const { liveMessages, wsConnected } = useLiveFeed(sessionId, () => {
    onWsUpdate();
    fetchProvider();
  });

  useEffect(() => {
    fetchProvider();
    if (sessionId) {
      fetchStatus(sessionId);
      pollRef.current = setInterval(() => fetchStatus(sessionId), 3000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [sessionId, fetchStatus, fetchProvider]);

  const activeRoles = new Set(
    (status?.agents ?? []).filter((a) => a.status === "running").map((a) => a.role)
  );
  const runningCount = (status?.agents ?? []).filter((a) => a.status === "running").length;
  const completedCount = (status?.agents ?? []).filter((a) => a.status === "completed").length;
  const failedCount = (status?.agents ?? []).filter((a) => a.status === "failed").length;
  const agentMap = new Map((status?.agents ?? []).map((a) => [a.role, a]));

  const isPipelineRunning = runningCount > 0 || loading;
  const sessionStatus = status?.session.status;
  const isDone = sessionStatus === "completed" || sessionStatus === "failed";

  const handleStart = async () => {
    if (!goal.trim()) return;
    setLoading(true);
    setError(null);
    setStatus(null);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    try {
      const res = await fetch("/api/pipeline/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: goal.trim() }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to start pipeline");
      }

      const data = await res.json();
      setSessionId(data.session.id);
      setStatus({
        session: data.session,
        agents: data.agents,
        tasks: data.tasks,
        messages: [],
      });
      setActiveTab("feed");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!sessionId) return;
    setCancelling(true);
    try {
      await fetch(`/api/pipeline/${sessionId}/cancel`, { method: "POST" });
      await fetchStatus(sessionId);
    } catch { /* silent */ } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-4 px-6 py-4 border-b border-border bg-card/50">
        <div>
          <h1 className="text-lg font-mono font-bold flex items-center gap-2">
            <GitFork className="h-5 w-5 text-primary" />
            Multi-Agent Pipeline
          </h1>
          <p className="text-xs font-mono text-muted-foreground mt-0.5">
            6 specialized agents · Planner → Researcher → Coder → Reviewer → Tester
          </p>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className="w-56 hidden xl:block">
            <ProviderStatusCard provider={provider} />
          </div>

          {/* WebSocket connection indicator */}
          <div
            className={`flex items-center gap-1.5 text-[10px] font-mono ${
              wsConnected ? "text-emerald-400" : "text-zinc-600"
            }`}
            title={wsConnected ? "Live stream connected" : "Connecting to live stream…"}
          >
            {wsConnected ? (
              <Wifi className="h-3 w-3" />
            ) : (
              <WifiOff className="h-3 w-3" />
            )}
            {wsConnected ? "live" : "offline"}
          </div>

          {status && (
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="text-emerald-400">{completedCount} done</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-amber-400">{runningCount} running</span>
              {failedCount > 0 && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-red-400">{failedCount} failed</span>
                </>
              )}
            </div>
          )}

          {/* Cancel button when pipeline is active */}
          {sessionId && isPipelineRunning && !isDone && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              disabled={cancelling}
              className="font-mono text-xs gap-1.5 border-red-900/50 text-red-400 hover:bg-red-950/30 hover:text-red-300"
            >
              {cancelling ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Square className="h-3 w-3" />
              )}
              {cancelling ? "Cancelling…" : "Cancel"}
            </Button>
          )}

          {/* Refresh button */}
          {sessionId && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchStatus(sessionId)}
              className="font-mono text-xs gap-1.5 text-muted-foreground"
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left column */}
        <div className="flex flex-col w-80 shrink-0 border-r border-border overflow-hidden">
          {/* Goal input */}
          <div className="shrink-0 p-4 border-b border-border space-y-3">
            <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Goal
            </label>
            <Textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Describe what you want the agent team to build or fix…"
              className="font-mono text-sm resize-none h-24 bg-secondary/30 border-border/60 focus:border-primary"
              disabled={isPipelineRunning}
            />
            <Button
              onClick={handleStart}
              disabled={loading || !goal.trim() || isPipelineRunning}
              className="w-full font-mono text-xs gap-2"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {loading ? "Launching pipeline…" : "Launch Pipeline"}
            </Button>
            {error && (
              <div className="flex items-start gap-2 p-2 rounded bg-red-950/30 border border-red-900/40 text-red-400">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <p className="text-[11px] font-mono">{error}</p>
              </div>
            )}
          </div>

          {/* Pipeline flow diagram */}
          <div className="shrink-0 p-4 border-b border-border">
            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-3">
              Pipeline Flow
            </p>
            <PipelineFlowDiagram
              agents={status?.agents ?? []}
              activeRoles={activeRoles}
            />
          </div>

          {/* Agent cards */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">
              Agents
            </p>
            {PIPELINE_STEPS.map((role) => (
              <AgentCard
                key={role}
                role={role}
                agent={agentMap.get(role)}
                isActive={
                  activeRoles.has(role) || agentMap.get(role)?.status === "completed"
                }
              />
            ))}
          </div>
        </div>

        {/* Right column */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Session info bar */}
          {status && (
            <div className="shrink-0 px-5 py-3 border-b border-border flex items-center gap-3 bg-card/30">
              <Bot className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono font-semibold truncate">
                  {status.session.goal}
                </p>
                <p className="text-[10px] font-mono text-muted-foreground">
                  Session #{status.session.id} ·{" "}
                  <span
                    className={
                      status.session.status === "completed"
                        ? "text-emerald-400"
                        : status.session.status === "failed"
                        ? "text-red-400"
                        : status.session.status === "paused"
                        ? "text-amber-400"
                        : "text-blue-400"
                    }
                  >
                    {status.session.status}
                  </span>
                </p>
              </div>
              <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                {status.tasks.filter((t) => t.status === "completed").length}/
                {status.tasks.length} tasks
              </Badge>
            </div>
          )}

          {/* Tabs */}
          <div className="shrink-0 flex border-b border-border bg-card/20 px-4 pt-1">
            {(
              [
                { id: "tasks",    label: "Tasks",     count: status?.tasks.length },
                { id: "messages", label: "Messages",  count: status?.messages.length },
                { id: "feed",     label: "Live Feed", count: liveMessages.length },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-xs font-mono rounded-t-md transition-colors flex items-center gap-1.5 ${
                  activeTab === tab.id
                    ? "bg-background text-foreground border border-b-0 border-border"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
                {(tab.count ?? 0) > 0 && (
                  <span className="text-[10px] bg-secondary text-muted-foreground px-1.5 py-0.5 rounded-full">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab body */}
          <div className="flex-1 overflow-y-auto p-5">
            {/* Empty state */}
            {!status && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
                <GitFork className="h-12 w-12 opacity-10" />
                <div className="text-center">
                  <p className="text-sm font-mono font-semibold">No pipeline running</p>
                  <p className="text-xs mt-1">
                    Enter a goal and click "Launch Pipeline" to start the multi-agent system.
                  </p>
                </div>
                <div className="text-xs font-mono text-left space-y-1 opacity-60 max-w-sm">
                  <p>The pipeline runs 6 agents in sequence:</p>
                  <p>1. <span className="text-blue-400">Planner</span> — decomposes your goal into tasks</p>
                  <p>2. <span className="text-cyan-400">Researcher</span> — gathers codebase context</p>
                  <p>3. <span className="text-green-400">Coder</span> — writes the implementation</p>
                  <p>4. <span className="text-amber-400">Reviewer</span> — audits quality &amp; security</p>
                  <p>5. <span className="text-green-400">Coder</span> (retry) — fixes review issues</p>
                  <p>6. <span className="text-rose-400">Tester</span> — validates with test suite</p>
                </div>
              </div>
            )}

            {/* Tasks tab */}
            {status && activeTab === "tasks" && (
              <div className="space-y-2">
                {status.tasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    No tasks yet — pipeline is initializing…
                  </p>
                ) : (
                  status.tasks.map((t) => <TaskRow key={t.id} task={t} />)
                )}
              </div>
            )}

            {/* Messages tab */}
            {status && activeTab === "messages" && (
              <div className="space-y-2">
                {status.messages.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    No inter-agent messages yet…
                  </p>
                ) : (
                  [...status.messages]
                    .reverse()
                    .map((m) => <MessageBubble key={m.id} msg={m} />)
                )}
              </div>
            )}

            {/* Live feed tab */}
            {activeTab === "feed" && (
              <div className="space-y-px font-mono text-[11px]">
                {!wsConnected && (
                  <div className="flex items-center gap-2 py-2 mb-3 text-zinc-500">
                    <WifiOff className="h-3 w-3" />
                    <span>
                      Connecting to Python backend live stream…
                      {sessionId
                        ? " (start the Python backend if not running)"
                        : " Launch a pipeline first."}
                    </span>
                  </div>
                )}
                {liveMessages.length === 0 && wsConnected && (
                  <p className="text-muted-foreground italic py-2">
                    Waiting for live agent events…
                  </p>
                )}
                {liveMessages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-2 py-0.5 border-b border-border/10 ${
                      m.level === "error"
                        ? "text-red-400"
                        : m.level === "warn"
                        ? "text-amber-400"
                        : m.type === "pipeline_state"
                        ? "text-purple-300"
                        : "text-zinc-300"
                    }`}
                  >
                    <span className="text-zinc-600 shrink-0 w-20 tabular-nums">
                      {new Date(m.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                    <span
                      className={`shrink-0 w-14 ${
                        ROLE_META[m.agent]?.color?.split(" ")[0] ?? "text-zinc-500"
                      }`}
                    >
                      {m.agent.slice(0, 8)}
                    </span>
                    <span className="flex-1 break-words">{m.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
