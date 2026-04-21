import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, memoryTable } from "@workspace/db";
import {
  AddMemoryBody,
  DeleteMemoryParams,
  GetMemoryQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/memory", async (req, res): Promise<void> => {
  const queryParsed = GetMemoryQueryParams.safeParse(req.query);

  let query = db.select().from(memoryTable);

  if (queryParsed.success && queryParsed.data.projectId !== undefined) {
    const entries = await db
      .select()
      .from(memoryTable)
      .where(eq(memoryTable.projectId, queryParsed.data.projectId));
    res.json(entries);
    return;
  }

  const entries = await query;
  res.json(entries);
});

router.post("/memory", async (req, res): Promise<void> => {
  const parsed = AddMemoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [entry] = await db
    .insert(memoryTable)
    .values({
      projectId: parsed.data.projectId ?? null,
      type: parsed.data.type,
      key: parsed.data.key,
      value: parsed.data.value,
    })
    .returning();

  res.status(201).json(entry);
});

router.delete("/memory/:id", async (req, res): Promise<void> => {
  const params = DeleteMemoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [entry] = await db
    .delete(memoryTable)
    .where(eq(memoryTable.id, params.data.id))
    .returning();

  if (!entry) {
    res.status(404).json({ error: "Memory entry not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
