import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { loginRouter, sessionRouter } from "./auth";
import { requireAuth } from "../middlewares/require-auth";
import auditRouter from "./audit";
import dashboardRouter from "./dashboard";
import usersRouter from "./users";
import nasRouter from "./nas";
import flowsRouter from "./flows";
import notificationsRouter from "./notifications";
import archivesRouter from "./archives";

const router: IRouter = Router();

// Public routes.
router.use(healthRouter);
router.use(loginRouter);

// Everything below requires an authenticated session.
router.use(requireAuth);
router.use(sessionRouter);
router.use(auditRouter);
router.use(dashboardRouter);
router.use(usersRouter);
router.use(nasRouter);
router.use(flowsRouter);
router.use(notificationsRouter);
router.use(archivesRouter);

export default router;
