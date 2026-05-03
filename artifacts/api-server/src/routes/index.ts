import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import filesRouter from "./files";
import sessionsRouter from "./sessions";
import memoryRouter from "./memory";
import executeRouter from "./execute";
import statsRouter from "./stats";
import agentsRouter from "./agents";

const router: IRouter = Router();

router.use(healthRouter);
router.use(projectsRouter);
router.use(filesRouter);
router.use(sessionsRouter);
router.use(memoryRouter);
router.use(executeRouter);
router.use(statsRouter);
router.use(agentsRouter);

export default router;
