import { defineApp } from "convex/server";
import freestyle from "@freestyle-sh/convex/convex.config.js";

const app = defineApp();
app.use(freestyle);

export default app;
