import { useState, type FormEvent } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { WebhookSettings } from "./WorkspaceSettings";
import { connectionError } from "./errors";
import type { Project, Configuration } from "./types";
import { TokenExpiry } from "./TokenExpiry";
type ConfigurationProps = {
  project: Project;
  token: string;
  reconnect: () => void;
  close: () => void;
  save: (config: Configuration, id?: string) => Promise<void>;
};

export function ConfigurationForm({
  project,
  token,
  reconnect,
  close,
  save,
}: ConfigurationProps) {
  const [config, setConfig] = useState<Configuration>(project);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const set = <K extends keyof Configuration>(
    key: K,
    value: Configuration[K],
  ) => setConfig((c) => ({ ...c, [key]: value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { deploymentOrigin, keyPrefix, functionPath } =
        await import("../convex/lib/policy");
      deploymentOrigin(config.deploymentUrl);
      keyPrefix(config.keyPrefix);
      config.allowedQueries.forEach(functionPath);
      config.allowedMutations.forEach(functionPath);
      const {
        name,
        deploymentUrl,
        keyPrefix: prefix,
        permissions,
        allowedQueries,
        allowedMutations,
        intervalMinutes,
        enabled,
      } = config;
      await save(
        {
          name,
          deploymentUrl,
          keyPrefix: prefix,
          permissions: {
            ...permissions,
            readLogs: true,
            runQueries: true,
            analyze: true,
          },
          allowedQueries,
          allowedMutations,
          intervalMinutes,
          enabled,
        },
        project._id,
      );
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <form onSubmit={submit}>
        <div>
          <label>
            Project name
            <input
              required
              maxLength={80}
              value={config.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Acme storefront"
            />
          </label>
        </div>
        <p
          className="mt-2 truncate text-xs text-zinc-400"
          title={project.deploymentUrl}
        >
          {new URL(project.deploymentUrl).hostname}
        </p>
        <p className="my-4 text-xs leading-5 text-zinc-500">
          Reads are allowed. Writes require your approval.
        </p>
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-zinc-50 px-3 py-2.5 text-xs font-medium text-zinc-700">
          Connection enabled
          <input
            type="checkbox"
            disabled={project.connectionStatus === "disconnected"}
            checked={config.enabled}
            onChange={(e) => set("enabled", e.target.checked)}
            className="m-0! size-3.5! accent-zinc-900"
          />
        </label>
        {error && (
          <p
            className="error mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700"
            role="alert"
          >
            {error}
          </p>
        )}
        <div className="mt-4 flex items-center justify-end gap-3">
          <button
            className="min-h-9 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-700"
            disabled={busy}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
      {project.connectionId && (
        <ConnectionStatus
          project={project}
          token={token}
          reconnect={reconnect}
          close={close}
        />
      )}
      <WebhookSettings project={project} token={token} />
    </>
  );
}

function ConnectionStatus({
  project,
  token,
  reconnect,
  close,
}: {
  project: Project;
  token: string;
  reconnect: () => void;
  close: () => void;
}) {
  const disconnect = useMutation(api.connectionStore.disconnect);
  const checkLogs = useAction(api.connectionChecks.logs);
  const refreshExpiry = useAction(api.connections.refreshTokenExpiry);
  const [refreshingExpiry, setRefreshingExpiry] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState("");
  const [error, setError] = useState("");
  return (
    <details className="mt-4 border-t border-zinc-100 pt-3">
      <summary className="cursor-pointer text-xs font-medium text-zinc-600">
        Connection details
      </summary>
      <p className="mt-3 text-xs font-medium">
        {project.connectionStatus === "connected"
          ? "Connected"
          : "Project disconnected"}
      </p>
      <p className="mt-1 text-xs leading-5 text-zinc-500">
        {project.connectionStatus === "connected"
          ? `Verified ${new Date(project.verifiedAt!).toLocaleString()}.`
          : "Reconnect to verify access and resume this project’s conversations."}
      </p>
      {project.connectionStatus === "connected" && (
        <div className="mt-3 border-t border-zinc-200 pt-3">
          <div className="mb-3 flex items-start justify-between gap-3">
            <TokenExpiry
              expiresAt={project.tokenExpiresAt}
              checkedAt={project.tokenExpiryCheckedAt}
            />
            <button
              type="button"
              disabled={refreshingExpiry || !project.enabled}
              className="shrink-0 text-xs font-medium text-zinc-600 hover:text-zinc-950"
              onClick={async () => {
                setRefreshingExpiry(true);
                setError("");
                try {
                  const expiry = await refreshExpiry({
                    token,
                    sourceProjectId: project._id as Id<"projects">,
                  });
                  if (expiry.expiresAt === undefined)
                    setError(
                      "Convex did not return an expiry. Any date shown is the last known value; check Team Settings → Access Tokens.",
                    );
                } catch (e) {
                  setError(connectionError(e));
                } finally {
                  setRefreshingExpiry(false);
                }
              }}
            >
              {refreshingExpiry ? "Checking…" : "Refresh expiry"}
            </button>
          </div>
          <button
            type="button"
            disabled={busy || checking || !project.enabled}
            className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-xs font-medium text-zinc-800 disabled:opacity-50"
            onClick={async () => {
              setChecking(true);
              setError("");
              setCheckResult("");
              try {
                const result = await checkLogs({
                  token,
                  projectId: project._id as Id<"projects">,
                });
                setCheckResult(
                  `Log access works through Freestyle. ${result.entries} recent log entries returned.`,
                );
              } catch (e) {
                setError(connectionError(e));
              } finally {
                setChecking(false);
              }
            }}
          >
            {checking ? "Checking log access…" : "Test log access"}
          </button>
          <p role="status" className="mt-2 text-xs leading-5 text-zinc-500">
            {checkResult ||
              (checking
                ? "Starting a temporary sandbox. A quiet deployment can take a little over a minute."
                : "")}
          </p>
        </div>
      )}
      <div className="mt-3 flex justify-between gap-4">
        <button
          type="button"
          className="text-xs font-medium text-blue-600"
          disabled={busy || checking}
          onClick={reconnect}
        >
          {project.connectionStatus === "connected"
            ? "Replace connection token"
            : "Reconnect project"}
        </button>
        {project.connectionStatus === "connected" && (
          <button
            type="button"
            disabled={busy || checking}
            className="text-xs text-red-600"
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await disconnect({
                  token,
                  projectId: project._id as Id<"projects">,
                });
                close();
              } catch (e) {
                setError(connectionError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Disconnecting…" : "Disconnect project"}
          </button>
        )}
      </div>
      {error && (
        <p className="mt-3 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
