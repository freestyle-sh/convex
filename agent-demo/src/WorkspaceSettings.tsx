import { useState, type FormEvent, type ReactNode } from "react";
import { useAction, useQuery } from "convex/react";
import { Check, LoaderCircle } from "lucide-react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { Project } from "./types";
import { Modal } from "./Modal";
import { connectionError } from "./errors";
import { ModelPicker, providerName } from "./ModelPicker";
import type { ModelChoice } from "../convex/lib/models";
import { useGatewayAccess } from "./useGatewayAccess";

const button =
  "min-h-9 shrink-0 whitespace-nowrap rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-700";
export type SettingsSection = "model" | "project" | "activity";
export function WorkspaceSettings({
  token,
  close,
  initialModel,
  heldMessage,
  onReady,
  projectSettings,
  activity,
  initialSection = "model",
}: {
  token: string;
  initialModel?: ModelChoice;
  close: () => void;
  heldMessage?: string;
  onReady?: (model: ModelChoice) => Promise<void>;
  projectSettings?: ReactNode;
  activity?: ReactNode;
  initialSection?: SettingsSection;
}) {
  const settings = useQuery(api.workspaces.settings, { token });
  const tabs: SettingsSection[] = [
    "model",
    ...(projectSettings ? ["project" as const] : []),
    ...(activity ? ["activity" as const] : []),
  ];
  const [section, setSection] = useState<SettingsSection>(
    onReady || !tabs.includes(initialSection) ? "model" : initialSection,
  );
  return (
    <Modal
      title={
        onReady
          ? "Configure model provider"
          : projectSettings || activity
            ? "Settings"
            : "Model settings"
      }
      close={close}
      compact
    >
      {tabs.length > 1 && !onReady && (
        <div
          className="mb-4 flex gap-1 border-b border-zinc-100"
          role="tablist"
          aria-label="Settings"
        >
          {tabs.map((tab, index) => (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`settings-tab-${tab}`}
              aria-selected={section === tab}
              aria-controls={`settings-panel-${tab}`}
              tabIndex={section === tab ? 0 : -1}
              onClick={() => setSection(tab)}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? tabs[0]
                    : event.key === "End"
                      ? tabs[tabs.length - 1]
                      : tabs[
                          (index +
                            (event.key === "ArrowRight"
                              ? 1
                              : tabs.length - 1)) %
                            tabs.length
                        ];
                setSection(next);
                document.getElementById(`settings-tab-${next}`)?.focus();
              }}
              className={`border-b-2 px-3 py-2 text-xs font-medium transition-colors ${section === tab ? "border-zinc-800 text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800"}`}
            >
              {tab === "model"
                ? "Model"
                : tab === "project"
                  ? "Project"
                  : "Activity"}
            </button>
          ))}
        </div>
      )}
      <div
        hidden={section !== "model"}
        id="settings-panel-model"
        role={tabs.length > 1 ? "tabpanel" : undefined}
        aria-labelledby={tabs.length > 1 ? "settings-tab-model" : undefined}
      >
        {!settings ? (
          <p className="text-sm text-zinc-500">Loading settings…</p>
        ) : (
          <ServiceForm
            token={token}
            settings={settings}
            initialModel={initialModel}
            heldMessage={heldMessage}
            onReady={onReady}
          />
        )}
      </div>
      {projectSettings && (
        <div
          hidden={section !== "project"}
          id="settings-panel-project"
          role="tabpanel"
          aria-labelledby="settings-tab-project"
        >
          {projectSettings}
        </div>
      )}
      {activity && (
        <div
          hidden={section !== "activity"}
          id="settings-panel-activity"
          role="tabpanel"
          aria-labelledby="settings-tab-activity"
        >
          {activity}
        </div>
      )}
    </Modal>
  );
}
function ServiceForm({
  token,
  settings,
  initialModel,
  heldMessage,
  onReady,
}: {
  initialModel?: ModelChoice;
  heldMessage?: string;
  onReady?: (model: ModelChoice) => Promise<void>;
  token: string;
  settings: {
    hasOpenRouterKey: boolean;
    modelProvider: ModelChoice["provider"];
    model: string;
    snapshot: string;
  };
}) {
  const save = useAction(api.settings.save);
  const checkAccess = useAction(api.models.access);
  const [openrouterKey, setOpenrouterKey] = useState<string | null>("");
  const [model, setModel] = useState<ModelChoice>(
    initialModel ?? {
      provider: settings.modelProvider,
      id: settings.model,
    },
  );
  const [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await save({
        token,
        ...(openrouterKey !== "" ? { openrouterKey } : {}),
        modelProvider: model.provider,
        model: model.id,
        snapshot: settings.snapshot,
      });
      setOpenrouterKey("");
      if (onReady) {
        const access = await checkAccess({ token, provider: model.provider });
        if (!access.ready) {
          setError(access.message);
          return;
        }
        await onReady(model);
      }
      setSaved(true);
    } catch (e) {
      setError(connectionError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} onChange={() => setSaved(false)}>
      {onReady && (
        <p className="text-xs leading-5 text-zinc-500">
          Choose a provider to send your message. Your draft is saved.
        </p>
      )}
      {heldMessage && (
        <blockquote className="mt-3 max-h-24 overflow-y-auto rounded-lg bg-zinc-50 px-3 py-2 text-sm break-words whitespace-pre-wrap text-zinc-600">
          {heldMessage}
        </blockquote>
      )}
      <div>
        <p
          id="settings-provider-label"
          className="mb-2 text-xs font-medium text-zinc-500"
        >
          Provider
        </p>
        <div
          role="group"
          aria-labelledby="settings-provider-label"
          className="flex gap-1 rounded-xl bg-zinc-100 p-1"
        >
          {(["convex", "openrouter"] as const).map((provider) => (
            <button
              key={provider}
              type="button"
              aria-pressed={model.provider === provider}
              disabled={busy}
              onClick={() => {
                setModel({ ...model, provider });
                setSaved(false);
                setError("");
              }}
              className={`min-h-9 flex-1 justify-center rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 disabled:opacity-50 ${model.provider === provider ? "bg-surface text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-900"}`}
            >
              {providerName(provider)}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4">
        <p className="mb-2 text-xs font-medium text-zinc-500">
          {onReady ? "Model" : "Default model"}
        </p>
        <ModelPicker
          token={token}
          value={model}
          onChange={(choice) => {
            setModel(choice);
            setSaved(false);
            setError("");
          }}
          disabled={busy}
          allowProviderSwitch={false}
          fullWidth
        />
      </div>
      {model.provider === "convex" ? (
        <GatewaySetup token={token} />
      ) : (
        <>
          <ServiceKey
            label={`${providerName(model.provider)} API key`}
            value={openrouterKey}
            onChange={setOpenrouterKey}
            saved={settings.hasOpenRouterKey}
            link="https://openrouter.ai/settings/keys"
            disabled={busy}
          />
        </>
      )}
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      <div className="mt-5 flex items-center justify-between gap-3">
        <span role="status" className="text-xs text-zinc-500">
          {saved
            ? "Saved"
            : onReady
              ? "Closing keeps your draft."
              : "Applies to new chats."}
        </span>
        <button className={button} disabled={busy}>
          {busy ? (
            <LoaderCircle size={15} className="animate-spin" />
          ) : (
            <Check size={15} />
          )}{" "}
          {busy
            ? onReady
              ? "Preparing message…"
              : "Saving…"
            : onReady
              ? "Save & send"
              : "Save settings"}
        </button>
      </div>
    </form>
  );
}
function GatewaySetup({ token }: { token: string }) {
  const { status, checking, refresh } = useGatewayAccess(token);
  return (
    <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4">
      <p className="text-xs leading-5 text-zinc-500">
        Uses your Convex deployment’s Gateway access. Usage is billed to the
        team hosting Monitor.
      </p>
      <p role="status" className="mt-3 text-xs leading-5 text-zinc-700">
        {checking ? "Checking deployment access…" : status?.message}
      </p>
      <div className="mt-3 flex items-center justify-between text-xs">
        <a
          href="https://docs.convex.dev/ai-gateway/setup"
          target="_blank"
          rel="noreferrer"
          className="text-zinc-600 hover:text-zinc-900"
        >
          Gateway setup ↗
        </a>
        <button
          type="button"
          disabled={checking}
          onClick={() => void refresh()}
          className="text-zinc-600 hover:text-zinc-900"
        >
          {checking ? "Checking…" : "Check again"}
        </button>
      </div>
    </div>
  );
}
function ServiceKey({
  label,
  value,
  onChange,
  saved,
  link,
  disabled,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  saved: boolean;
  link: string;
  disabled: boolean;
}) {
  return (
    <details className="mt-4 border-t border-zinc-100 pt-3" open={!saved}>
      <summary className="cursor-pointer text-xs font-medium text-zinc-600">
        API key
        <span className="float-right text-xs font-normal text-zinc-400">
          {value === null ? "Will remove" : saved ? "Saved" : "Required"}
        </span>
      </summary>
      <label className="mt-3 text-xs">
        {label}
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          maxLength={8192}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            saved ? "Leave empty to keep saved key" : `Paste your ${label}`
          }
          disabled={disabled}
        />
      </label>
      <div className="mt-2 flex justify-between text-xs">
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="text-zinc-500 hover:text-zinc-900"
        >
          Get a key ↗
        </a>
        {saved && (
          <button
            type="button"
            className="text-zinc-500"
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            Remove {label.replace(" API key", " key")}
          </button>
        )}
      </div>
    </details>
  );
}
export function WebhookSettings({
  token,
  project,
}: {
  token: string;
  project: Project;
}) {
  const save = useAction(api.settings.webhook);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const url = `${import.meta.env.VITE_CONVEX_SITE_URL ?? ""}/webhooks/logs/${project._id}`;
  async function update(value: string | null) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await save({
        token,
        projectId: project._id as Id<"projects">,
        secret: value,
      });
      setSecret("");
      setMessage(
        value === null ? "Webhook disabled." : "Signing secret saved.",
      );
    } catch (e) {
      setError(connectionError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="mt-3 border-t border-zinc-100 pt-3">
      <summary className="cursor-pointer text-xs font-medium text-zinc-600">
        Log webhook{" "}
        <span className="ml-2 text-xs font-normal text-zinc-400">
          {project.hasWebhookSecret ? "Configured" : "Optional"}
        </span>
      </summary>
      <p className="mt-3 text-xs leading-5 text-zinc-500">
        Send signed log events to this URL. Webhooks store evidence and do not
        start investigations.
      </p>
      <label className="mt-3">
        Webhook URL
        <input readOnly value={url} onFocus={(e) => e.target.select()} />
      </label>
      {url.startsWith("http://127.0.0.1") && (
        <p className="mt-2 text-xs leading-5 text-zinc-500">
          This preview address is local. External log delivery becomes available
          when Monitor is hosted on a public URL.
        </p>
      )}
      <label className="mt-3">
        Signing secret
        <input
          type="password"
          autoComplete="off"
          value={secret}
          maxLength={8192}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={
            project.hasWebhookSecret
              ? "Replace saved signing secret"
              : "Paste the sender’s signing secret"
          }
        />
      </label>
      <div className="mt-3 flex justify-between gap-3">
        <button
          type="button"
          className="text-xs text-zinc-500"
          disabled={busy || !project.hasWebhookSecret}
          onClick={() => void update(null)}
        >
          Disable webhook
        </button>
        <button
          type="button"
          className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-white"
          disabled={busy || !secret.trim()}
          onClick={() => void update(secret)}
        >
          {busy ? "Saving…" : "Save signing secret"}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-xs text-red-600">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="mt-3 text-xs text-zinc-500">
          {message}
        </p>
      )}
    </details>
  );
}
