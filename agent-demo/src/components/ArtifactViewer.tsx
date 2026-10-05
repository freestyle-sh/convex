import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { useUIMessages } from "@convex-dev/agent/react";
import { useNavigationIntent } from "../useNavigationIntent";
import { INITIAL_MESSAGE_COUNT } from "../navigationPreload";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  LoaderCircle,
  Pin,
  Undo2,
  X,
} from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { Artifact } from "../../convex/lib/artifacts";
import type { ModelChoice } from "../../convex/lib/models";
import type { ResultSelection } from "../../convex/lib/resultSelection";
import {
  artifactMessages,
  artifactSelection,
  artifactTitle,
  artifactSourceId,
} from "../artifactLayout";
import { agentMessages } from "../agentMessages";
import { selectionFor } from "../results";
import { OverlayContainer } from "../overlayContainer";
import { ModelPicker } from "../ModelPicker";
import { WorkspaceSettings } from "../WorkspaceSettings";
import type { Project } from "../types";
import { ResultContent } from "./MessageResults";
import { MessageView, StreamingCursor } from "./MessageView";
import { PermissionRequests } from "./PermissionRequests";
import { PromptBar } from "./beautiful-ui/PromptBar";
import { useChatScroll } from "../useChatScroll";

export function ArtifactViewer({
  artifact,
  token,
  project,
  initialModel,
  pinned,
  pinning,
  pinError,
  togglePin,
  close,
}: {
  artifact: Artifact;
  token: string;
  project: Project;
  initialModel: ModelChoice;
  pinned: boolean;
  pinning: boolean;
  pinError: string;
  togglePin: () => void;
  close: () => void;
}) {
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const [draft, setDraft] = useState("");
  const [mobilePanel, setMobilePanel] = useState<"result" | "chat">("result");
  const [selected, setSelected] = useState<ResultSelection>();
  const [modelOverride, setModel] = useState<ModelChoice>();
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [error, setError] = useState("");
  const [held, setHeld] = useState<{
    prompt: string;
    send: (model: ModelChoice) => Promise<void>;
  }>();
  const args = {
    token,
    projectId: project._id as Id<"projects">,
    threadId: artifact.threadId,
  };
  const rootSourceId = artifactSourceId(artifact);
  const chatIntent = useNavigationIntent({
    kind: "chat",
    projectId: project._id,
    threadId: artifact.threadId,
  });
  const history = useQuery(api.artifacts.history, {
    ...args,
    sourceId: rootSourceId,
  });
  const displayed = history?.artifact ?? artifact;
  const currentVersion = history?.versions.find(
    (version) => version.id === history.currentVersionId,
  );
  const previousVersion = currentVersion?.baseVersionId;
  const setVersion = useMutation(api.artifacts.selectVersion);
  const [changingVersion, setChangingVersion] = useState(false);
  useEffect(() => setSelected(undefined), [history?.currentVersionId]);
  const chooseVersion = async (versionId: Id<"artifactVersions">) => {
    if (!history || changingVersion) return;
    setChangingVersion(true);
    setError("");
    try {
      await setVersion({ token, artifactId: history.artifactId, versionId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not switch version.");
    } finally {
      setChangingVersion(false);
    }
  };
  const chat = useQuery(api.projects.chat, {
    token,
    threadId: artifact.threadId,
  });
  const detail = useQuery(api.projects.inspect, args);
  const { results, status, loadMore } = useUIMessages(
    api.projects.messages,
    args,
    { initialNumItems: INITIAL_MESSAGE_COUNT, stream: true },
  );
  const ask = useMutation(api.artifacts.ask);
  const decide = useMutation(api.approvals.decide);
  const checkAccess = useAction(api.models.access);
  const model = modelOverride ?? chat?.modelChoice ?? initialModel;
  const messages = artifactMessages(
    agentMessages(results, detail?.runs),
    rootSourceId,
  );
  const active =
    (chat?.state === "queued" || chat?.state === "running") &&
    messages.length > 0;
  const streaming = messages.some((m) => m.status === "streaming");
  const {
    scroll,
    content: chatContent,
    follow,
    onScroll,
  } = useChatScroll(artifact.threadId);
  useEffect(() => {
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, [dialog]);
  useEffect(() => {
    if (chat === null) close();
  }, [chat, close]);
  const select = useCallback((selection: ResultSelection) => {
    setSelected(selection);
    setDraft((current) => (current.trim() ? current : "Investigate this"));
    setMobilePanel("chat");
    requestAnimationFrame(() =>
      document
        .getElementById("artifact-message")
        ?.focus({ preventScroll: true }),
    );
  }, []);
  async function send() {
    const prompt = draft.trim();
    if (
      !prompt ||
      sending.current ||
      changingVersion ||
      !project.enabled ||
      !chat ||
      history === undefined
    )
      return;
    const context = selected
      ? selectionFor(selected.kind, selected.label, rootSourceId, {
          artifact: artifactTitle(displayed),
          sourceThreadId: artifact.threadId,
          selectedSourceId: selected.sourceId,
          selection: JSON.parse(selected.contextJson),
        })
      : artifactSelection(displayed);
    const sendHeld = async (choice: ModelChoice) => {
      const accepted = await ask({
        ...args,
        sourceId: rootSourceId,
        baseVersionId: history?.currentVersionId,
        prompt,
        modelChoice: choice,
        selection: context,
      });
      if (!accepted)
        throw new Error("Could not send. Your draft is still here.");
      setDraft((current) => (current.trim() === prompt ? "" : current));
      setSelected((current) => (current === selected ? undefined : current));
      setModel(choice);
      setHeld(undefined);
      follow.current = true;
    };
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      if (!(await checkAccess({ token, provider: model.provider })).ready)
        setHeld({ prompt, send: sendHeld });
      else await sendHeld(model);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not send. Please try again.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={setDialog}
      aria-label={artifactTitle(displayed)}
      onCancel={(event) => {
        event.preventDefault();
        if (held) setHeld(undefined);
        else close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !held) close();
      }}
      className="result-focus artifact-viewer m-auto h-[min(820px,calc(100dvh-32px))] w-[min(1380px,calc(100vw-32px))] max-w-none overflow-clip rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-zinc-950/25 backdrop:backdrop-blur-sm"
    >
      <OverlayContainer.Provider value={dialog}>
        <div className="flex h-full min-h-0 flex-col">
          <header className="artifact-header flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold max-sm:line-clamp-2 max-sm:whitespace-normal">
              {artifactTitle(displayed)}
            </h2>
            {history && history.versions.length > 1 && (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  className="result-control max-sm:hidden"
                  aria-label="Undo artifact change"
                  title="Undo artifact change"
                  disabled={!previousVersion || changingVersion}
                  onClick={() =>
                    previousVersion && void chooseVersion(previousVersion)
                  }
                >
                  <Undo2 size={14} />
                </button>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      disabled={changingVersion}
                      aria-label={`Artifact version ${currentVersion?.number ?? 1}`}
                      className="min-h-9 gap-1 rounded-md px-2 py-1.5 text-xs text-ink-3 hover:bg-hover hover:text-ink"
                    >
                      {changingVersion ? (
                        <LoaderCircle size={12} className="animate-spin" />
                      ) : (
                        `V${currentVersion?.number ?? 1}`
                      )}
                      <ChevronDown size={11} />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal container={dialog ?? undefined}>
                    <DropdownMenu.Content
                      align="end"
                      sideOffset={6}
                      className="z-50 max-h-72 w-72 max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-line bg-surface p-1.5 text-ink shadow-xl"
                    >
                      <DropdownMenu.Label className="px-2 py-1.5 text-[11px] text-ink-3">
                        Version history
                      </DropdownMenu.Label>
                      {history.versions.map((version) => (
                        <DropdownMenu.Item
                          key={version.id}
                          onSelect={() => void chooseVersion(version.id)}
                          className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs outline-none data-highlighted:bg-hover"
                        >
                          <span className="w-5 shrink-0 text-ink-3">
                            V{version.number}
                          </span>
                          <span
                            className="min-w-0 flex-1 truncate"
                            title={version.label}
                          >
                            {version.label}
                          </span>
                          {version.id === history.currentVersionId && (
                            <Check size={13} className="text-accent-plum" />
                          )}
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
            )}
            <button
              type="button"
              disabled={pinning}
              onClick={togglePin}
              aria-label={pinned ? "Unpin artifact" : "Pin artifact"}
              aria-pressed={pinned}
              title={pinned ? "Unpin" : "Pin"}
              className={`result-control ${pinned ? "text-accent-plum" : ""}`}
            >
              <Pin size={15} fill={pinned ? "currentColor" : "none"} />
            </button>
            <Link
              to="/chats/$chatId"
              {...chatIntent}
              params={{ chatId: artifact.threadId }}
              title={artifact.threadTitle}
              aria-label="Open source chat"
              className="flex shrink-0 items-center gap-1 text-xs text-ink-3 hover:text-accent-plum max-sm:size-9 max-sm:justify-center"
            >
              <span className="max-sm:hidden">Open chat</span>{" "}
              <ArrowUpRight size={15} />
            </Link>
            <button
              type="button"
              autoFocus
              onClick={close}
              aria-label="Close artifact"
              className="result-control"
            >
              <X size={17} />
            </button>
          </header>
          <div
            className="hidden shrink-0 gap-1 px-3 py-2 max-sm:flex"
            role="group"
            aria-label="Artifact view"
          >
            {(["result", "chat"] as const).map((panel) => (
              <button
                key={panel}
                type="button"
                aria-pressed={mobilePanel === panel}
                onClick={() => setMobilePanel(panel)}
                className={`min-h-10 flex-1 rounded-lg text-xs font-medium ${mobilePanel === panel ? "bg-field text-ink" : "text-ink-3 hover:bg-hover"}`}
              >
                {panel === "result" ? "Artifact" : "Chat"}
                {panel === "chat" && selected && (
                  <span
                    className="size-1.5 rounded-full bg-accent-plum"
                    aria-label="Selection attached"
                  />
                )}
              </button>
            ))}
          </div>
          <div
            data-mobile-panel={mobilePanel}
            className="artifact-panes grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(320px,390px)] max-[880px]:grid-cols-1 max-[880px]:grid-rows-[minmax(0,0.85fr)_minmax(0,1fr)]"
          >
            <div className="artifact-result-pane min-h-0 min-w-0 overflow-hidden bg-field/25 p-3 max-sm:px-3 max-sm:pt-1">
              <ResultContent
                key={displayed.item.sourceId}
                item={displayed.item}
                fill
                focused
                onSelect={select}
              />
            </div>
            <section
              aria-label="Artifact chat"
              className="artifact-chat-pane flex min-h-0 min-w-0 flex-col border-l border-line max-[880px]:border-t max-[880px]:border-l-0 max-sm:border-t-0"
            >
              <div className="flex shrink-0 items-center justify-between px-4 pt-4 pb-1 text-xs font-medium text-ink-2 max-sm:hidden">
                Chat
              </div>
              <div
                ref={scroll}
                className="min-h-0 flex-1 [scrollbar-width:thin] overflow-y-auto px-4 py-4"
                onScroll={onScroll}
              >
                <div ref={chatContent}>
                  {status === "CanLoadMore" && (
                    <button
                      type="button"
                      className="mx-auto mb-4 text-xs text-ink-3 hover:text-ink"
                      onClick={() => loadMore(30)}
                    >
                      Earlier discussion
                    </button>
                  )}
                  {!messages.length && (
                    <p className="py-8 text-center text-sm leading-6 text-ink-3">
                      {status === "LoadingFirstPage"
                        ? "Loading discussion…"
                        : "Ask a question, or select data to investigate."}
                    </p>
                  )}
                  <div
                    className="flex flex-col gap-5"
                    aria-live="polite"
                    aria-relevant="additions text"
                  >
                    {messages.map((message, i) => (
                      <MessageView
                        key={message.key}
                        message={message}
                        artifactSource={{
                          projectId: project._id,
                          threadId: artifact.threadId,
                        }}
                        viewKey={`artifact:${artifact.threadId}:${message.key}`}
                        showName={
                          i === 0 || messages[i - 1].role !== message.role
                        }
                        compact
                        artifactEditor
                        onSelect={select}
                      />
                    ))}
                    {active && !streaming && <StreamingCursor />}
                    {!!detail?.proposals.length && (
                      <PermissionRequests
                        proposals={detail.proposals}
                        project={project}
                        busy={busy}
                        decide={(id, approve) => {
                          setBusy(true);
                          setError("");
                          void decide({
                            token,
                            proposalId: id as Id<"proposals">,
                            approve,
                          })
                            .catch((e) =>
                              setError(
                                e instanceof Error
                                  ? e.message
                                  : "Could not update permission.",
                              ),
                            )
                            .finally(() => setBusy(false));
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
              <div className="shrink-0 p-3">
                {(error || pinError) && (
                  <p role="alert" className="mb-2 text-xs text-red-600">
                    {error || pinError}
                  </p>
                )}
                {!project.enabled && (
                  <p className="mb-2 text-xs text-ink-3">
                    This project is paused.
                  </p>
                )}
                <PromptBar
                  inputId="artifact-message"
                  value={draft}
                  onChange={setDraft}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void send();
                  }}
                  disabled={!project.enabled || !chat || history === undefined}
                  sending={busy}
                  canSend={
                    !!draft.trim() &&
                    !busy &&
                    !changingVersion &&
                    project.enabled &&
                    !!chat &&
                    history !== undefined
                  }
                  placeholder={
                    displayed.item.kind === "chart"
                      ? "Ask about this chart…"
                      : "Ask about this table…"
                  }
                  selection={selected}
                  clearSelection={() => setSelected(undefined)}
                  modelPicker={
                    <ModelPicker
                      token={token}
                      value={model}
                      onChange={setModel}
                      disabled={busy}
                    />
                  }
                />
              </div>
            </section>
          </div>
        </div>
        {held && (
          <WorkspaceSettings
            token={token}
            initialModel={model}
            heldMessage={held.prompt}
            onReady={held.send}
            close={() => setHeld(undefined)}
          />
        )}
      </OverlayContainer.Provider>
    </dialog>
  );
}
