"use node";
import { Freestyle } from "@freestyle-sh/convex";
import {
  Freestyle as FreestyleSdk,
  type CreateVmOptions,
  type JsonPatchValue,
} from "freestyle";
import { components, internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  deploymentOrigin,
  parseArgs,
  requireFunction,
  requirePermission,
} from "./policy";
import { redact } from "./events";
import { acquireCredential } from "./toolCredential";
import { runtimeSettings } from "./runtimeSettings";
import { ConvexError } from "convex/values";
import { normalizeDocumentPatch, patchFields } from "./documentPatch";
import { normalizeOperation } from "./operations";

export type Grant =
  | { kind: "logs"; cursor: number }
  | {
      kind: "query" | "mutation" | "action";
      functionPath: string;
      argsJson: string;
    }
  | { kind: "functions" }
  | { kind: "tables"; argsJson: string }
  | { kind: "inlineQuery"; argsJson: string }
  | { kind: "documentPatch"; argsJson: string }
  | { kind: "analysis"; code: string; data: unknown };
export function grantRequest(
  project: Doc<"projects">,
  grant: Exclude<Grant, { kind: "analysis" }>,
) {
  const origin = deploymentOrigin(project.deploymentUrl);
  const path =
    grant.kind === "logs"
      ? "/api/stream_function_logs"
      : grant.kind === "inlineQuery"
        ? "/api/run_test_function"
        : grant.kind === "functions" || grant.kind === "tables"
          ? "/api/query"
          : `/api/${grant.kind === "documentPatch" ? "mutation" : grant.kind}`;
  const method = grant.kind === "logs" ? "GET" : "POST";
  const patch =
    grant.kind === "documentPatch"
      ? normalizeDocumentPatch(parseArgs(grant.argsJson))
      : undefined;
  const body: Record<string, unknown> | undefined =
    grant.kind === "logs"
      ? undefined
      : grant.kind === "documentPatch"
        ? {
            path: "_system/frontend/patchDocumentsFields",
            args: {
              table: patch!.table,
              ids: [patch!.id],
              fields: patchFields(patch!),
              componentId: null,
            },
            format: "json",
          }
        : grant.kind === "inlineQuery"
          ? {
              args: {},
              format: "convex_encoded_json",
              bundle: {
                path: "testQuery.js",
                source:
                  'import { query } from "convex:/_system/repl/wrappers.js";\nexport default query({handler: async (ctx) => {\n' +
                  parseArgs(grant.argsJson).code +
                  "\n}});",
              },
            }
          : {
              path:
                grant.kind === "functions"
                  ? "_system/cli/modules:apiSpec"
                  : grant.kind === "tables"
                    ? "_system/cli/tables"
                    : grant.functionPath,
              args:
                grant.kind === "functions"
                  ? {}
                  : grant.kind === "tables"
                    ? {
                        paginationOpts: {
                          cursor: JSON.parse(
                            normalizeOperation("tables", "", grant.argsJson)
                              .argsJson,
                          ).cursor,
                          numItems: 1000,
                        },
                      }
                    : parseArgs(grant.argsJson),
              format: "json",
            };
  return {
    origin,
    path,
    method,
    body,
    url: `${origin}${path}${grant.kind === "logs" ? `?cursor=${grant.cursor}` : ""}`,
  };
}
// One credential class per job. Never upgrade or reuse a VM that ran agent-written code.
export async function executeGrant(
  ctx: ActionCtx,
  project: Doc<"projects">,
  grant: Grant,
  runId?: Id<"runs">,
  proposalId?: Id<"proposals">,
): Promise<unknown> {
  if (proposalId) {
    if (grant.kind === "analysis")
      throw new Error("Invalid approved operation.");
    const approved = await ctx.runQuery(internal.approvals.authorizeExecution, {
      proposalId,
      projectId: project._id,
    });
    const requested = normalizeOperation(
      grant.kind,
      "functionPath" in grant ? grant.functionPath : "",
      grant.kind === "logs"
        ? JSON.stringify({ cursor: grant.cursor })
        : grant.kind === "functions"
          ? "{}"
          : grant.argsJson,
    );
    if (
      approved.kind !== requested.kind ||
      approved.functionPath !== requested.functionPath ||
      approved.argsJson !== requested.argsJson
    )
      throw new Error("The operation differs from the user approval.");
  } else if (
    grant.kind === "mutation" ||
    grant.kind === "action" ||
    grant.kind === "documentPatch"
  )
    throw new Error("This operation requires a user approval.");
  else if (
    grant.kind === "functions" ||
    grant.kind === "tables" ||
    grant.kind === "inlineQuery"
  )
    requirePermission(project, "runQueries");
  else if (grant.kind === "logs") requirePermission(project, "readLogs");
  else if (grant.kind === "analysis") requirePermission(project, "analyze");
  else requireFunction(project, grant.kind, grant.functionPath);
  const settings = await runtimeSettings(ctx, project);
  if (project.workspaceId && !settings.freestyleKey)
    throw new Error("Add your Freestyle API key in Settings → Agent services.");
  // Validate the endpoint and arguments before issuing authority.
  const request =
    grant.kind === "analysis" ? undefined : grantRequest(project, grant);
  const lease =
    project.connectionId && grant.kind !== "analysis"
      ? await acquireCredential(
          ctx,
          project,
          grant.kind as Exclude<Grant, { kind: "analysis" }>["kind"],
          proposalId,
        )
      : undefined;
  try {
    const prefix = project.keyPrefix;
    const credentialRef = lease
      ? lease.name
      : grant.kind === "analysis"
        ? "none"
        : `${prefix}_${grant.kind === "mutation" || grant.kind === "documentPatch" ? "WRITE" : grant.kind === "action" ? "ACTION" : grant.kind === "query" || grant.kind === "functions" || grant.kind === "tables" || grant.kind === "inlineQuery" ? "QUERY" : "LOGS"}_KEY`;
    const credential =
      lease?.key ??
      (grant.kind === "analysis" ? undefined : process.env[credentialRef]);
    if (grant.kind !== "analysis" && !credential)
      throw new Error(`Missing backend credential: ${credentialRef}`);
    const slug = `convex-monitor-${crypto.randomUUID()}`;
    const managed = new Freestyle(components.freestyle, {
      apiKey: settings.freestyleKey,
    });
    const sdk = new FreestyleSdk({ apiKey: settings.freestyleKey });
    const identity = { ownerId: project._id, slug };
    const sandboxId = await ctx.runMutation(internal.records.createSandbox, {
      projectId: project._id,
      runId,
      slug,
      purpose: grant.kind,
      credentialRef,
      endpoint: request
        ? `${request.method} ${request.origin}${request.path}`
        : "No network access",
      expiresAt: Date.now() + 180_000,
    });
    const tls: CreateVmOptions["tls"] = request
      ? {
          rules: [
            {
              action: "allow",
              domain: new URL(request.origin).hostname,
              source: {},
              destination: { public: true },
              match: {
                method: [request.method],
                path: { exact: request.path },
              },
              transform: [
                { headers: { Authorization: `Convex ${credential}` } },
                // Pin the entire JSON body at the edge, including function and arguments.
                ...(request.body
                  ? [
                      {
                        jsonPatch: [
                          {
                            op: "replace" as const,
                            path: "",
                            value: (grant.kind === "inlineQuery"
                              ? { ...request.body, adminKey: credential }
                              : request.body) as JsonPatchValue,
                          },
                        ],
                      },
                    ]
                  : []),
              ],
            },
          ],
        }
      : undefined;
    let phase = "starting the VM";
    try {
      const created = await managed.create(ctx, {
        ...identity,
        displayName: `Convex Monitor · ${grant.kind}`,
        snapshotId: settings.snapshot,
        ttlSeconds: 180,
        idleTimeoutSeconds: 90,
        autoDeleteSeconds: 0,
        firewall: { rules: [] },
      });
      if (tls) {
        phase = "installing the scoped TLS grant";
        for (const rule of tls.rules)
          await sdk.tls.rules.create({
            ...rule,
            source: { vmId: created.vm.id },
          });
      }
      phase = "executing the sandbox request";
      await ctx.runMutation(internal.records.sandboxState, {
        sandboxId,
        state: "active",
      });
      let script: string;
      if (grant.kind === "analysis") {
        if (grant.code.length > 12_000)
          throw new Error("Analysis code exceeds limit.");
        script = `import json\ndata = json.loads(${JSON.stringify(JSON.stringify(grant.data))})\n${grant.code}`;
      } else {
        // No credential, header, or secret-bearing environment variable is sent to exec.
        script = `import json, urllib.request, ssl\nclass NoRedirect(urllib.request!.HTTPRedirectHandler):\n def redirect_request(self, *args, **kwargs): return None\nreq = urllib.request!.Request(${JSON.stringify(request!.url)}, data=${request!.body ? `json.dumps(json.loads(${JSON.stringify(JSON.stringify(request!.body))})).encode()` : "None"}, headers={"Content-Type":"application/json"}, method=${JSON.stringify(request!.method)})\nclient = urllib.request!.build_opener(NoRedirect, urllib.request!.HTTPSHandler(context=ssl.create_default_context(cafile="/etc/ssl/certs/ca-certificates.crt")))\nwith client.open(req, timeout=75) as response:\n raw=response.read(262145)\n if len(raw)>262144: raise Exception("Response exceeds 256 KiB; use the log webhook for high volume deployments")\n print(raw.decode())`;
      }
      // Execute against the VM returned by the component. The component's exec
      // wrapper currently forwards `options` into its identity-only lookup.
      const result = await sdk.vms.ref(created.vm.id).exec({
        command: `python3 -c '${script.replaceAll("'", "'\\''")}'`,
        timeoutMs: 90_000,
      });
      if (result.statusCode !== 0) {
        // Classify fixed diagnostics; never echo provider output or log contents.
        const stderr = result.stderr ?? "";
        const http = stderr.match(/HTTPError: HTTP Error (\d{3})/);
        const detail = http
          ? `The deployment returned HTTP ${http[1]}.`
          : stderr.includes("CERTIFICATE_VERIFY_FAILED")
            ? "The sandbox could not verify the TLS certificate."
            : /timed out|TimeoutError/.test(stderr)
              ? "The deployment request timed out."
              : /Name or service not known|Temporary failure in name resolution/.test(
                    stderr,
                  )
                ? "The sandbox could not resolve the deployment hostname."
                : "Check the configured snapshot and project access.";
        throw new ConvexError(`${grant.kind} sandbox failed. ${detail}`);
      }
      const output = result.stdout ?? "";
      if (output.length > 262_144)
        throw new Error("Sandbox output exceeds limit.");
      phase = "decoding the deployment response";
      return grant.kind === "analysis"
        ? redact(output).slice(0, 12_000)
        : JSON.parse(output);
    } catch (error) {
      if (error instanceof ConvexError) throw error;
      const status = (error as { status?: unknown })?.status;
      const detail =
        typeof status === "number" &&
        Number.isInteger(status) &&
        status >= 400 &&
        status <= 599
          ? ` (HTTP ${status})`
          : "";
      throw new ConvexError(
        `Sandbox failed while ${phase}${detail}. Check Agent services and project access.`,
      );
    } finally {
      // VM deletion also removes its TLS grants. Hard TTL covers action interruption.
      try {
        await managed.delete(ctx, identity);
        await ctx.runMutation(internal.records.sandboxState, {
          sandboxId,
          state: "revoked",
        });
      } catch {
        await ctx.runMutation(internal.records.sandboxState, {
          sandboxId,
          state: "cleanup_pending",
        });
      }
    }
  } finally {
    if (lease)
      await ctx.runAction(internal.connections.cleanupLease, {
        leaseId: lease.leaseId,
      });
  }
}
