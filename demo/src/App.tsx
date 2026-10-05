import { useCallback, useEffect, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import {
  ArrowUpRight,
  Check,
  Copy,
  Github,
  Package,
  TriangleAlert,
} from "lucide-react";
import { api } from "../convex/_generated/api";
import { demoVmDisplayName } from "../convex/session";
import { getBrowserSessionId, rotateBrowserSessionId } from "./browserSession";
import { VmTerminal } from "./VmTerminal";

type CopyState = "idle" | "copied" | "error";

const ONBOARD_URL = "https://convex.swerdlow.dev/onboard.md";
const ONBOARD_PROMPT = `Follow ${ONBOARD_URL}`;
const DEMO_TTL_MS = 5 * 60 * 1_000;

function formatMiB(value: number) {
  if (value < 1024) return `${value} MiB`;
  return `${value / 1024} GiB`;
}

function formatRemainingTime(remainingMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function App() {
  const [sessionId] = useState(getBrowserSessionId);
  const vm = useQuery(api.demo.status, { sessionId });
  const createVm = useAction(api.demo.create);
  const controlVm = useAction(api.demo.control);
  const createRequested = useRef(false);
  const hadRemoteVm = useRef(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [vmControlBusy, setVmControlBusy] = useState(false);
  const [vmControlError, setVmControlError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);

  const hasRemoteVm = Boolean(vm?.vmId);
  const remoteCreatedAt = vm?.remote?.createdAt;
  const expiresAt = remoteCreatedAt
    ? Date.parse(remoteCreatedAt) + DEMO_TTL_MS
    : null;
  const expiredByClock = expiresAt !== null && now >= expiresAt;
  const expiredByDeletion = vm === null && hadRemoteVm.current;
  const isExpired = expiredByClock || expiredByDeletion;
  const remainingMs = isExpired
    ? 0
    : expiresAt === null
      ? DEMO_TTL_MS
      : expiresAt - now;
  const timerLabel = formatRemainingTime(remainingMs);
  const remoteState =
    vm?.remote?.state ?? (hasRemoteVm ? vm!.phase : "not-created");
  const state = isExpired ? "expired" : remoteState;
  const resources = vm?.remote?.resources;
  const isRunning = !isExpired && remoteState === "running";
  const isPaused =
    !isExpired && (remoteState === "paused" || remoteState === "stopped");
  const isLoading = vm === undefined;
  const canProvision =
    !isExpired && !hasRemoteVm && (vm === null || Boolean(vm?.lastError));
  const vmControlLabel = isExpired
    ? "Reload"
    : canProvision
      ? "Retry"
      : isRunning
        ? "Pause"
        : isPaused
          ? "Resume"
          : "Pause";
  let statusLabel: string;
  if (isLoading) statusLabel = "Connecting";
  else if (isExpired) statusLabel = "Expired";
  else if (vm === null)
    statusLabel = vmControlError ? "Setup failed" : "Creating";
  else if (!hasRemoteVm)
    statusLabel = vm.lastError ? "Ready to retry" : "Ready to create";
  else statusLabel = remoteState.charAt(0).toUpperCase() + remoteState.slice(1);

  const provisionVm = useCallback(async () => {
    setVmControlBusy(true);
    setVmControlError(null);
    try {
      await createVm({ sessionId });
    } catch (error) {
      setVmControlError(error instanceof Error ? error.message : String(error));
    } finally {
      setVmControlBusy(false);
    }
  }, [createVm, sessionId]);

  useEffect(() => {
    if (vm !== null || createRequested.current) return;
    createRequested.current = true;
    void provisionVm();
  }, [provisionVm, vm]);

  useEffect(() => {
    if (hasRemoteVm) hadRemoteVm.current = true;
  }, [hasRemoteVm]);

  useEffect(() => {
    if (expiresAt === null || isExpired) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [expiresAt, isExpired]);

  async function copyOnboardPrompt() {
    try {
      await navigator.clipboard.writeText(ONBOARD_PROMPT);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }

    window.setTimeout(() => setCopyState("idle"), 1800);
  }

  async function toggleVmState() {
    if (!isRunning && !isPaused) return;

    setVmControlBusy(true);
    setVmControlError(null);
    try {
      await controlVm({
        operation: isRunning ? "pause" : "start",
        sessionId,
      });
    } catch (error) {
      setVmControlError(error instanceof Error ? error.message : String(error));
    } finally {
      setVmControlBusy(false);
    }
  }

  function reloadWithNewVm() {
    rotateBrowserSessionId();
    window.location.reload();
  }

  return (
    <div className="page-shell">
      <header className="site-nav">
        <a
          className="freestyle-brand"
          href="https://www.freestyle.sh"
          aria-label="Freestyle home"
        >
          <img src="/freestyle-logo.svg" alt="" />
          <span>Freestyle</span>
        </a>
        <div className="partnership" aria-label="Freestyle for Convex">
          <span className="plus">+</span>
          <img src="/convex-logo.svg?v=trimmed" alt="Convex" />
        </div>
        <nav className="nav-links" aria-label="Project links">
          <a
            href="https://www.npmjs.com/package/@freestyle-sh/convex"
            target="_blank"
            rel="noreferrer"
            aria-label="View @freestyle-sh/convex on npm"
            title="@freestyle-sh/convex on npm"
          >
            <Package size={17} />
          </a>
          <a
            href="https://github.com/freestyle-sh/convex"
            target="_blank"
            rel="noreferrer"
            aria-label="View the source on GitHub"
            title="Source on GitHub"
          >
            <Github size={17} />
          </a>
        </nav>
      </header>

      <main>
        <section className="hero">
          <h1>
            Full Linux VMs.
            <br />
            <em>
              One <strong className="convex-word">Convex</strong> action.
            </em>
          </h1>
          <button
            className={`install-command copy-${copyState}`}
            type="button"
            onClick={() => void copyOnboardPrompt()}
            aria-label="Copy the onboarding prompt"
          >
            <span className="copy-rails" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="command-text">{ONBOARD_PROMPT}</span>
            <span className="copy-feedback" aria-hidden="true">
              {copyState === "copied" ? (
                <Check size={14} />
              ) : copyState === "error" ? (
                <TriangleAlert size={14} />
              ) : (
                <Copy size={14} />
              )}
            </span>
            <span className="visually-hidden" aria-live="polite">
              {copyState === "copied"
                ? "Onboarding prompt copied"
                : copyState === "error"
                  ? "Could not copy onboarding prompt"
                  : ""}
            </span>
          </button>
        </section>

        <section
          className="live-demo"
          aria-label="Live Convex and Freestyle demo"
        >
          <div className="demo-control-stack">
            <div className="convex-panel">
              <div className="panel-topline">
                <div className="product-label">
                  <img src="/convex-symbol.svg" alt="" />
                  <div>
                    <strong>Convex action</strong>
                    <span>demo.ts · live</span>
                  </div>
                </div>
              </div>

              <div className="action-copy">
                <span className="mono-label">COMPONENT CALL</span>
                <code>
                  <b>await</b> freestyle.
                  <strong>{hasRemoteVm ? "start" : "create"}</strong>(ctx,
                  &#123; … &#125;)
                </code>
                <p>
                  The browser calls a Convex action. The component owns the VM
                  record and synchronizes every lifecycle change.
                </p>
              </div>
            </div>

            <div className="brand-rails" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>

            <div className="freestyle-panel">
              <table
                className="vm-resource-table"
                aria-label="Freestyle VM resources"
              >
                <tbody>
                  <tr>
                    <th scope="row">VM</th>
                    <td>{demoVmDisplayName(sessionId)}</td>
                  </tr>
                  <tr>
                    <th scope="row">State</th>
                    <td className={`resource-state state-${state}`}>
                      {statusLabel}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Image</th>
                    <td>freestyle/busybox</td>
                  </tr>
                  <tr>
                    <th scope="row">vCPU</th>
                    <td>{resources?.cpu ?? "Pending"}</td>
                  </tr>
                  <tr>
                    <th scope="row">Memory</th>
                    <td>
                      {resources ? formatMiB(resources.memory) : "Pending"}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Disk</th>
                    <td>
                      {resources ? formatMiB(resources.storage) : "Pending"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <VmTerminal
            enabled={isRunning}
            expired={isExpired}
            sessionId={sessionId}
            timerLabel={timerLabel}
            controlLabel={vmControlLabel}
            controlDisabled={
              vmControlBusy ||
              (!isExpired && !isRunning && !isPaused && !canProvision) ||
              isLoading
            }
            controlError={vmControlError}
            onControl={() =>
              void (isExpired
                ? reloadWithNewVm()
                : canProvision
                  ? provisionVm()
                  : toggleVmState())
            }
          />
        </section>

        <section className="how-it-works">
          <div>
            <span className="mono-label">OPEN SOURCE COMPONENT</span>
            <h2>Infrastructure that feels like application code.</h2>
            <p>
              Create, pause, resume, exec, resize, snapshot, and delete
              Freestyle VMs from Convex actions, with reactive state your UI can
              query.
            </p>
            <a
              href="https://github.com/freestyle-sh/convex"
              target="_blank"
              rel="noreferrer"
            >
              Read the source <ArrowUpRight size={15} />
            </a>
          </div>
          <pre>
            <code>
              <span className="token-purple">const</span> freestyle ={" "}
              <span className="token-purple">new</span>{" "}
              <span className="token-yellow">Freestyle</span>
              (components.freestyle);{"\n\n"}
              <span className="token-purple">export const</span> create =
              action({"{"}
              {"\n"} handler: <span className="token-purple">async</span> (ctx)
              ={">"} {"{"}
              {"\n"} <span className="token-purple">return await</span>{" "}
              freestyle.<span className="token-red">create</span>(ctx, {"{"}
              {"\n"} ownerId:{" "}
              <span className="token-string">"your-user-id"</span>,{"\n"} slug:{" "}
              <span className="token-string">"agent-workspace"</span>,{"\n"}{" "}
              snapshotId:{" "}
              <span className="token-string">"freestyle/busybox"</span>,{"\n"}{" "}
              firewall: {"{"} rules: [] {"}"},{"\n"} {"}"});{"\n"} {"}"},{"\n"}
              {"}"});
            </code>
          </pre>
        </section>
      </main>

      <footer className="site-footer">
        <div className="footer-brand">
          <img src="/freestyle-logo.svg" alt="" />
          <span>Freestyle</span>
          <span>×</span>
          <img
            className="footer-convex"
            src="/convex-logo.svg?v=trimmed"
            alt="Convex"
          />
        </div>
        <a
          href="https://www.freestyle.sh/docs"
          target="_blank"
          rel="noreferrer"
        >
          Docs <ArrowUpRight size={14} />
        </a>
      </footer>
    </div>
  );
}

export default App;
