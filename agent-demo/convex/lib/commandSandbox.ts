"use node";
import { Freestyle } from "@freestyle-sh/convex";
import { Freestyle as FreestyleSdk, type JsonPatchValue } from "freestyle";
import { ConvexError } from "convex/values";
import { components, internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  commandInput,
  projectProxyScript,
  type CommandInput,
  type CommandResult,
} from "./command";
import { grantRequest } from "./sandbox";
import { requireFunction, requirePermission } from "./policy";
import { runtimeSettings } from "./runtimeSettings";
import { acquireCredential } from "./toolCredential";
import { redact, type LogEvent } from "./events";

export async function executeCommand(
  ctx: ActionCtx,
  project: Doc<"projects">,
  input: CommandInput,
  evidence: LogEvent[],
  runId: Id<"runs">,
): Promise<CommandResult> {
  const args = commandInput.parse(input);
  if (args.access === "none") requirePermission(project, "analyze");
  else if (args.access === "logs") requirePermission(project, "readLogs");
  else requireFunction(project, "query", args.functionPath ?? "");
  const request =
    args.access === "none"
      ? undefined
      : grantRequest(
          project,
          args.access === "logs"
            ? { kind: "logs", cursor: project.cursor }
            : {
                kind: "query",
                functionPath: args.functionPath!,
                argsJson: args.argsJson ?? "{}",
              },
        );
  const settings = await runtimeSettings(ctx, project);
  if (!settings.freestyleKey)
    throw new ConvexError("Sandbox service is not configured.");
  const lease =
    request && project.connectionId
      ? await acquireCredential(ctx, project, args.access as "logs" | "query")
      : undefined;
  const sandboxes: Array<{
    identity: { ownerId: string; slug: string };
    id: Id<"sandboxes">;
  }> = [];
  const managed = new Freestyle(components.freestyle, {
    apiKey: settings.freestyleKey,
  });
  const sdk = new FreestyleSdk({ apiKey: settings.freestyleKey });
  let phase = "preparing the sandbox";
  try {
    const credentialRef =
      lease?.name ??
      (request
        ? `${project.keyPrefix}_${args.access === "logs" ? "LOGS" : "QUERY"}_KEY`
        : "none");
    const credential = request
      ? (lease?.key ?? process.env[credentialRef])
      : undefined;
    if (request && !credential)
      throw new ConvexError("The requested project credential is unavailable.");
    async function create(purpose: string, endpoint: string, keyRef: string) {
      const identity = {
        ownerId: project._id,
        slug: `convex-monitor-${crypto.randomUUID()}`,
      };
      const id = await ctx.runMutation(internal.records.createSandbox, {
        projectId: project._id,
        runId,
        slug: identity.slug,
        purpose,
        endpoint,
        credentialRef: keyRef,
        expiresAt: Date.now() + 180000,
      });
      sandboxes.push({ identity, id });
      const created = await managed.create(ctx, {
        ...identity,
        displayName: `Convex Monitor · ${purpose}`,
        snapshotId: settings.snapshot,
        ttlSeconds: 180,
        idleTimeoutSeconds: 90,
        autoDeleteSeconds: 0,
        firewall: { rules: [] },
      });
      await ctx.runMutation(internal.records.sandboxState, {
        sandboxId: id,
        state: "active",
      });
      return sdk.vms.ref(created.vm.id);
    }
    const shell = await create(
      "exec",
      request
        ? "One granted Convex read operation via isolated proxy"
        : "No network access",
      "none",
    );
    // Context files contain observations and public routing metadata, never credentials.
    await shell.fs.writeTextFile(
      "/tmp/convex-monitor-project.json",
      JSON.stringify({
        name: project.name,
        deploymentUrl: project.deploymentUrl,
        permissions: project.permissions,
        allowedQueries: project.allowedQueries,
        allowedMutations: project.allowedMutations,
      }),
    );
    await shell.fs.writeTextFile(
      "/tmp/convex-monitor-evidence.json",
      JSON.stringify(evidence),
    );
    const env: Record<string, string> = {
      MONITOR_PROJECT_FILE: "/tmp/convex-monitor-project.json",
      MONITOR_EVIDENCE_FILE: "/tmp/convex-monitor-evidence.json",
      SSL_CERT_FILE: "/etc/ssl/certs/ca-certificates.crt",
      REQUESTS_CA_BUNDLE: "/etc/ssl/certs/ca-certificates.crt",
      NODE_EXTRA_CA_CERTS: "/etc/ssl/certs/ca-certificates.crt",
    };
    if (request) {
      phase = "preparing the granted project request";
      const proxy = await create(
        "exec access",
        `${request.method} ${request.url}`,
        credentialRef,
      );
      await sdk.tls.rules.create({
        action: "allow",
        domain: new URL(request.origin).hostname,
        source: { vmId: proxy.id },
        destination: { public: true },
        match: { method: [request.method], path: { exact: request.path } },
        transform: [
          { headers: { Authorization: `Convex ${credential}` } },
          ...(request.body
            ? [
                {
                  jsonPatch: [
                    {
                      op: "replace" as const,
                      path: "",
                      value: request.body as JsonPatchValue,
                    },
                  ],
                },
              ]
            : []),
        ],
      });
      await proxy.fs.writeTextFile(
        "/tmp/convex-monitor-proxy.py",
        projectProxyScript(request),
      );
      const ready = await proxy.exec({
        command:
          'python3 /tmp/convex-monitor-proxy.py </dev/null >/tmp/convex-monitor-proxy.log 2>&1 &\npython3 -c \'import socket,time\nfor attempt in range(50):\n try:\n  socket.create_connection(("127.0.0.1",8765),timeout=0.1).close(); break\n except OSError: time.sleep(0.1)\nelse: raise RuntimeError("Proxy did not start")\'',
        timeoutMs: 10000,
      });
      if (ready.statusCode !== 0)
        throw new ConvexError("The project request proxy could not start.");
      await sdk.tls.rules.create({
        action: "allow",
        domain: "convex-project.internal",
        source: { vmId: shell.id },
        destination: { vmId: proxy.id, port: 8765 },
      });
      env.CONVEX_REQUEST_URL = "https://convex-project.internal/request";
      env.CONVEX_REQUEST_METHOD = request.method;
    }
    phase = "running the command";
    const started = Date.now();
    const result = await shell.exec({
      command: args.command,
      timeoutMs: args.timeoutMs,
      env,
    });
    const stdout = result.stdout ?? "",
      stderr = result.stderr ?? "";
    const clean = (value: string) =>
      redact(
        credential
          ? value.split(credential).join("[credential redacted]")
          : value,
      );
    if (result.statusCode === undefined)
      throw new ConvexError("The sandbox returned no command exit status.");
    return {
      stdout: clean(stdout),
      stderr: clean(stderr),
      exitCode: result.statusCode,
      timedOut: result.statusCode === null,
      durationMs: Date.now() - started,
      timeoutMs: args.timeoutMs,
      outputTruncated: stdout.length > 4000 || stderr.length > 4000,
    };
  } catch (error) {
    if (error instanceof ConvexError) throw error;
    throw new ConvexError(
      `Sandbox failed while ${phase}. Check project access and sandbox availability.`,
    );
  } finally {
    for (const sandbox of sandboxes.reverse()) {
      let state: "revoked" | "cleanup_pending" = "cleanup_pending";
      try {
        await managed.delete(ctx, sandbox.identity);
        state = "revoked";
      } catch {
        /* TTL bounds a failed deletion. */
      }
      // A recording failure must not skip deletion of another VM or key revocation.
      await ctx
        .runMutation(internal.records.sandboxState, {
          sandboxId: sandbox.id,
          state,
        })
        .catch(() => {});
    }
    if (lease)
      await ctx.runAction(internal.connections.cleanupLease, {
        leaseId: lease.leaseId,
      });
  }
}
