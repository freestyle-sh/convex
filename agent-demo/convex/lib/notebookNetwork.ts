"use node";
import { Freestyle } from "@freestyle-sh/convex";
import { Freestyle as FreestyleSdk, type JsonPatchValue } from "freestyle";
import { components, internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { runtimeSettings } from "./runtimeSettings";
import { acquireCredential } from "./toolCredential";
import { grantRequest, executeGrant } from "./sandbox";
import { projectProxyScript, startProjectProxy } from "./command";
import { takeReadBundle } from "./preparedNetwork";
import { normalizeDocumentPatch, unchangedFields } from "./documentPatch";
import { isReadOnly } from "./operations";
import {
  hasStandingAccess,
  normalizeRequests,
  type NetworkOperation,
} from "./notebookAccess";
import { normalizeEvent } from "./events";
import { timings } from "./timings";
import { ensureRouteReady } from "./routeReadiness";

// The untrusted notebook only receives public routing information. A separate
// Python relay pins each request and consumes it before forwarding any bytes.
// Only that relay's outbound TLS route receives an injected credential.
export async function openNotebookNetwork(
  ctx: ActionCtx,
  project: Doc<"projects">,
  vmId: string,
  runId: Id<"runs">,
  input: NetworkOperation[],
  proposalId?: Id<"proposals">,
  notebookId?: Id<"notebooks">,
) {
  const timing = timings();
  const requests = normalizeRequests(input);
  const settings = await runtimeSettings(ctx, project);
  const sdk = new FreestyleSdk({ apiKey: settings.freestyleKey });
  const managed = new Freestyle(components.freestyle, {
    apiKey: settings.freestyleKey,
  });
  const routes: string[] = [];
  const leases: Id<"credentialLeases">[] = [];
  const preparedRoutes = new Set<string>();
  const preparedLeases = new Set<Id<"credentialLeases">>();
  const relays: {
    slug: string;
    sandboxId: Id<"sandboxes">;
    vmId?: string;
    kind: string;
    bundleId?: Id<"networkBundles">;
  }[] = [];
  const network: {
    url: string;
    method: string;
    kind: string;
    functionPath: string;
  }[] = [];
  async function close(options: { defer?: boolean } = {}) {
    if (options.defer) {
      // Seal even unused grants before returning. This is a small trusted FS
      // write, not a slow edge-rule deletion. The relay cannot be reopened by
      // notebook code. If sealing/scheduling fails, fall back to deletion below.
      const sealed = await timing.measure("sealRelays", () =>
        Promise.allSettled(
          relays
            .filter((r) => r.vmId)
            .map((r) =>
              sdk.vms
                .ref(r.vmId!)
                .fs.writeTextFile("/tmp/monitor-request-closed", "closed"),
            ),
        ),
      );
      try {
        await timing.measure("scheduleCleanup", async () => {
          await Promise.all(
            relays
              .filter((r) => r.bundleId)
              .map((r) =>
                ctx.runMutation(internal.networkBundles.retire, {
                  bundleId: r.bundleId!,
                }),
              ),
          );
          const transient = relays.filter((r) => !r.bundleId);
          if (transient.length)
            await ctx.scheduler.runAfter(
              0,
              internal.networkBundleRuntime.cleanupResources,
              {
                resources: {
                  projectId: project._id,
                  routeIds: routes.filter((id) => !preparedRoutes.has(id)),
                  leaseIds: leases.filter((id) => !preparedLeases.has(id)),
                  relays: transient.map((r) => ({
                    slug: r.slug,
                    sandboxId: r.sandboxId,
                  })),
                },
              },
            );
        });
        if (sealed.every((r) => r.status === "fulfilled")) return;
      } catch {
        /* Fail closed if we cannot seal or durably hand off cleanup. */
      }
    }
    // Try every cleanup even when one provider operation fails. VM TTL and
    // scheduled lease revocation bound provider/control-plane failures.
    await timing.measure("deleteRoutes", () =>
      Promise.allSettled(routes.map((id) => sdk.tls.rules.delete(id))),
    );
    await timing.measure("deleteRelays", () =>
      Promise.allSettled(
        relays.map(async (relay) => {
          let state: "revoked" | "cleanup_pending" = "cleanup_pending";
          try {
            await managed.delete(ctx, {
              ownerId: project._id,
              slug: relay.slug,
            });
            state = "revoked";
          } finally {
            await ctx.runMutation(internal.records.sandboxState, {
              sandboxId: relay.sandboxId,
              state,
            });
          }
        }),
      ),
    );
    await timing.measure("revokeKeys", () =>
      Promise.allSettled(
        leases.map((leaseId) =>
          ctx.runAction(internal.connections.cleanupLease, { leaseId }),
        ),
      ),
    );
  }
  async function receipts() {
    const results = [];
    for (const relay of relays) {
      const response = await sdk.vms.ref(relay.vmId!).exec({
        command: "cat /tmp/monitor-request-receipt.json 2>/dev/null || true",
        timeoutMs: 5000,
      });
      const receipt = response.stdout?.trim()
        ? JSON.parse(response.stdout)
        : { state: "unused" };
      let body;
      try {
        body = JSON.parse(receipt.body);
      } catch {
        /* Report no successful response. */
      }
      const successful =
        receipt.state === "complete" &&
        receipt.status === 200 &&
        (relay.kind === "logs"
          ? Array.isArray(body?.entries)
          : body?.status === "success");
      if (
        successful &&
        relay.kind === "logs" &&
        Number.isFinite(body.newCursor)
      ) {
        await ctx.runMutation(internal.records.ingest, {
          projectId: project._id,
          cursor: body.newCursor,
          events: await Promise.all(
            body.entries
              .slice(0, 1000)
              .map((entry: unknown) => normalizeEvent(entry, "poll")),
          ),
        });
      }
      results.push({ kind: relay.kind, state: receipt.state, successful });
    }
    return results;
  }
  try {
    for (const [index, operation] of requests.entries()) {
      if (proposalId) {
        const approved = await ctx.runQuery(
          internal.approvals.authorizeExecution,
          { proposalId, projectId: project._id, requestIndex: index },
        );
        if (
          approved.kind !== operation.kind ||
          approved.functionPath !== operation.functionPath ||
          approved.argsJson !== operation.argsJson
        )
          throw new Error("The operation differs from the approved request.");
      } else if (!hasStandingAccess(project, operation))
        throw new Error("This operation requires a user approval.");
      if (operation.kind === "documentPatch") {
        const patch = normalizeDocumentPatch(JSON.parse(operation.argsJson));
        const checked = (await executeGrant(
          ctx,
          project,
          {
            kind: "inlineQuery",
            argsJson: JSON.stringify({
              code: `const id = ctx.db.normalizeId(${JSON.stringify(patch.table)}, ${JSON.stringify(patch.id)}); return id ? await ctx.db.get(id) : null;`,
            }),
          },
          runId,
        )) as { status?: string; value?: unknown };
        if (
          checked?.status !== "success" ||
          !unchangedFields(patch, checked.value)
        )
          throw new Error(
            "No document patch attempted. The document changed or could not be checked. Read it again before proposing another edit.",
          );
      }
      const request = grantRequest(
        project,
        operation.kind === "logs"
          ? { kind: "logs", cursor: JSON.parse(operation.argsJson).cursor }
          : operation,
      );
      if (notebookId && isReadOnly(operation.kind)) {
        const bundle = await timing.measure("preparedRoutes", () =>
          takeReadBundle(ctx, project, notebookId, vmId, runId, operation.kind),
        );
        if (bundle?.vmId && bundle.sandboxId && bundle.leaseId) {
          // Keep resource IDs for synchronous fallback cleanup too.
          routes.push(...bundle.routeIds);
          leases.push(bundle.leaseId);
          bundle.routeIds.forEach((id) => preparedRoutes.add(id));
          preparedLeases.add(bundle.leaseId);
          relays.push({
            slug: bundle.slug,
            sandboxId: bundle.sandboxId,
            vmId: bundle.vmId,
            kind: operation.kind,
            bundleId: bundle._id,
          });
          await timing.measure("routeReadiness", () =>
            ensureRouteReady(sdk.vms.ref(vmId), bundle.domain, () =>
              sdk.tls.rules.update(
                bundle.routeIds[bundle.routeIds.length - 1],
                {
                  action: "allow",
                  domain: bundle.domain,
                  source: { vmId },
                  destination: { vmId: bundle.vmId!, port: 8765 },
                },
              ),
            ),
          );
          await timing.measure("armRelays", () =>
            sdk.vms
              .ref(bundle.vmId!)
              .fs.writeTextFile(
                "/tmp/monitor-request-config.json",
                JSON.stringify(request),
              ),
          );
          network.push({
            url: `https://${bundle.domain}/request`,
            method: request.method,
            kind: operation.kind,
            functionPath: operation.functionPath,
          });
          continue;
        }
      }
      const lease = await timing.measure("mintKeys", () =>
        acquireCredential(
          ctx,
          project,
          operation.kind,
          proposalId,
          proposalId ? index : undefined,
        ),
      );
      leases.push(lease.leaseId);
      const slug = `convex-network-${crypto.randomUUID()}`;
      const sandboxId = await ctx.runMutation(internal.records.createSandbox, {
        projectId: project._id,
        runId,
        slug,
        purpose: "Python network request",
        credentialRef: lease.name,
        endpoint: `${request.method} ${request.url}`,
        expiresAt: Date.now() + 180000,
      });
      const relay = {
        slug,
        sandboxId,
        vmId: undefined as string | undefined,
        kind: operation.kind,
      };
      relays.push(relay);
      const created = await timing.measure("createRelays", () =>
        managed.create(ctx, {
          ownerId: project._id,
          slug,
          displayName: "Convex Monitor · Python network",
          snapshotId: settings.snapshot,
          ttlSeconds: 180,
          idleTimeoutSeconds: 180,
          autoDeleteSeconds: 0,
          firewall: { rules: [] },
        }),
      );
      relay.vmId = created.vm.id;
      const proxy = sdk.vms.ref(relay.vmId);
      const injectedBody =
        request.body &&
        (operation.kind === "inlineQuery"
          ? { ...request.body, adminKey: lease.key }
          : request.body);
      const edge = await timing.measure("injectionRules", () =>
        sdk.tls.rules.create({
          action: "allow",
          domain: new URL(request.origin).hostname,
          source: { vmId: proxy.id },
          destination: { public: true },
          match: { method: [request.method], path: { exact: request.path } },
          transform: [
            { headers: { Authorization: `Convex ${lease.key}` } },
            ...(injectedBody
              ? [
                  {
                    jsonPatch: [
                      {
                        op: "replace" as const,
                        path: "",
                        value: injectedBody as JsonPatchValue,
                      },
                    ],
                  },
                ]
              : []),
          ],
        }),
      );
      routes.push(edge.id);
      await timing.measure("writeRelays", () =>
        proxy.fs.writeTextFile(
          "/tmp/monitor-proxy.py",
          projectProxyScript(request),
        ),
      );
      const ready = await timing.measure("startRelays", () =>
        proxy.exec({
          command: startProjectProxy,
          timeoutMs: 10000,
        }),
      );
      if (ready.statusCode !== 0)
        throw new Error("Network relay did not start.");
      const domain = `request-${crypto.randomUUID()}.monitor.internal`;
      const route = await timing.measure("notebookRoutes", () =>
        sdk.tls.rules.create({
          action: "allow",
          domain,
          source: { vmId },
          destination: { vmId: proxy.id, port: 8765 },
        }),
      );
      routes.push(route.id);
      await timing.measure("routeReadiness", () =>
        ensureRouteReady(sdk.vms.ref(vmId), domain, () =>
          sdk.tls.rules.update(route.id, {
            action: "allow",
            domain,
            source: { vmId },
            destination: { vmId: proxy.id, port: 8765 },
          }),
        ),
      );
      network.push({
        url: `https://${domain}/request`,
        method: request.method,
        kind: operation.kind,
        functionPath: operation.functionPath,
      });
      await ctx.runMutation(internal.records.sandboxState, {
        sandboxId,
        state: "active",
      });
    }
    return { network, receipts, close, timing };
  } catch (error) {
    await close();
    throw error;
  }
}
