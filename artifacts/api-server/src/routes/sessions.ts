import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, sessionsTable, logsTable, plansTable } from "@workspace/db";
import {
  CreateSessionBody,
  GetSessionParams,
  UpdateSessionParams,
  UpdateSessionBody,
  GetSessionLogsParams,
  GetSessionPlanParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/sessions", async (_req, res): Promise<void> => {
  const sessions = await db
    .select()
    .from(sessionsTable)
    .orderBy(desc(sessionsTable.createdAt));
  res.json(sessions);
});

router.post("/sessions", async (req, res): Promise<void> => {
  const parsed = CreateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [session] = await db
    .insert(sessionsTable)
    .values({
      projectId: parsed.data.projectId ?? null,
      goal: parsed.data.goal,
      status: "idle",
      aiModel: parsed.data.aiModel,
      errorCount: 0,
    })
    .returning();

  await db.insert(logsTable).values({
    sessionId: session.id,
    level: "info",
    message: `Session created. Goal: ${session.goal}`,
  });

  res.status(201).json(session);
});

router.get("/sessions/:id", async (req, res): Promise<void> => {
  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, params.data.id));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.json(session);
});

router.patch("/sessions/:id", async (req, res): Promise<void> => {
  const params = UpdateSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const bodyParsed = UpdateSessionBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (bodyParsed.data.status !== undefined) updateData.status = bodyParsed.data.status;
  if (bodyParsed.data.currentStep !== undefined) updateData.currentStep = bodyParsed.data.currentStep;
  if (bodyParsed.data.totalSteps !== undefined) updateData.totalSteps = bodyParsed.data.totalSteps;

  const [session] = await db
    .update(sessionsTable)
    .set(updateData)
    .where(eq(sessionsTable.id, params.data.id))
    .returning();

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (bodyParsed.data.status) {
    await db.insert(logsTable).values({
      sessionId: session.id,
      level: bodyParsed.data.status === "failed" ? "error" : "info",
      message: `Session status changed to: ${bodyParsed.data.status}`,
    });
  }

  res.json(session);
});

router.get("/sessions/:id/logs", async (req, res): Promise<void> => {
  const params = GetSessionLogsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const logs = await db
    .select()
    .from(logsTable)
    .where(eq(logsTable.sessionId, params.data.id))
    .orderBy(logsTable.createdAt);

  res.json(logs);
});

router.get("/sessions/:id/plan", async (req, res): Promise<void> => {
  const params = GetSessionPlanParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, params.data.id));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const [plan] = await db
    .select()
    .from(plansTable)
    .where(eq(plansTable.sessionId, params.data.id));

  res.json({
    sessionId: params.data.id,
    goal: session.goal,
    tasks: plan?.tasks ?? [],
  });
});

export default router;
