import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import type { Conversation, Detail, Project } from "../types";

export function SidebarIndicators({
  project,
  conversations,
  detail,
  onProject,
  onActivity,
}: {
  project?: Project;
  conversations: Conversation[];
  detail: Detail;
  onProject: () => void;
  onActivity: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (!project) return null;
  const expired =
    typeof project.tokenExpiresAt === "number" && project.tokenExpiresAt <= now;
  const expiresSoon =
    typeof project.tokenExpiresAt === "number" &&
    project.tokenExpiresAt > now &&
    project.tokenExpiresAt - now < 7 * 86_400_000;
  const connected = project.connectionStatus === "connected";
  const connection = !connected
    ? "Not connected"
    : !project.enabled
      ? "Paused"
      : expired
        ? "Token expired"
        : expiresSoon
          ? "Token expires soon"
          : "Connected";
  const dot =
    !connected || !project.enabled
      ? "bg-zinc-400"
      : expired
        ? "bg-red-500"
        : expiresSoon
          ? "bg-amber-500"
          : "bg-emerald-500";
  const pending = project.enabled
    ? detail.proposals.filter(
        (p) =>
          p.state === "pending" &&
          p.expiresAt > now &&
          p.policyVersion === project.policyVersion,
      ).length
    : 0;
  const running = conversations.filter(
    (c) => c.state === "running" || c.state === "queued",
  ).length;
  const errors = detail.logs.filter((log) =>
    /^(error|critical|fatal)$/i.test(log.level),
  ).length;
  const failed = detail.runs.filter((run) => run.state === "failed").length;
  const activity = pending
    ? `${pending} approval${pending === 1 ? "" : "s"}`
    : running
      ? `${running} running`
      : errors
        ? `${errors} log errors`
        : failed
          ? `${failed} failed run${failed === 1 ? "" : "s"}`
          : "Activity";
  const row =
    "flex min-h-8 w-full justify-start gap-3 rounded-lg px-2 text-left text-xs text-ink-3 transition-colors hover:bg-hover hover:text-ink";
  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={onProject}
        className={row}
        aria-label={`Project settings: ${connection}`}
        title={`${connection} · Project settings`}
      >
        <span className="grid size-4 shrink-0 place-items-center">
          <span className={`size-1.5 rounded-full ${dot}`} />
        </span>
        <span className="sidebar-detail min-w-0 truncate">{connection}</span>
      </button>
      <button
        type="button"
        onClick={onActivity}
        className={row}
        aria-label={`View activity: ${activity}`}
        title={
          errors && !pending && !running
            ? `${errors} errors in captured project logs`
            : activity
        }
      >
        <Activity
          size={16}
          className={`shrink-0 ${pending || running ? "text-accent-plum" : errors || failed ? "text-red-500" : ""} ${running ? "animate-pulse" : ""}`}
        />
        <span className="sidebar-detail min-w-0 truncate">{activity}</span>
      </button>
    </div>
  );
}
