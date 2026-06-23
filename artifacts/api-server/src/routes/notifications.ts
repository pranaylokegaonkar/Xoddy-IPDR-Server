import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";
import { MarkNotificationReadParams } from "@workspace/api-zod";
import { serializeNotification } from "../lib/serializers";

const router: IRouter = Router();

router.get("/notifications", async (_req, res) => {
  const rows = await db
    .select()
    .from(notificationsTable)
    .orderBy(desc(notificationsTable.createdAt));
  res.json(rows.map(serializeNotification));
});

router.patch("/notifications/:id/read", async (req, res): Promise<void> => {
  const params = MarkNotificationReadParams.safeParse({
    id: Number(req.params.id),
  });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .update(notificationsTable)
    .set({ read: true })
    .where(eq(notificationsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  res.json(serializeNotification(row));
});

router.post("/notifications/read-all", async (_req, res) => {
  const rows = await db
    .update(notificationsTable)
    .set({ read: true })
    .where(eq(notificationsTable.read, false))
    .returning();
  res.json({ count: rows.length });
});

export default router;
