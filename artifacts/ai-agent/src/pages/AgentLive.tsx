import { useRef, useEffect, useState } from "react";
import {
  Radio,
  Terminal,
  CheckCircle2,
  XCircle,
  Pause,
  Play,
  Square,
  Trash2,
  ChevronRight,
  ChevronDown,
  Wifi,
  WifiOff,
  FileCode,
  GitCommit,
  FlaskConical,
  ShieldCheck,
  Settings,
  RefreshCw,
} from "lucide-react";
import { useAgentSocket, AgentState, TerminalLine, ApprovalItem, ActivityEvent, PlanTask } from "@/hooks/useAgentSocket";

// ── State badge ────────────────────────────────────────────────────────────────

const STATE_COLOR: Record<AgentState | string, string> = {
  IDLE:             "bg-zinc-700 text-zinc-300",
  PLANNING:         "bg-blue-900/60 text-blue-300 animate-pulse",
  EXECUTING:        "bg-green-900/60 text-green-300 animate-pulse",
  WAITING_APPROVAL: "bg-amber-900/60 text-amber-300 animate-pulse",
  FIXING:           "bg-orange-900/60 text-orange-300 animate-pulse",
  PAUSED:           "bg-yellow-900/60 text-yellow-300",
  DONE:             "bg-emerald-900/60 text-emerald-300",
  FAILED:           "bg-red-900/60 text-red-300",
};

const STATE_DOT: Record<AgentState | string, string> = {
  IDLE:             "bg-zinc-500",
  PLANNING:         "bg-blue-400",
  EXECUTING:        "bg-green-400",
  WAITING_APPROVAL: "bg-amber-400",
  FIXING:           "bg-orange-400",
  PAUSED:           "bg-yellow-400",
  DONE:             "bg-emerald-400",
  FAILED:           "bg-red-400",
};

function StateBadge({ state }: { state: AgentState | string }) {
  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-semibold uppercase tracking-widest ${STATE_COLOR[state] ?? "bg-zinc-700 text-zinc-300"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${STATE_DOT[state] ?? "bg-zinc-500"}`} />
      {state}
    </span>
  );
}

// ── Terminal ───────────────────────────────────────────────────────────────────

function TerminalView({ lines, onClear }: { lines: TerminalLine[]; onClear: () => void }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, autoScroll]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }

  const lineClass = (kind: TerminalLine["kind"]) => {
    if (kind === "meta")   return "text-blue-400";
    if (kind === "error")  return "text-red-400";
    if (kind === "system") return "text-zinc-500 italic";
    return "text-green-300";
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/40">
        <span className="text-xs font-mono text-muted-foreground flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5" /> STDOUT / STDERR
        </span>
        <button
          onClick={onClear}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
        >
          <Trash2 className="h-3 w-3" /> Clear
        </button>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto font-mono text-[12px] leading-5 p-4 space-y-0.5 bg-[#0a0a0f]"
      >
        {lines.length === 0 && (
          <p className="text-zinc-600 italic">Waiting for agent output…</p>
        )}
        {lines.map((l) => (
          <div key={l.id} className={lineClass(l.kind)}>
            {l.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {!autoScroll && (
        <button
          onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }}
          className="absolute bottom-4 right-4 bg-primary text-primary-foreground text-xs px-3 py-1 rounded-full shadow-lg"
        >
          ↓ Latest
        </button>
      )}
    </div>
  );
}

// ── Approval card ──────────────────────────────────────────────────────────────

function ApprovalCard({
  item,
  onApprove,
  onReject,
}: {
  item: ApprovalItem;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isFile = item.kind === "write_file";

  return (
    <div className="border border-amber-800/50 rounded-lg bg-amber-950/20 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldCheck className="h-4 w-4 text-amber-400 shrink-0" />
          <span className="text-xs font-mono text-amber-300 font-semibold truncate">
            {isFile ? `Write: ${item.path}` : `Run: ${item.cmd}`}
          </span>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      </div>

      {expanded && (isFile ? (
        <div className="space-y-1">
          {item.oldContent && (
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">BEFORE</p>
              <pre className="text-[11px] font-mono bg-red-950/30 border border-red-900/40 rounded p-2 max-h-24 overflow-y-auto text-red-300 whitespace-pre-wrap">
                {item.oldContent.slice(0, 800)}
              </pre>
            </div>
          )}
          {item.newContent && (
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">AFTER</p>
              <pre className="text-[11px] font-mono bg-green-950/30 border border-green-900/40 rounded p-2 max-h-24 overflow-y-auto text-green-300 whitespace-pre-wrap">
                {item.newContent.slice(0, 800)}
              </pre>
            </div>
          )}
        </div>
      ) : (
        <pre className="text-[11px] font-mono bg-zinc-900 rounded p-2 text-zinc-300">
          {item.cmd}
        </pre>
      ))}

      <div className="flex gap-2 pt-1">
        <button
          onClick={onApprove}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded bg-green-900/40 border border-green-700/50 text-green-300 text-xs font-semibold hover:bg-green-800/60 transition-colors"
        >
          <CheckCircle2 className="h-3.5 w-3.5" /> Approve
        </button>
        <button
          onClick={onReject}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded bg-red-900/40 border border-red-700/50 text-red-300 text-xs font-semibold hover:bg-red-800/60 transition-colors"
        >
          <XCircle className="h-3.5 w-3.5" /> Reject
        </button>
      </div>
    </div>
  );
}

// ── Activity feed ──────────────────────────────────────────────────────────────

const ACTIVITY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  file:     FileCode,
  git:      GitCommit,
  test:     FlaskConical,
  approval: ShieldCheck,
  cmd:      Terminal,
};

function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  function fmt(ts: number) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  return (
    <div className="space-y-1.5 overflow-y-auto max-h-full">
      {events.length === 0 && (
        <p className="text-xs text-muted-foreground italic px-1">No activity yet…</p>
      )}
      {events.map((e) => {
        const Icon = ACTIVITY_ICON[e.type] ?? Radio;
        return (
          <div key={e.id} className="flex items-start gap-2 px-1 py-1.5 rounded hover:bg-secondary/30 transition-colors">
            <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${e.ok === false ? "text-red-400" : e.ok === true ? "text-green-400" : "text-muted-foreground"}`} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-mono text-foreground truncate">{e.label}</p>
              <p className="text-[10px] font-mono text-muted-foreground truncate">{e.detail || "—"}</p>
            </div>
            <span className="text-[10px] font-mono text-zinc-600 shrink-0">{fmt(e.timestamp)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Plan viewer ────────────────────────────────────────────────────────────────

function PlanViewer({ tasks }: { tasks: PlanTask[] }) {
  const [open, setOpen] = useState<Record<number, boolean>>({ 0: true });
  return (
    <div className="space-y-2">
      {tasks.map((task, ti) => (
        <div key={ti} className="border border-border rounded-md overflow-hidden">
          <button
            className="w-full flex items-center gap-2 px-3 py-2 bg-secondary/30 text-xs font-mono font-semibold text-foreground hover:bg-secondary/50 transition-colors text-left"
            onClick={() => setOpen((p) => ({ ...p, [ti]: !p[ti] }))}
          >
            {open[ti] ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
            {task.name}
            <span className="ml-auto text-muted-foreground font-normal">{task.steps?.length ?? 0} steps</span>
          </button>
          {open[ti] && (
            <div className="divide-y divide-border/30">
              {(task.steps ?? []).map((step, si) => (
                <div key={si} className="flex items-start gap-2 px-3 py-1.5">
                  <span className="text-[10px] font-mono text-muted-foreground w-4 shrink-0 mt-0.5">{si + 1}.</span>
                  <div className="min-w-0">
                    <span className="text-[11px] font-mono text-primary">{step.action}</span>
                    {step.path && <span className="text-[11px] font-mono text-muted-foreground ml-2">{step.path}</span>}
                    {step.cmd && <span className="text-[11px] font-mono text-amber-400 ml-2">{step.cmd}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Settings drawer ────────────────────────────────────────────────────────────

function SettingsPanel({ url, onSave }: { url: string; onSave: (u: string) => void }) {
  const [val, setVal] = useState(url);
  return (
    <div className="p-4 space-y-3 border border-border rounded-lg bg-card">
      <p className="text-xs font-mono text-muted-foreground">Python backend URL (port 8000 by default)</p>
      <div className="flex gap-2">
        <input
          className="flex-1 bg-secondary border border-border rounded px-3 py-1.5 text-sm font-mono text-foreground outline-none focus:border-primary"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="http://localhost:8000"
        />
        <button
          onClick={() => onSave(val.trim() || "http://localhost:8000")}
          className="px-4 py-1.5 rounded bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/80 transition-colors"
        >
          Connect
        </button>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

type Tab = "terminal" | "plan" | "activity";

export function AgentLive() {
  const [backendUrl, setBackendUrl] = useState("http://localhost:8000");
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("terminal");

  const {
    connected,
    agentState,
    terminalLines,
    approvals,
    activity,
    plan,
    currentCmd,
    resolveApproval,
    pauseAgent,
    resumeAgent,
    stopAgent,
    clearTerminal,
    reconnect,
  } = useAgentSocket({ backendUrl });

  function handleSaveUrl(url: string) {
    setBackendUrl(url);
    setShowSettings(false);
    setTimeout(reconnect, 200);
  }

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "terminal", label: "Terminal", badge: terminalLines.length },
    { id: "plan",     label: "Plan",     badge: plan?.length ?? 0 },
    { id: "activity", label: "Activity", badge: activity.length },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Top bar ────────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-3 px-6 py-4 border-b border-border bg-card/50">
        <div className="flex flex-col">
          <h1 className="text-lg font-mono font-bold text-foreground flex items-center gap-2">
            <Radio className="h-5 w-5 text-primary" />
            Agent Live
          </h1>
          <p className="text-xs font-mono text-muted-foreground">Real-time agent monitoring &amp; approval queue</p>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <StateBadge state={agentState} />

          <div className={`flex items-center gap-1.5 text-xs font-mono ${connected ? "text-green-400" : "text-red-400"}`}>
            {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {connected ? "Live" : "Offline"}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1 border border-border rounded-lg p-1">
            <button
              onClick={() => pauseAgent()}
              disabled={!connected || agentState === "PAUSED" || agentState === "IDLE"}
              title="Pause"
              className="p-1.5 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Pause className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => resumeAgent()}
              disabled={!connected || agentState !== "PAUSED"}
              title="Resume"
              className="p-1.5 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Play className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => stopAgent()}
              disabled={!connected || agentState === "IDLE"}
              title="Stop / Cancel"
              className="p-1.5 rounded hover:bg-secondary transition-colors text-red-400/70 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => reconnect()}
              title="Reconnect"
              className="p-1.5 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1.5 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
            title="Settings"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── Settings (expandable) ───────────────────────────────────────────── */}
      {showSettings && (
        <div className="shrink-0 px-6 py-3 border-b border-border">
          <SettingsPanel url={backendUrl} onSave={handleSaveUrl} />
        </div>
      )}

      {/* ── Current command bar ─────────────────────────────────────────────── */}
      {currentCmd && (
        <div className="shrink-0 px-6 py-2 bg-green-950/30 border-b border-green-900/30 flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-green-400 animate-pulse shrink-0" />
          <span className="text-xs font-mono text-green-300 truncate">Running: {currentCmd}</span>
        </div>
      )}

      {/* ── Approval banner ─────────────────────────────────────────────────── */}
      {approvals.length > 0 && (
        <div className="shrink-0 px-6 py-2 bg-amber-950/30 border-b border-amber-800/40 flex items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5 text-amber-400 shrink-0 animate-pulse" />
          <span className="text-xs font-mono text-amber-300">
            {approvals.length} approval{approvals.length > 1 ? "s" : ""} pending — scroll right panel ↓
          </span>
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex gap-0 overflow-hidden min-h-0">

        {/* Left: terminal + tabs */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-border">
          {/* Tab strip */}
          <div className="shrink-0 flex border-b border-border bg-card/30 px-2 pt-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`px-4 py-2 text-xs font-mono rounded-t-md transition-colors flex items-center gap-1.5 ${
                  activeTab === t.id
                    ? "bg-background text-foreground border border-b-0 border-border"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
                {t.badge !== undefined && t.badge > 0 && (
                  <span className="text-[10px] bg-secondary text-muted-foreground px-1.5 py-0.5 rounded-full">
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab contents */}
          <div className="flex-1 overflow-hidden relative">
            {activeTab === "terminal" && (
              <TerminalView lines={terminalLines} onClear={clearTerminal} />
            )}
            {activeTab === "plan" && (
              <div className="h-full overflow-y-auto p-4">
                {plan && plan.length > 0 ? (
                  <PlanViewer tasks={plan} />
                ) : (
                  <p className="text-xs text-muted-foreground italic">No plan received yet. Start the agent to see the execution plan.</p>
                )}
              </div>
            )}
            {activeTab === "activity" && (
              <div className="h-full overflow-y-auto p-4">
                <ActivityFeed events={activity} />
              </div>
            )}
          </div>
        </div>

        {/* Right: approvals + activity sidebar */}
        <div className="w-80 shrink-0 flex flex-col overflow-hidden">
          {/* Approvals */}
          <div className="flex-1 flex flex-col overflow-hidden border-b border-border">
            <div className="shrink-0 px-4 py-3 border-b border-border flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-amber-400" />
              <span className="text-xs font-mono font-semibold text-foreground">Approval Queue</span>
              {approvals.length > 0 && (
                <span className="ml-auto text-xs bg-amber-900/50 text-amber-300 border border-amber-700/50 px-2 py-0.5 rounded-full font-mono">
                  {approvals.length}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {approvals.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-24 text-muted-foreground gap-2">
                  <CheckCircle2 className="h-8 w-8 opacity-20" />
                  <p className="text-xs italic">No pending approvals</p>
                </div>
              ) : (
                approvals.map((item) => (
                  <ApprovalCard
                    key={item.id}
                    item={item}
                    onApprove={() => resolveApproval(item.id, "approve")}
                    onReject={() => resolveApproval(item.id, "reject")}
                  />
                ))
              )}
            </div>
          </div>

          {/* Activity summary (sidebar) */}
          <div className="h-52 flex flex-col overflow-hidden">
            <div className="shrink-0 px-4 py-2 border-b border-border">
              <span className="text-xs font-mono font-semibold text-foreground">Recent Activity</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <ActivityFeed events={activity.slice(0, 12)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
