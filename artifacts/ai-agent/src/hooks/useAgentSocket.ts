import { useEffect, useRef, useCallback, useState } from "react";

export type AgentState =
  | "IDLE"
  | "PLANNING"
  | "EXECUTING"
  | "WAITING_APPROVAL"
  | "FIXING"
  | "PAUSED"
  | "DONE"
  | "FAILED";

export interface TerminalLine {
  id: number;
  text: string;
  kind: "output" | "meta" | "error" | "system";
  taskId?: string;
  timestamp: number;
}

export interface ApprovalItem {
  id: string;
  kind: "write_file" | "execute_command" | string;
  path?: string;
  cmd?: string;
  oldContent?: string;
  newContent?: string;
  receivedAt: number;
}

export interface ActivityEvent {
  id: number;
  type: string;
  label: string;
  detail: string;
  timestamp: number;
  ok?: boolean;
}

export interface PlanTask {
  name: string;
  steps: { action: string; path?: string; cmd?: string; content?: string }[];
}

interface AgentSocketOptions {
  backendUrl?: string;
  maxTerminalLines?: number;
  maxActivityEvents?: number;
}

let _lineId = 0;
let _eventId = 0;

export function useAgentSocket({
  backendUrl = "http://localhost:8000",
  maxTerminalLines = 500,
  maxActivityEvents = 50,
}: AgentSocketOptions = {}) {
  const [connected, setConnected] = useState(false);
  const [agentState, setAgentState] = useState<AgentState>("IDLE");
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([]);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [plan, setPlan] = useState<PlanTask[] | null>(null);
  const [currentCmd, setCurrentCmd] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const wsUrl = backendUrl.replace(/^http/, "ws") + "/ws";

  const addLine = useCallback(
    (text: string, kind: TerminalLine["kind"] = "output", taskId?: string) => {
      setTerminalLines((prev) => {
        const next = [
          ...prev,
          { id: ++_lineId, text, kind, taskId, timestamp: Date.now() },
        ];
        return next.length > maxTerminalLines ? next.slice(-maxTerminalLines) : next;
      });
    },
    [maxTerminalLines]
  );

  const addActivity = useCallback(
    (type: string, label: string, detail: string, ok?: boolean) => {
      setActivity((prev) => {
        const next = [
          { id: ++_eventId, type, label, detail, timestamp: Date.now(), ok },
          ...prev,
        ];
        return next.length > maxActivityEvents ? next.slice(0, maxActivityEvents) : next;
      });
    },
    [maxActivityEvents]
  );

  const handleMessage = useCallback(
    (raw: string) => {
      let msg: { type: string; payload?: Record<string, unknown> };
      try {
        msg = JSON.parse(raw);
      } catch {
        addLine(raw, "output");
        return;
      }

      const { type, payload = {} } = msg;

      switch (type) {
        case "status":
          if (payload.state) {
            setAgentState(payload.state as AgentState);
            addLine(`▶ State → ${payload.state}`, "system");
          }
          break;

        case "command_started":
          setCurrentCmd((payload.cmd as string) || null);
          addLine(`$ ${payload.cmd}`, "meta", payload.task_id as string);
          addActivity("cmd", "Command", String(payload.cmd || ""), undefined);
          break;

        case "command_output":
          addLine(String(payload.line ?? ""), "output", payload.task_id as string);
          break;

        case "command_finished":
          setCurrentCmd(null);
          addLine(
            `[exit ${payload.code}]${payload.code === 0 ? " ✓" : " ✗"}`,
            payload.code === 0 ? "meta" : "error",
            payload.task_id as string
          );
          break;

        case "file_written":
          addLine(`✎ ${payload.path} (${payload.size} bytes)`, "meta");
          addActivity("file", "File Written", String(payload.path || ""), true);
          break;

        case "approval_request": {
          const item: ApprovalItem = {
            id: String(payload.id || Date.now()),
            kind: String(payload.kind || ""),
            path: payload.path as string | undefined,
            cmd: payload.cmd as string | undefined,
            oldContent: payload.oldContent as string | undefined,
            newContent: payload.newContent as string | undefined,
            receivedAt: Date.now(),
          };
          setApprovals((prev) => {
            if (prev.find((a) => a.id === item.id)) return prev;
            return [...prev, item];
          });
          addActivity("approval", "Approval Needed", item.path || item.cmd || "", undefined);
          break;
        }

        case "approval_resolved":
          setApprovals((prev) => prev.filter((a) => a.id !== (payload.id as string)));
          break;

        case "test_result":
          addLine(
            `[tests] ${payload.passed ?? "?"} passed / ${payload.failed ?? "?"} failed`,
            payload.failed ? "error" : "meta"
          );
          addActivity(
            "test",
            "Tests",
            `${payload.passed ?? 0}✓ ${payload.failed ?? 0}✗`,
            !payload.failed
          );
          break;

        case "git":
          addLine(`[git] ${payload.action} ${payload.ok ? "✓" : "✗"} ${payload.info || ""}`, "meta");
          addActivity("git", `git ${payload.action}`, String(payload.info || ""), payload.ok as boolean);
          break;

        case "plan":
          if (Array.isArray((payload as { tasks?: PlanTask[] }).tasks)) {
            setPlan((payload as { tasks: PlanTask[] }).tasks);
            addLine(`📋 Plan: ${(payload as { tasks: PlanTask[] }).tasks.length} tasks`, "system");
          }
          break;

        case "log":
          addLine(String(payload.message || raw), "output");
          break;

        case "error":
          addLine(`ERROR: ${payload.message || payload.error || raw}`, "error");
          break;

        default:
          break;
      }
    },
    [addLine, addActivity]
  );

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
    if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); wsRef.current = null; }
    setConnected(false);
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    addLine(`Connecting to ${wsUrl}…`, "system");
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      setConnected(true);
      addLine("Connected to agent backend", "system");
    };

    ws.onmessage = (e) => handleMessage(e.data);

    ws.onerror = () => {
      addLine("WebSocket error", "error");
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      setCurrentCmd(null);
      addLine("Disconnected — retrying in 5s…", "system");
      reconnectTimer.current = setTimeout(connect, 5000);
    };
  }, [wsUrl, addLine, handleMessage]);

  const reconnect = useCallback(() => {
    disconnect();
    setTimeout(connect, 300);
  }, [disconnect, connect]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // ── REST helpers ────────────────────────────────────────────────────────────

  const agentRequest = useCallback(
    async (endpoint: string, method = "POST", data?: unknown) => {
      try {
        const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
        if (data !== undefined) opts.body = JSON.stringify(data);
        const res = await fetch(backendUrl + endpoint, opts);
        return res.ok;
      } catch {
        return false;
      }
    },
    [backendUrl]
  );

  const resolveApproval = useCallback(
    async (id: string, decision: "approve" | "reject") => {
      setApprovals((prev) => prev.filter((a) => a.id !== id));
      await agentRequest(`/approvals/${id}`, "POST", { decision });
    },
    [agentRequest]
  );

  const pauseAgent = useCallback(() => agentRequest("/state/PAUSED"), [agentRequest]);
  const resumeAgent = useCallback(() => agentRequest("/state/EXECUTING"), [agentRequest]);
  const stopAgent = useCallback(() => agentRequest("/cancel"), [agentRequest]);
  const clearTerminal = useCallback(() => setTerminalLines([]), []);

  return {
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
  };
}
