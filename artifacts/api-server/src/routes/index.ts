import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import usersRouter from "./users";
import nasRouter from "./nas";
import flowsRouter from "./flows";
import notificationsRouter from "./notifications";
import archivesRouter from "./archives";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(usersRouter);
router.use(nasRouter);
router.use(flowsRouter);
router.use(notificationsRouter);
router.use(archivesRouter);

export default router;
