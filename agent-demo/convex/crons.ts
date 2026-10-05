import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
const crons = cronJobs();
crons.hourly(
  "expire old evidence",
  { minuteUTC: 15 },
  internal.retention.clean,
);
export default crons;
