import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx, ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";

export async function workspaceTokenHash(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new ConvexError(
      "Workspace unavailable. Reopen Convex Monitor in your original browser.",
    );
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function requireWorkspace(
  ctx: QueryCtx | ActionCtx,
  token: string,
): Promise<Id<"workspaces">> {
  if (!("db" in ctx))
    return ctx.runQuery(internal.workspaces.authorize, { token });
  const tokenHash = await workspaceTokenHash(token);
  const workspace = await ctx.db
    .query("workspaces")
    .withIndex("by_token", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!workspace)
    throw new ConvexError(
      "Workspace unavailable. Reopen Convex Monitor in your original browser.",
    );
  return workspace._id;
}
export async function authorizedProject(
  ctx: QueryCtx,
  token: string,
  projectId: Id<"projects">,
) {
  const workspaceId = await requireWorkspace(ctx, token);
  const project = await ctx.db.get(projectId);
  if (!project || project.workspaceId !== workspaceId)
    throw new ConvexError("Project not found in this workspace.");
  return project;
}
