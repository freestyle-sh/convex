import { useState, type FormEvent } from "react";
import { useAction } from "convex/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Database,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { api } from "../convex/_generated/api";
import type { RemoteProject, RemoteDeployment } from "../convex/lib/platform";
import { Modal } from "./Modal";
import { connectionError } from "./errors";
import type { Project } from "./types";
import type { Id } from "../convex/_generated/dataModel";
import {
  connectDeployments,
  type DeploymentResult,
} from "./connectDeployments";

const primary =
  "min-h-10 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700";
export function ConnectProject({
  token,
  close,
  connected,
  sources = [],
}: {
  token: string;
  close: () => void;
  connected: (id: string) => void;
  sources?: Project[];
}) {
  const discover = useAction(api.connections.discover);
  const deployments = useAction(api.connections.deployments);
  const connect = useAction(api.connections.connect);
  const [accessToken, setAccessToken] = useState("");
  const [step, setStep] = useState<"token" | "project" | "deployment">("token");
  const [projects, setProjects] = useState<RemoteProject[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [project, setProject] = useState<RemoteProject>();
  const [targets, setTargets] = useState<RemoteDeployment[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [sourceProjectId, setSourceProjectId] = useState<string>();
  const [results, setResults] = useState<Record<string, DeploymentResult>>({});
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function perform(label: string, operation: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError("");
    try {
      await operation();
    } catch (e) {
      setError(connectionError(e));
    } finally {
      setBusy("");
    }
  }
  const access = (source = sourceProjectId) =>
    source
      ? { sourceProjectId: source as Id<"projects"> }
      : { accessToken: accessToken.trim() };
  async function findProjects(
    e?: FormEvent,
    cursor?: string,
    source = sourceProjectId,
  ) {
    e?.preventDefault();
    await perform("Checking your Convex access…", async () => {
      const result = await discover({
        token,
        ...access(source),
        ...(cursor ? { cursor } : {}),
      });
      setProjects((ps) =>
        cursor
          ? [
              ...ps,
              ...result.projects.filter(
                (p) => !ps.some((existing) => existing.id === p.id),
              ),
            ]
          : result.projects,
      );
      setNextCursor(result.nextCursor);
      setStep("project");
    });
  }
  const pending = selected.filter(
    (name) => results[name]?.state !== "connected",
  );
  const successes = Object.values(results).filter(
    (r) => r.state === "connected",
  );
  return (
    <Modal title="Connect Convex" close={busy ? () => {} : close}>
      <ol
        className="mb-6 flex items-center gap-3 text-xs text-zinc-400"
        aria-label="Connection steps"
      >
        {["Authorize", "Project", "Deployments"].map((name, i) => {
          const current = ["token", "project", "deployment"].indexOf(step);
          return (
            <li
              key={name}
              className={`flex items-center gap-2 ${current >= i ? "text-zinc-900" : ""}`}
              aria-current={current === i ? "step" : undefined}
            >
              <span
                className={`grid size-5 place-items-center rounded-full text-[10px] ${current >= i ? "bg-zinc-900 text-white" : "bg-zinc-100"}`}
              >
                {current > i ? <Check size={12} /> : i + 1}
              </span>
              {name}
              {i < 2 && (
                <ChevronRight size={12} className="ml-1 text-zinc-300" />
              )}
            </li>
          );
        })}
      </ol>
      {step === "token" && (
        <form onSubmit={(e) => void findProjects(e)}>
          {sources.some(
            (p) => p.enabled && p.connectionStatus === "connected",
          ) && (
            <div className="mb-5">
              <p className="mb-2 text-xs font-medium text-zinc-500">
                Use saved Convex access
              </p>
              <div className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200">
                {sources
                  .filter(
                    (p) => p.enabled && p.connectionStatus === "connected",
                  )
                  .map((p) => (
                    <button
                      type="button"
                      key={p._id}
                      disabled={!!busy}
                      className="w-full justify-between px-4 py-3 text-left text-sm hover:bg-zinc-50"
                      onClick={() => {
                        setSourceProjectId(p._id);
                        setAccessToken("");
                        void findProjects(undefined, undefined, p._id);
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <ShieldCheck size={15} className="text-zinc-400" />
                        <span className="truncate">{p.name}</span>
                      </span>
                      <ChevronRight size={15} className="text-zinc-400" />
                    </button>
                  ))}
              </div>
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                Choose more deployments without pasting your token again.
              </p>
            </div>
          )}
          <div className="mb-5 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <KeyRound size={16} /> Connect your existing projects
            </div>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Create a team access token in Convex under{" "}
              <span className="font-medium text-zinc-800">
                Team Settings → Access Tokens
              </span>
              . Monitor will find the projects you can access.
            </p>
            <a
              href="https://dashboard.convex.dev/"
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline"
            >
              Open Convex dashboard <ExternalLink size={12} />
            </a>
          </div>
          <label>
            Team access token
            <input
              type="password"
              name="convex-access-token"
              required
              autoComplete="off"
              spellCheck={false}
              value={accessToken}
              onChange={(e) => {
                setAccessToken(e.target.value);
                setSourceProjectId(undefined);
                setError("");
              }}
              placeholder="Paste your Convex team access token"
              disabled={!!busy}
              maxLength={8192}
            />
          </label>
          <p className="mt-3 text-xs leading-5 text-zinc-500">
            Saved securely after verification. This token lets Monitor provision
            scoped keys; it is never sent to the model or a sandbox. A
            deployment key won’t work here.
          </p>
          <button
            className={`${primary} mt-5 w-full`}
            disabled={!!busy || !accessToken.trim()}
          >
            {busy ? <LoaderCircle size={16} className="animate-spin" /> : null}
            {busy || "Find my projects"}
            {!busy && <ArrowRight size={15} />}
          </button>
        </form>
      )}
      {step === "project" && (
        <>
          <h3 className="text-sm">Choose a project</h3>
          <p className="mt-1 text-sm text-zinc-500">
            Existing projects in your connected Convex team.
          </p>
          <label className="mt-4">
            <span className="sr-only">Search projects</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects…"
            />
          </label>
          <div
            className="my-3 max-h-64 space-y-1 overflow-y-auto"
            aria-label="Convex projects"
          >
            {projects
              .filter((p) =>
                `${p.name} ${p.slug}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((p) => (
                <button
                  key={p.id}
                  disabled={!!busy}
                  className="group w-full justify-start rounded-xl border border-transparent p-3 text-left hover:border-zinc-200 hover:bg-zinc-50"
                  onClick={() =>
                    void perform("Loading deployments…", async () => {
                      const result = await deployments({
                        token,
                        ...access(),
                        remoteProjectId: p.id,
                      });
                      setProject(result.project);
                      setTargets(result.deployments);
                      setSelected([]);
                      setResults({});
                      setStep("deployment");
                    })
                  }
                >
                  <span className="grid size-10 place-items-center rounded-lg border border-zinc-200 bg-surface">
                    <Database size={18} className="text-zinc-500" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {p.name}
                    </span>
                    <span className="block truncate text-xs text-zinc-500">
                      {p.teamSlug} / {p.slug}
                    </span>
                  </span>
                  <ChevronRight size={16} className="text-zinc-400" />
                </button>
              ))}
            {!projects.length && (
              <p className="rounded-xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-500">
                No projects are available for this token. Choose another team or
                create a project in Convex, then refresh.
              </p>
            )}
            {!!projects.length &&
              !projects.some((p) =>
                `${p.name} ${p.slug}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              ) && (
                <p className="p-4 text-sm text-zinc-500">
                  No matching projects in the loaded results.
                </p>
              )}
          </div>
          {nextCursor && (
            <button
              disabled={!!busy}
              className="w-full py-2 text-sm text-blue-600"
              onClick={() => void findProjects(undefined, nextCursor)}
            >
              Load more projects
            </button>
          )}
          <div className="mt-4 flex justify-between">
            <button
              disabled={!!busy}
              className="text-xs text-zinc-500"
              onClick={() => {
                setStep("token");
                setAccessToken("");
                setSourceProjectId(undefined);
                setError("");
              }}
            >
              <ArrowLeft size={13} /> Change access
            </button>
            <button
              className="text-xs text-zinc-500"
              disabled={!!busy}
              onClick={() => void findProjects()}
            >
              Refresh projects
            </button>
          </div>
        </>
      )}
      {step === "deployment" && (
        <>
          <h3 className="text-sm">{project?.name}</h3>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            Choose the deployments Monitor should investigate. Select one or
            more.
          </p>
          <div className="mt-4 mb-2 flex items-center justify-between text-xs">
            <span className="text-zinc-500">{selected.length} selected</span>
            {targets.length > 1 && (
              <button
                type="button"
                disabled={!!busy}
                className="rounded px-1 py-0.5 font-medium text-zinc-600 hover:text-zinc-950"
                onClick={() =>
                  setSelected(
                    selected.length === targets.length
                      ? targets
                          .filter((d) => results[d.name]?.state === "connected")
                          .map((d) => d.name)
                      : targets.map((d) => d.name),
                  )
                }
              >
                {selected.length === targets.length
                  ? "Clear selection"
                  : "Select all"}
              </button>
            )}
          </div>
          <div
            className="mb-4 max-h-80 divide-y divide-zinc-100 overflow-y-auto rounded-xl border border-zinc-200"
            role="group"
            aria-label="Deployments"
          >
            {targets.map((d) => {
              const result = results[d.name];
              const checked = selected.includes(d.name);
              const label =
                d.deploymentType === "prod"
                  ? "Production"
                  : d.deploymentType === "dev"
                    ? "Development"
                    : d.deploymentType === "preview"
                      ? "Preview"
                      : d.deploymentType;
              return (
                <div key={d.name}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={`${label}: ${d.name}`}
                    disabled={!!busy || result?.state === "connected"}
                    onClick={() =>
                      setSelected((names) =>
                        names.includes(d.name)
                          ? names.filter((name) => name !== d.name)
                          : [...names, d.name],
                      )
                    }
                    className={`w-full justify-start gap-3 px-4 py-3.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:outline-none focus-visible:ring-inset disabled:opacity-100 ${checked ? "bg-zinc-100/80" : "bg-surface hover:bg-zinc-50"}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`grid size-4 shrink-0 place-items-center rounded border ${checked ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-surface"}`}
                    >
                      {checked && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-zinc-900">
                        {label}
                      </span>
                      <span
                        className="mt-0.5 block truncate text-xs text-zinc-500"
                        title={d.deploymentUrl}
                      >
                        {d.name}
                      </span>
                    </span>
                    {result?.state === "connecting" ? (
                      <LoaderCircle
                        size={15}
                        className="animate-spin text-zinc-500"
                      />
                    ) : result?.state === "connected" ? (
                      <span className="text-xs font-medium text-emerald-700">
                        Connected
                      </span>
                    ) : d.deploymentType === "prod" ? (
                      <span className="rounded-md bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700">
                        PROD
                      </span>
                    ) : null}
                  </button>
                  {result?.state === "error" && (
                    <p
                      role="alert"
                      className="px-4 pb-3 text-xs leading-5 text-red-600"
                    >
                      {result.message}
                    </p>
                  )}
                </div>
              );
            })}
            {!targets.length && (
              <p className="p-4 text-sm leading-6 text-zinc-500">
                No cloud deployments found. Deploy this project to Convex, then
                return and refresh. Local deployments aren’t supported.
              </p>
            )}
          </div>
          <div className="rounded-xl border border-zinc-200 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck size={16} /> Starts with read-only log access
            </div>
            <p className="mt-2 text-xs leading-5 text-zinc-500">
              For each deployment, we’ll create a temporary logs-only key, check
              access, and remove the key. Once connected, each tool gets a fresh
              scoped key. Queries and approved writes can be enabled later.
            </p>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <button
              disabled={!!busy}
              className="text-xs text-zinc-500"
              onClick={() => {
                setStep("project");
                setError("");
              }}
            >
              <ArrowLeft size={13} /> Projects
            </button>
            <div className="flex items-center gap-3">
              {!!successes.length && !busy && (
                <button
                  type="button"
                  className={
                    pending.length
                      ? "text-sm font-medium text-zinc-600"
                      : primary
                  }
                  onClick={() => {
                    setAccessToken("");
                    connected(successes[0].projectId);
                    close();
                  }}
                >
                  Done
                </button>
              )}
              {(!!pending.length || !successes.length) && (
                <button
                  className={primary}
                  disabled={!!busy || !pending.length}
                  onClick={() =>
                    void perform("Verifying deployments…", async () => {
                      await connectDeployments(
                        pending,
                        async (deploymentName) => {
                          const target = targets.find(
                            (d) => d.name === deploymentName,
                          )!;
                          const existing =
                            sourceProjectId &&
                            sources.find(
                              (p) =>
                                p.connectionStatus === "connected" &&
                                p.deploymentUrl === target.deploymentUrl,
                            );
                          if (existing) return existing._id;
                          return connect({
                            token,
                            ...access(),
                            remoteProjectId: project!.id,
                            deploymentName,
                          });
                        },
                        (name, result) =>
                          setResults((current) => ({
                            ...current,
                            [name]: result,
                          })),
                      );
                    })
                  }
                >
                  {busy ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <ShieldCheck size={16} />
                  )}
                  {busy
                    ? "Connecting…"
                    : `Connect ${pending.length || ""} deployment${pending.length === 1 ? "" : "s"}`}
                </button>
              )}
            </div>
          </div>
        </>
      )}
      {!!busy && step !== "token" && (
        <p className="mt-3 text-xs text-zinc-500" role="status">
          {busy}
          {step === "deployment" &&
            " Quiet deployments can take a little over a minute to verify."}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700"
        >
          {error}
        </p>
      )}
    </Modal>
  );
}
