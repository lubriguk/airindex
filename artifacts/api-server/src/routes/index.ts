import { Router, type IRouter } from "express";
import healthRouter from "./health";
import airportDelaysRouter from "./airport-delays";

const router: IRouter = Router();

router.use(healthRouter);
router.use(airportDelaysRouter);

export default router;
