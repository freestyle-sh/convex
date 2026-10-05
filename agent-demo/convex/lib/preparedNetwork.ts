"use node";
import { Freestyle } from "@freestyle-sh/convex";
import { Freestyle as FreestyleSdk } from "freestyle";
import { components, internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { OperationKind } from "./operations";
import { runtimeSettings } from "./runtimeSettings";
import { acquireCredential } from "./toolCredential";
import { projectProxyScript, startProjectProxy } from "./command";
import { deploymentOrigin } from "./policy";
import {
  deleteNetworkResources,
  type NetworkResources,
} from "./networkCleanup";

export const readKinds: OperationKind[] = [
  "tables",
  "functions",
  "query",
  "inlineQuery",
  "logs",
];

export async function prepareReadBundle(
  ctx: ActionCtx,
  project: Doc<"projects">,
  notebookId: Id<"notebooks">,
  kind: OperationKind,
): Promise<Doc<"networkBundles">> {
  const reservation = await ctx.runMutation(internal.networkBundles.reserve, {
    notebookId,
    kind,
  });
  if (!reservation.create) return reservation.bundle;
  const bundle = reservation.bundle;
  const resources: NetworkResources = {
    projectId: project._id,
    routeIds: [],
    leaseIds: [],
    relays: [{ slug: bundle.slug }],
  };
  try {
    const settings = await runtimeSettings(ctx, project);
    const sdk = new FreestyleSdk({ apiKey: settings.freestyleKey });
    const managed = new Freestyle(components.freestyle, {
      apiKey: settings.freestyleKey,
    });
    const lease = await acquireCredential(ctx, project, kind);
    resources.leaseIds.push(lease.leaseId);
    await ctx.runMutation(internal.networkBundles.prepared, {
      bundleId: bundle._id,
      leaseId: lease.leaseId,
    });
    const sandboxId = await ctx.runMutation(internal.records.createSandbox, {
      projectId: project._id,
      slug: bundle.slug,
      purpose: `Prepared ${kind} request`,
      credentialRef: lease.name,
      endpoint: "Dormant until an authorized notebook request",
      expiresAt: bundle.expiresAt,
    });
    resources.relays[0].sandboxId = sandboxId;
    await ctx.runMutation(internal.networkBundles.prepared, {
      bundleId: bundle._id,
      sandboxId,
    });
    const created = await managed.create(ctx, {
      ownerId: project._id,
      slug: bundle.slug,
      displayName: "Convex Monitor · prepared read",
      snapshotId: settings.snapshot,
      ttlSeconds: 180,
      idleTimeoutSeconds: 180,
      autoDeleteSeconds: 0,
      firewall: { rules: [] },
    });
    await ctx.runMutation(internal.networkBundles.prepared, {
      bundleId: bundle._id,
      vmId: created.vm.id,
    });
    const relay = sdk.vms.ref(created.vm.id);
    const outbound = await sdk.tls.rules.create({
      action: "allow",
      domain: new URL(deploymentOrigin(project.deploymentUrl)).hostname,
      source: { vmId: relay.id },
      destination: { public: true },
      match: {
        method: [kind === "logs" ? "GET" : "POST"],
        path: {
          exact:
            kind === "logs"
              ? "/api/stream_function_logs"
              : kind === "inlineQuery"
                ? "/api/run_test_function"
                : "/api/query",
        },
      },
      // The trusted relay fixes the entire request when armed. It never runs
      // notebook code or accepts a client-selected body, URL, or credential.
      transform: [
        { headers: { Authorization: `Convex ${lease.key}` } },
        ...(kind === "inlineQuery"
          ? [
              {
                jsonPatch: [
                  { op: "add" as const, path: "/adminKey", value: lease.key },
                ],
              },
            ]
          : []),
      ],
    });
    resources.routeIds.push(outbound.id);
    await ctx.runMutation(internal.networkBundles.prepared, {
      bundleId: bundle._id,
      routeId: outbound.id,
    });
    await relay.fs.writeTextFile("/tmp/monitor-proxy.py", projectProxyScript());
    const started = await relay.exec({
      command: startProjectProxy,
      timeoutMs: 10000,
    });
    if (started.statusCode !== 0)
      throw new Error("Prepared network relay did not start.");
    const inbound = await sdk.tls.rules.create({
      action: "allow",
      domain: bundle.domain,
      source: { vmId: bundle.notebookVmId },
      destination: { vmId: relay.id, port: 8765 },
    });
    resources.routeIds.push(inbound.id);
    await ctx.runMutation(internal.networkBundles.prepared, {
      bundleId: bundle._id,
      routeId: inbound.id,
    });
    await ctx.runMutation(internal.records.sandboxState, {
      sandboxId,
      state: "active",
    });
    await ctx.runMutation(internal.networkBundles.prepared, {
      bundleId: bundle._id,
      ready: true,
    });
    return (await ctx.runQuery(internal.networkBundles.get, {
      bundleId: bundle._id,
    }))!;
  } catch (error) {
    // Preserve even a provider resource whose registration failed. Schedule a
    // second cleanup using the in-memory IDs; the reservation also has a watchdog.
    try {
      await ctx.scheduler.runAfter(
        0,
        internal.networkBundleRuntime.cleanupResources,
        { resources },
      );
    } catch {
      await deleteNetworkResources(ctx, resources);
    }
    await ctx.runMutation(internal.networkBundles.retire, {
      bundleId: bundle._id,
    });
    throw error;
  }
}

export async function takeReadBundle(
  ctx: ActionCtx,
  project: Doc<"projects">,
  notebookId: Id<"notebooks">,
  vmId: string,
  runId: Id<"runs">,
  kind: OperationKind,
) {
  let bundle = await prepareReadBundle(ctx, project, notebookId, kind);
  // Another action may already be warming this slot. Join that preparation
  // briefly instead of issuing a duplicate set of slow TLS-rule writes.
  const deadline = Date.now() + 10_000;
  while (bundle.state === "preparing" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const current = await ctx.runQuery(internal.networkBundles.get, {
      bundleId: bundle._id,
    });
    if (!current) return null;
    bundle = current;
  }
  const claimed = await ctx.runMutation(internal.networkBundles.claim, {
    bundleId: bundle._id,
    runId,
    notebookVmId: vmId,
  });
  if (claimed) {
    // Refill this slot while the current cell and subsequent model step run.
    try {
      await ctx.scheduler.runAfter(0, internal.networkBundleRuntime.warm, {
        runId,
        kinds: [kind],
      });
    } catch {
      /* A missing spare must not invalidate the claimed request. */
    }
  }
  return claimed;
}
