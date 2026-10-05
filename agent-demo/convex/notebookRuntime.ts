"use node";
import { Freestyle } from "@freestyle-sh/convex";
import { Freestyle as FreestyleSdk } from "freestyle";
import { v, ConvexError } from "convex/values";
import { z } from "zod";
import { internalAction, type ActionCtx } from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { runtimeSettings } from "./lib/runtimeSettings";
import {
  notebookInput,
  parseNotebookResult,
  type NotebookResult,
} from "./lib/notebook";
import {
  kernelScript,
  installKernel,
  startKernel,
  kernelPreloads,
  kernelPreloadVersion,
} from "./lib/jupyterKernel";
import { redact } from "./lib/events";
import { openNotebookNetwork } from "./lib/notebookNetwork";
import { RouteNotReadyError } from "./lib/routeReadiness";
import type { NetworkOperation } from "./lib/notebookAccess";
import { requirePermission } from "./lib/policy";
import { notebookVmOptions } from "./lib/notebookLifecycle";
import { timings } from "./lib/timings";
import {
  notebookImageKey,
  missingSnapshot,
  kernelHealthCheck,
} from "./lib/notebookImage";

export const cleanup = internalAction({
  args: {
    notebookId: v.id("notebooks"),
    force: v.optional(v.boolean()),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, { notebookId, force, attempt = 0 }) => {
    const notebook = await ctx.runMutation(internal.notebooks.close, {
      notebookId,
      onlyIfExpired: !force,
    });
    if (!notebook) return;
    const project = await ctx.runQuery(internal.projects.getInternal, {
      projectId: notebook.projectId,
    });
    if (!project) return;
    const settings = await runtimeSettings(ctx, project);
    let state: "revoked" | "cleanup_pending" = "cleanup_pending";
    try {
      const managed = new Freestyle(components.freestyle, {
        apiKey: settings.freestyleKey,
      });
      await managed.delete(ctx, { ownerId: project._id, slug: notebook.slug });
      state = "revoked";
    } catch {
      await ctx.scheduler.runAfter(
        Math.min(3600000, 60000 * 2 ** Math.min(attempt, 6)),
        internal.notebookRuntime.cleanup,
        {
          notebookId,
          force: true,
          attempt: attempt + 1,
        },
      );
    }
    if (notebook.sandboxId)
      await ctx.runMutation(internal.records.sandboxState, {
        sandboxId: notebook.sandboxId,
        state,
      });
  },
});

type NotebookExecutionResult = NotebookResult & {
  sessionId: Id<"notebooks">;
  sessionReused: boolean;
  expiresAt: null;
  timeoutMs: number;
  totalDurationMs: number;
  networkResults?: { kind: string; state: string; successful: boolean }[];
};

export async function executeNotebook(
  ctx: ActionCtx,
  project: Doc<"projects">,
  input: z.infer<typeof notebookInput>,
  context: {
    events: unknown[];
    results: unknown[];
    artifact?: import("./lib/artifacts").ResultItem;
  },
  runId: Id<"runs">,
  access?: { requests: NetworkOperation[]; proposalId?: Id<"proposals"> },
): Promise<NotebookExecutionResult> {
  const timing = timings();
  const args = notebookInput.parse(input);
  requirePermission(project, "analyze");
  const settings = await runtimeSettings(ctx, project);
  if (!settings.freestyleKey)
    throw new ConvexError("Sandbox service is not configured.");
  const lock = crypto.randomUUID();
  const notebook = await ctx.runMutation(internal.notebooks.claim, {
    projectId: project._id,
    runId,
    lock,
  });
  const sdk = new FreestyleSdk({ apiKey: settings.freestyleKey });
  const managed = new Freestyle(components.freestyle, {
    apiKey: settings.freestyleKey,
  });
  let network: Awaited<ReturnType<typeof openNotebookNetwork>> | undefined;
  let close = true;
  let kernelMs: number | undefined;
  let response: NotebookExecutionResult | undefined;
  let imageReservation: string | undefined;
  let phase = "starting Jupyter";
  try {
    let vmId = notebook.vmId;
    if (!notebook.reused) {
      const imageKey = notebookImageKey(
        project.workspaceId ?? project._id,
        settings.freestyleKey,
        settings.snapshot,
      );
      let imageId = await ctx.runQuery(internal.notebookImages.get, {
        key: imageKey,
      });
      const sandboxId = await ctx.runMutation(internal.records.createSandbox, {
        projectId: project._id,
        runId,
        slug: notebook.slug,
        purpose: "Jupyter notebook",
        credentialRef: "none",
        endpoint:
          "Persistent Python notebook · credentials injected on granted network routes",
        expiresAt: notebook.expiresAt,
      });
      const createOptions = {
        ownerId: project._id,
        slug: notebook.slug,
        displayName: "Convex Monitor · Jupyter",
        snapshotId: imageId ?? settings.snapshot,
        ...notebookVmOptions,
        firewall: { rules: [] },
      };
      let created;
      try {
        created = await timing.measure("createSession", () =>
          managed.create(ctx, createOptions),
        );
      } catch (error) {
        if (!imageId || !missingSnapshot(error)) throw error;
        await ctx.runMutation(internal.notebookImages.invalidate, {
          key: imageKey,
          snapshotId: imageId,
        });
        imageId = null;
        created = await timing.measure("createSession", () =>
          managed.create(ctx, {
            ...createOptions,
            snapshotId: settings.snapshot,
          }),
        );
      }
      vmId = created.vm.id;
      await ctx.runMutation(internal.notebooks.activate, {
        notebookId: notebook._id,
        lock,
        vmId,
        sandboxId,
      });
      const vm = sdk.vms.ref(vmId);
      const restored =
        imageId &&
        (
          await timing.measure("restoreKernel", () =>
            vm.exec({ command: kernelHealthCheck, timeoutMs: 10000 }),
          )
        ).statusCode === 0;
      if (!restored) {
        if (
          !imageId &&
          (await ctx.runMutation(internal.notebookImages.reserve, {
            key: imageKey,
            lock,
          }))
        )
          imageReservation = imageKey;
        const installed = await vm.exec({
          command:
            "test -x /tmp/monitor-jupyter-venv/bin/python && /tmp/monitor-jupyter-venv/bin/python -c 'import ipykernel,jupyter_client,plotly,pandas,nbformat'",
          timeoutMs: 10000,
        });
        if (installed.statusCode !== 0) {
          phase = "installing the Jupyter runtime";
          const rules: string[] = [];
          try {
            for (const domain of ["pypi.org", "files.pythonhosted.org"]) {
              const rule = await sdk.tls.rules.create({
                action: "allow",
                domain,
                source: { vmId },
                destination: { public: true },
              });
              rules.push(rule.id);
            }
            const installed = await timing.measure("installKernel", () =>
              vm.exec({
                command: installKernel,
                timeoutMs: 150000,
              }),
            );
            if (installed.statusCode !== 0)
              throw new Error("Jupyter installation failed");
          } finally {
            // No agent-written code runs while package download routes exist.
            for (const id of rules) await sdk.tls.rules.delete(id);
          }
        }
        phase = "starting the notebook kernel";
        await vm.fs.writeTextFile("/tmp/monitor-jupyter.py", kernelScript);
        const ready = await timing.measure("startKernel", () =>
          vm.exec({ command: startKernel, timeoutMs: 45000 }),
        );
        if (ready.statusCode !== 0) throw new Error("Jupyter did not start");
      }
      if (imageReservation) {
        // Capture only the trusted, initialized kernel. No user code, context,
        // network routes or project credential has reached this VM yet.
        let snapshotId: string | undefined;
        try {
          const image = await timing.measure("snapshotKernel", () =>
            managed.snapshot(ctx, {
              ownerId: project._id,
              slug: notebook.slug,
              options: {
                displayName: "Workbench · clean Python runtime",
                autoDeleteSeconds: 7 * 86400,
              },
            }),
          );
          snapshotId = image.snapshotId;
          const saved = await ctx.runMutation(internal.notebookImages.publish, {
            key: imageReservation,
            lock,
            snapshotId,
          });
          if (!saved) await sdk.vms.snapshots.delete(snapshotId);
        } catch {
          // Snapshot failures should not prevent the authorized cell from
          // using its initialized kernel.
          if (snapshotId)
            await sdk.vms.snapshots.delete(snapshotId).catch(() => {});
          await ctx
            .runMutation(internal.notebookImages.abandon, {
              key: imageReservation,
              lock,
            })
            .catch(() => {});
          console.warn(
            "NOTEBOOK_IMAGE_UNAVAILABLE: continuing with the initialized kernel.",
          );
        }
        imageReservation = undefined;
      }
      await ctx.runMutation(internal.records.sandboxState, {
        sandboxId,
        state: "active",
      });
      await ctx.runMutation(internal.notebooks.preserve, {
        notebookId: notebook._id,
        lock,
      });
    } else {
      const identity = { ownerId: project._id, slug: notebook.slug };
      phase = "resuming the notebook";
      if (notebook.expiresAt !== undefined) {
        // Upgrade a live session in place before clearing its old cleanup deadline.
        await managed.update(ctx, { ...identity, options: notebookVmOptions });
        await ctx.runMutation(internal.notebooks.preserve, {
          notebookId: notebook._id,
          lock,
        });
      }
      const remote = await managed.refresh(ctx, identity);
      if (remote.vm.state === "paused") await managed.start(ctx, identity);
      else if (remote.vm.state !== "running")
        throw new Error("Notebook VM is no longer running or paused");
    }
    await ctx.runQuery(internal.notebooks.authorize, {
      notebookId: notebook._id,
      lock,
      runId,
    });
    if ((notebook.preloadVersion ?? 0) < kernelPreloadVersion) {
      if (notebook.reused) {
        // Initialize old, live kernels in place; restarting would discard their state.
        phase = "preloading notebook libraries";
        const vm = sdk.vms.ref(vmId!);
        const path = `/tmp/monitor-preloads-${lock}.json`;
        await vm.fs.writeTextFile(
          path,
          JSON.stringify({
            code: kernelPreloads,
            timeoutMs: 10000,
            context: {},
          }),
        );
        const prepared = await vm.exec({
          command: `curl --fail --silent --show-error --max-time 20 -H 'Content-Type: application/json' --data-binary @${path} http://127.0.0.1:8766/execute`,
          timeoutMs: 25000,
        });
        if (
          prepared.statusCode !== 0 ||
          parseNotebookResult(prepared.stdout ?? "").status !== "ok"
        )
          throw new Error("Notebook imports failed");
      }
      await ctx.runMutation(internal.notebooks.markPreloaded, {
        notebookId: notebook._id,
        lock,
        version: kernelPreloadVersion,
      });
      await ctx.runQuery(internal.notebooks.authorize, {
        notebookId: notebook._id,
        lock,
        runId,
      });
    }
    timing.phases.sessionReady = timing.elapsed();
    if (access?.requests.length) {
      phase = "opening approved network routes";
      network = await timing.measure("networkSetup", () =>
        openNotebookNetwork(
          ctx,
          project,
          vmId!,
          runId,
          access.requests,
          access.proposalId,
          notebook._id,
        ),
      );
      await ctx.runQuery(internal.notebooks.authorize, {
        notebookId: notebook._id,
        lock,
        runId,
      });
    }
    phase = "executing the notebook cell";
    const vm = sdk.vms.ref(vmId!);
    const payload = JSON.stringify({
      ...args,
      context: {
        ...context,
        network: network?.network ?? [],
        project: {
          name: project.name,
          deploymentUrl: project.deploymentUrl,
          cursor: project.cursor,
        },
      },
    });
    if (payload.length > 250000)
      throw new ConvexError(
        "Notebook context exceeds limit; summarize the data first.",
      );
    const path = `/tmp/monitor-cell-${lock}.json`;
    await timing.measure("writeCell", () => vm.fs.writeTextFile(path, payload));
    const execution = await timing.measure("executeCell", () =>
      vm.exec({
        command: `curl --fail --silent --show-error --max-time ${Math.ceil(args.timeoutMs / 1000) + 35} -H 'Content-Type: application/json' --data-binary @${path} http://127.0.0.1:8766/execute`,
        timeoutMs: args.timeoutMs + 40000,
      }),
    );
    if (execution.statusCode !== 0)
      throw new Error("Notebook transport failed");
    // Treat every byte from the guest as untrusted, including MIME metadata.
    const result = parseNotebookResult(execution.stdout ?? "");
    kernelMs = result.durationMs;
    result.stdout = redact(result.stdout, 12000);
    result.stderr = redact(result.stderr, 12000);
    result.text = redact(result.text, 12000);
    close = result.status === "timeout";
    response = {
      ...result,
      networkResults: network
        ? await timing.measure("receipts", () => network!.receipts())
        : [],
      sessionId: notebook._id,
      sessionReused: notebook.reused,
      expiresAt: null,
      timeoutMs: args.timeoutMs,
      totalDurationMs: 0,
    };
    return response;
  } catch (error) {
    if (error instanceof RouteNotReadyError) {
      close = false;
      throw new ConvexError(
        error.message +
          " Your existing notebook is preserved. No project operation was retried.",
      );
    }
    if (error instanceof ConvexError) throw error;
    throw new ConvexError(
      `Notebook failed while ${phase}. The session has been closed; a new cell will start a fresh kernel. No project operation was retried.`,
    );
  } finally {
    if (imageReservation)
      await ctx
        .runMutation(internal.notebookImages.abandon, {
          key: imageReservation,
          lock,
        })
        .catch(() => {});
    await timing.measure("networkCleanup", async () => {
      await network?.close({ defer: true });
    });
    try {
      await timing.measure("releaseSession", () =>
        ctx.runMutation(internal.notebooks.release, {
          notebookId: notebook._id,
          lock,
          close,
        }),
      );
    } finally {
      if (close)
        await ctx.runAction(internal.notebookRuntime.cleanup, {
          notebookId: notebook._id,
          force: true,
        });
      if (response) response.totalDurationMs = timing.elapsed();
      console.info(
        "NOTEBOOK_TIMING " +
          JSON.stringify({
            runId,
            reused: notebook.reused,
            totalMs: timing.elapsed(),
            kernelMs,
            phases: timing.phases,
            network: network?.timing.phases,
          }),
      );
    }
  }
}
