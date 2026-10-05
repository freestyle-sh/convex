import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  boundedBody,
  digest,
  normalizeEvent,
  verifySignature,
} from "./lib/events";

const http = httpRouter();
http.route({
  pathPrefix: "/webhooks/logs/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const projectId = new URL(request.url).pathname.slice(
      "/webhooks/logs/".length,
    );
    try {
      const project = await ctx.runQuery(internal.projects.getInternal, {
        projectId: projectId as Id<"projects">,
      });
      if (!project?.enabled)
        return new Response("Unavailable", { status: 404 });
      const secret = await ctx.runAction(internal.settings.webhookSecret, {
        projectId: project._id,
      });
      if (!secret)
        return new Response("Webhook is not configured", { status: 503 });
      const body = await boundedBody(request);
      if (
        !(await verifySignature(
          body,
          request.headers.get("x-webhook-signature"),
          secret,
        ))
      )
        return new Response("Invalid signature", { status: 401 });
      const data: unknown = JSON.parse(body);
      if (!Array.isArray(data) || data.length > 1000)
        return new Response("Expected up to 1000 log events", { status: 400 });
      const events = await Promise.all(
        data.map((event) => normalizeEvent(event, "webhook")),
      );
      // Convex signs the raw body without a delivery timestamp. Bound replay age using event times.
      if (
        events.some(
          (e) =>
            e.timestamp < Date.now() - 24 * 3600_000 ||
            e.timestamp > Date.now() + 5 * 60_000,
        )
      )
        return new Response("Event outside accepted time window", {
          status: 400,
        });
      await ctx.runMutation(internal.records.ingest, {
        projectId: project._id,
        events,
        receipt: await digest(body),
      });
      return new Response("Accepted", { status: 202 });
    } catch {
      return new Response("Invalid or oversized log delivery", { status: 400 });
    }
  }),
});
export default http;
