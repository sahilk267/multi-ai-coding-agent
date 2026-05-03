import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, agentsTable, agentTasksTable, agentMessagesTable, sessionsTable, logsTable } from "@workspace/db";

const router: IRouter = Router();

const AGENT_ROLES = ["orchestrator", "planner", "researcher", "coder", "reviewer", "tester"] as const;
const AI_MODEL_MAP: Record<string, string> = {
  orchestrator: "auto",
  planner: "chatgpt",
  researcher: "gemini",
  coder: "deepseek",
  reviewer: "chatgpt",
  tester: "qwen",
};

// ── POST /pipeline/start ──────────────────────────────────────────────────────

router.post("/pipeline/start", async (req, res): Promise<void> => {
  const { goal, projectId } = req.body ?? {};

  if (!goal || typeof goal !== "string" || !goal.trim()) {
    res.status(400).json({ error: "goal is required and must be a non-empty string" });
    return;
  }

  const [session] = await db
    .insert(sessionsTable)
    .values({
      projectId: typeof projectId === "number" ? projectId : null,
      goal: goal.trim(),
      status: "planning",
      aiModel: "auto",
      errorCount: 0,
    })
    .returning();

  await db.insert(logsTable).values({
    sessionId: session.id,
    level: "info",
    message: `Multi-agent pipeline started. Goal: ${goal.trim()}`,
  });

  const agentRows = await Promise.all(
    AGENT_ROLES.map((role) =>
      db
        .insert(agentsTable)
        .values({
          sessionId: session.id,
          role,
          status: role === "orchestrator" ? "running" : "idle",
          aiModel: AI_MODEL_MAP[role] ?? "auto",
          shortTermMemory: {},
        })
        .returning()
        .then((r) => r[0])
    )
  );

  const planTasks = [
    {
      title: "Research codebase structure",
      description: `Index and analyse the project for: ${goal.trim()}`,
      assignedTo: "researcher",
      priority: 1,
    },
    {
      title: "Implement solution",
      description: `Write all required code to accomplish: ${goal.trim()}`,
      assignedTo: "coder",
      priority: 2,
    },
    {
      title: "Code review",
      description: "Review all code changes for quality, security, and correctness",
      assignedTo: "reviewer",
      priority: 3,
    },
    {
      title: "Run tests and validate",
      description: "Execute the test suite and validate the final output",
      assignedTo: "tester",
      priority: 4,
    },
  ];

  const taskRows = await Promise.all(
    planTasks.map((t, i) =>
      db
        .insert(agentTasksTable)
        .values({ sessionId: session.id, taskIndex: i, ...t })
        .returning()
        .then((r) => r[0])
    )
  );

  await db.insert(agentMessagesTable).values({
    sessionId: session.id,
    fromAgent: "orchestrator",
    toAgent: "planner",
    messageType: "task_assign",
    payload: { goal: goal.trim(), task: "decompose_goal" },
  });

  // Build lookup maps for the Python orchestrator's DB callbacks
  const agentIds: Record<string, number> = {};
  for (const a of agentRows) agentIds[a.role] = a.id;

  const taskIds: Record<number, number> = {};
  for (const t of taskRows) taskIds[t.taskIndex] = t.id;

  // Fire-and-forget: launch the Python orchestrator (does not block the HTTP response)
  const pythonPayload = JSON.stringify({
    goal: goal.trim(),
    session_id: session.id,
    agent_ids: agentIds,
    task_ids: taskIds,
    callback_url: "http://localhost:8080",
  });

  fetch("http://localhost:8000/orchestrator/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: pythonPayload,
  }).catch((err) => {
    console.warn("[pipeline/start] Python orchestrator unavailable:", err.message);
  });

  res.status(201).json({
    session,
    agents: agentRows,
    tasks: taskRows,
    message: `Pipeline started with ${agentRows.length} agents — orchestrator launching`,
  });
});

// ── POST /pipeline/:sessionId/cancel ──────────────────────────────────────────

router.post("/pipeline/:sessionId/cancel", async (req, res): Promise<void> => {
  const sessionId = parseInt(req.params.sessionId, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "Invalid session ID" });
    return;
  }

  // Tell the Python orchestrator to stop
  try {
    await fetch("http://localhost:8000/orchestrator/cancel", { method: "POST" });
  } catch {
    /* orchestrator may already be done or not running */
  }

  // Mark session as paused in the DB
  const [session] = await db
    .update(sessionsTable)
    .set({ status: "paused", updatedAt: new Date() } as Record<string, unknown>)
    .where(eq(sessionsTable.id, sessionId))
    .returning();

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.json({ ok: true, session, message: "Pipeline cancel requested" });
});

// ── GET /pipeline/:sessionId/status ──────────────────────────────────────────

router.get("/pipeline/:sessionId/status", async (req, res): Promise<void> => {
  const sessionId = parseInt(req.params.sessionId, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "Invalid session ID" });
    return;
  }

  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const [agents, tasks, messages] = await Promise.all([
    db.select().from(agentsTable).where(eq(agentsTable.sessionId, sessionId)),
    db
      .select()
      .from(agentTasksTable)
      .where(eq(agentTasksTable.sessionId, sessionId))
      .orderBy(agentTasksTable.taskIndex),
    db
      .select()
      .from(agentMessagesTable)
      .where(eq(agentMessagesTable.sessionId, sessionId))
      .orderBy(desc(agentMessagesTable.createdAt))
      .limit(50),
  ]);

  res.json({ session, agents, tasks, messages });
});

// ── GET /agents ───────────────────────────────────────────────────────────────

router.get("/agents", async (req, res): Promise<void> => {
  const rawSessionId = req.query.sessionId;
  const sessionId =
    typeof rawSessionId === "string" ? parseInt(rawSessionId, 10) : NaN;

  const agents =
    !isNaN(sessionId)
      ? await db
          .select()
          .from(agentsTable)
          .where(eq(agentsTable.sessionId, sessionId))
      : await db
          .select()
          .from(agentsTable)
          .orderBy(desc(agentsTable.createdAt))
          .limit(100);

  res.json(agents);
});

// ── GET /agents/:id ───────────────────────────────────────────────────────────

router.get("/agents/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid agent ID" });
    return;
  }

  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, id));

  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  res.json(agent);
});

// ── PATCH /agents/:id ─────────────────────────────────────────────────────────

router.patch("/agents/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid agent ID" });
    return;
  }

  const { status, currentTask } = req.body ?? {};
  const validStatuses = ["idle", "running", "waiting", "completed", "failed"];

  if (status !== undefined && !validStatuses.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` });
    return;
  }

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (status !== undefined) {
    update.status = status;
    if (status === "running") update.startedAt = new Date();
    if (status === "completed" || status === "failed") update.completedAt = new Date();
  }
  if (currentTask !== undefined) update.currentTask = currentTask ?? null;

  const [agent] = await db
    .update(agentsTable)
    .set(update)
    .where(eq(agentsTable.id, id))
    .returning();

  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  res.json(agent);
});

// ── GET /agent-tasks ──────────────────────────────────────────────────────────

router.get("/agent-tasks", async (req, res): Promise<void> => {
  const rawSessionId = req.query.sessionId;
  const sessionId =
    typeof rawSessionId === "string" ? parseInt(rawSessionId, 10) : NaN;

  const tasks =
    !isNaN(sessionId)
      ? await db
          .select()
          .from(agentTasksTable)
          .where(eq(agentTasksTable.sessionId, sessionId))
          .orderBy(agentTasksTable.taskIndex)
      : await db
          .select()
          .from(agentTasksTable)
          .orderBy(desc(agentTasksTable.createdAt))
          .limit(200);

  res.json(tasks);
});

// ── PATCH /agent-tasks/:id ────────────────────────────────────────────────────

router.patch("/agent-tasks/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }

  const { status, result, errorMessage } = req.body ?? {};
  const validStatuses = ["pending", "running", "completed", "failed"];

  if (status !== undefined && !validStatuses.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` });
    return;
  }

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (status !== undefined) {
    update.status = status;
    if (status === "running") update.startedAt = new Date();
    if (status === "completed" || status === "failed") update.completedAt = new Date();
  }
  if (result !== undefined) update.result = result;
  if (errorMessage !== undefined) update.errorMessage = errorMessage;

  const [task] = await db
    .update(agentTasksTable)
    .set(update)
    .where(eq(agentTasksTable.id, id))
    .returning();

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.json(task);
});

// ── GET /agent-messages ───────────────────────────────────────────────────────

router.get("/agent-messages", async (req, res): Promise<void> => {
  const rawSessionId = req.query.sessionId;
  const sessionId =
    typeof rawSessionId === "string" ? parseInt(rawSessionId, 10) : NaN;

  const msgs =
    !isNaN(sessionId)
      ? await db
          .select()
          .from(agentMessagesTable)
          .where(eq(agentMessagesTable.sessionId, sessionId))
          .orderBy(agentMessagesTable.createdAt)
      : await db
          .select()
          .from(agentMessagesTable)
          .orderBy(desc(agentMessagesTable.createdAt))
          .limit(100);

  res.json(msgs);
});

// ── POST /agent-messages ──────────────────────────────────────────────────────

router.post("/agent-messages", async (req, res): Promise<void> => {
  const { sessionId, fromAgent, toAgent, messageType, payload } = req.body ?? {};

  if (
    typeof sessionId !== "number" ||
    typeof fromAgent !== "string" ||
    typeof toAgent !== "string" ||
    typeof messageType !== "string"
  ) {
    res.status(400).json({
      error: "sessionId (number), fromAgent, toAgent, messageType (strings) are required",
    });
    return;
  }

  const [msg] = await db
    .insert(agentMessagesTable)
    .values({
      sessionId,
      fromAgent,
      toAgent,
      messageType,
      payload: payload ?? {},
    })
    .returning();

  res.status(201).json(msg);
});

export default router;
