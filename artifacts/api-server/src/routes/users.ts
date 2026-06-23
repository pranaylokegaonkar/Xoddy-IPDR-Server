import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, systemUsersTable } from "@workspace/db";
import {
  CreateUserBody,
  UpdateUserBody,
  GetUserParams,
  UpdateUserParams,
  DeleteUserParams,
} from "@workspace/api-zod";
import { serializeUser } from "../lib/serializers";
import { hashPassword } from "../lib/password";

const router: IRouter = Router();

const USER_TYPES = [
  {
    value: "admin",
    label: "Administrator",
    description:
      "Full control: manage system users, NAS devices, collection settings, and exports.",
  },
  {
    value: "operator",
    label: "Operator",
    description:
      "Day-to-day operations: manage NAS devices, search and export IPDR records.",
  },
  {
    value: "viewer",
    label: "Viewer",
    description:
      "Read-only access to dashboards, flow records, and notifications.",
  },
];

router.get("/user-types", (_req, res) => {
  res.json(USER_TYPES);
});

router.get("/users", async (_req, res) => {
  const rows = await db
    .select()
    .from(systemUsersTable)
    .orderBy(systemUsersTable.id);
  res.json(rows.map(serializeUser));
});

router.post("/users", async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const body = parsed.data;
  try {
    const [row] = await db
      .insert(systemUsersTable)
      .values({
        username: body.username,
        fullName: body.fullName,
        email: body.email ?? null,
        userType: body.userType,
        passwordHash: hashPassword(body.password),
        enabled: body.enabled ?? true,
      })
      .returning();
    res.status(201).json(serializeUser(row!));
  } catch (err) {
    req.log.error({ err }, "Failed to create user");
    res.status(400).json({ error: "Username already exists" });
  }
});

router.get("/users/:id", async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .select()
    .from(systemUsersTable)
    .where(eq(systemUsersTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(serializeUser(row));
});

router.patch("/users/:id", async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const body = parsed.data;
  const updates: Record<string, unknown> = {};
  if (body.fullName !== undefined) updates.fullName = body.fullName;
  if (body.email !== undefined) updates.email = body.email;
  if (body.userType !== undefined) updates.userType = body.userType;
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.password !== undefined) updates.passwordHash = hashPassword(body.password);

  if (Object.keys(updates).length === 0) {
    const [existing] = await db
      .select()
      .from(systemUsersTable)
      .where(eq(systemUsersTable.id, params.data.id));
    if (!existing) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(serializeUser(existing));
    return;
  }

  const [row] = await db
    .update(systemUsersTable)
    .set(updates)
    .where(eq(systemUsersTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(serializeUser(row));
});

router.delete("/users/:id", async (req, res): Promise<void> => {
  const params = DeleteUserParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .delete(systemUsersTable)
    .where(eq(systemUsersTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.status(204).send();
});

export default router;
