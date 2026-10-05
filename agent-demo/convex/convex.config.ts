import { defineApp } from "convex/server";
import agent from "@convex-dev/agent/convex.config";
import crons from "@convex-dev/crons/convex.config.js";
import freestyle from "@freestyle-sh/convex/convex.config.js";
const app = defineApp();
app.use(agent);
app.use(crons, { name: "crons" });
app.use(freestyle, { name: "freestyle" });
export default app;
