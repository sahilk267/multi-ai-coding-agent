import { Router, type IRouter } from "express";
import { db, projectsTable, sessionsTable } from "@workspace/db";
import { count, eq, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/stats", async (_req, res): Promise<void> => {
  const [projectCount] = await db.select({ count: count() }).from(projectsTable);
  const [sessionCount] = await db.select({ count: count() }).from(sessionsTable);

  const [completedCount] = await db
    .select({ count: count() })
    .from(sessionsTable)
    .where(eq(sessionsTable.status, "completed"));

  const [failedCount] = await db
    .select({ count: count() })
    .from(sessionsTable)
    .where(eq(sessionsTable.status, "failed"));

  const [modelRow] = await db
    .select({ model: sessionsTable.aiModel, cnt: count() })
    .from(sessionsTable)
    .groupBy(sessionsTable.aiModel)
    .orderBy(sql`count(*) desc`)
    .limit(1);

  res.json({
    totalProjects: projectCount.count,
    totalSessions: sessionCount.count,
    completedSessions: completedCount.count,
    failedSessions: failedCount.count,
    totalFilesModified: 0,
    totalCommandsRun: 0,
    activeModel: modelRow?.model ?? "auto",
  });
});

export default router;
