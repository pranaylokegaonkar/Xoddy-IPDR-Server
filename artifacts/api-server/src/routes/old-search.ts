import { Router, type Request, type Response, type IRouter } from "express";
import {
  FindOldSearchArchivesBody, PrepareOldSearchSessionBody,
  SearchOldSearchSessionBody, ExportOldSearchSessionBody,
} from "@workspace/api-zod";
import {
  findOldArchives, listOldSessions, prepareOldSession, oldSessionStatus,
  releaseOldSession, useOldWorkspace, scanOldWorkspace, OldSearchError,
} from "../lib/old-search";
import { ArchiveLockedError } from "../lib/archive-locks";
import { buildExcel, buildText, type ExportRow } from "../lib/export";
import { recordAudit } from "../lib/audit";

const router: IRouter = Router();
function owner(req: Request) { return req.session.user!.id; }
function validRangeBody(value: unknown): boolean {
  const body = value as Record<string, unknown> | null;
  return !!body && ["startAt", "endAt"].every((key) =>
    typeof body[key] === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(body[key] as string));
}
function failure(req: Request, res: Response, error: unknown) {
  if (res.headersSent) { res.destroy(); return; }
  if (error instanceof OldSearchError || error instanceof ArchiveLockedError) {
    res.status(error instanceof OldSearchError ? error.status : 409).json({ error: error.message });
  } else {
    req.log.error({ err: error }, "Old Search operation failed");
    res.status(500).json({ error: "Old Search operation failed. No original archive was deleted. Check server logs or prepare a smaller selection." });
  }
}
router.post("/old-search/archives", async (req, res) => {
  const body = FindOldSearchArchivesBody.safeParse(req.body);
  if (!body.success || !validRangeBody(req.body)) { res.status(400).json({ error: "Provide a valid start/end timestamp with timezone and optional NAS." }); return; }
  try { res.json(await findOldArchives(body.data)); } catch (err) { failure(req, res, err); }
});
router.get("/old-search/sessions", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(listOldSessions(owner(req)));
});
router.post("/old-search/sessions", async (req, res) => {
  const body = PrepareOldSearchSessionBody.safeParse(req.body);
  if (!body.success || !validRangeBody(req.body)) { res.status(400).json({ error: "Choose 1–100 archives and a valid date/time range with timezone." }); return; }
  try {
    const session = await prepareOldSession(owner(req), body.data);
    res.status(202).json(session);
    void recordAudit(req, "old-search.prepare", `Prepared temporary workspace ${session.id} for ${session.totalArchives} selected archive(s); originals protected from deletion`);
  } catch (err) { failure(req, res, err); }
});
router.get("/old-search/sessions/:id", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try { res.json(await oldSessionStatus(owner(req), String(req.params.id))); }
  catch (err) { failure(req, res, err); }
});
router.delete("/old-search/sessions/:id", async (req, res) => {
  try {
    const result = await releaseOldSession(owner(req), String(req.params.id));
    res.json(result);
    void recordAudit(req, "old-search.release", `Released temporary workspace ${req.params.id}; original archives retained`);
  } catch (err) { failure(req, res, err); }
});
router.post("/old-search/sessions/:id/search", async (req, res) => {
  const body = SearchOldSearchSessionBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid search filters." }); return; }
  try {
    const result = await useOldWorkspace(owner(req), String(req.params.id), (s) => scanOldWorkspace(s, body.data));
    res.setHeader("Cache-Control", "no-store");
    res.json(result);
  } catch (err) { failure(req, res, err); }
});
router.post("/old-search/sessions/:id/export", async (req, res) => {
  const body = ExportOldSearchSessionBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid export filters or format." }); return; }
  const id = String(req.params.id), user = owner(req);
  try {
    let sent = false;
    await useOldWorkspace(user, id, async (s) => {
      const result = await scanOldWorkspace(s, body.data, true);
      const rows: ExportRow[] = result.records.map((r) => ({
        ...r, startTime: new Date(r.startTime), endTime: new Date(r.endTime),
      }));
      const excel = body.data.format === "excel";
      const file = excel ? await buildExcel(rows) : buildText(rows);
      s.abort.signal.throwIfAborted();
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", excel
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="ipdr-old-search.${excel ? "xlsx" : "txt"}"`);
      // Keep the workspace busy until transfer finishes or the client disconnects.
      await new Promise<void>((resolve) => {
        const finish = () => { sent = true; res.off("close", close); resolve(); };
        const close = () => { res.off("finish", finish); resolve(); };
        res.once("finish", finish); res.once("close", close);
        res.send(file);
      });
      void recordAudit(req, "old-search.export", `Exported ${rows.length} temporary flow record(s) from ${id} as ${body.data.format}`);
    });
    if (sent && body.data.releaseAfterExport) {
      await releaseOldSession(user, id);
      void recordAudit(req, "old-search.release-after-export", `Released ${id} after server completed export transfer; browser save is not verifiable`);
    }
  } catch (err) { failure(req, res, err); }
});
export default router;
