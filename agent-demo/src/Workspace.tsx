import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import {
  ArrowRight,
  Github,
  LoaderCircle,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  SquarePen,
  Settings2,
  X,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import type {
  Configuration,
  Conversation,
  Detail,
  Message,
  Project,
} from "./types";
import type { ModelChoice } from "../convex/lib/models";
import type { ResultSelection } from "../convex/lib/resultSelection";
import { ConfigurationForm } from "./Configuration";
import { ConnectProject } from "./ConnectProject";
import { WorkspaceSettings, type SettingsSection } from "./WorkspaceSettings";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { ModelPicker } from "./ModelPicker";
import { MessageView, StreamingCursor } from "./components/MessageView";
import { PermissionRequests } from "./components/PermissionRequests";
import { ConversationLink } from "./components/ConversationLink";
import { PromptBar } from "./components/beautiful-ui/PromptBar";
import { ActivitySettings } from "./components/ActivitySettings";
import { SidebarIndicators } from "./components/SidebarIndicators";
import { ProjectStart } from "./components/ProjectStart";
import { useNavigationIntent } from "./useNavigationIntent";
import { useChatScroll } from "./useChatScroll";
import { useSidebarResize } from "./useSidebarResize";
import { nextPrompts, type SelectResult } from "./results";

const age = (at: number) => {
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60_000));
  return minutes < 1
    ? "now"
    : minutes < 60
      ? `${minutes}m`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h`
        : `${Math.floor(minutes / 1440)}d`;
};
const triggerName = {
  chat: "Started by you",
  cron: "Scheduled check",
  webhook: "Log webhook",
};
export type HeldMessage = {
  prompt: string;
  send: (model: ModelChoice) => Promise<void>;
};
export type WorkspaceProps = {
  projects: Project[];
  project?: Project;
  conversations: Conversation[];
  conversation?: Conversation;
  detail: Detail;
  messages: Message[];
  loading?: boolean;
  selectProject: (id: string) => void;
  newChat: () => Promise<void>;
  renameChat: (chat: Conversation, title: string) => Promise<void>;
  deleteChat: (chat: Conversation) => Promise<void>;
  connect: (model?: ModelChoice, heldMessage?: HeldMessage) => void;
  save: (config: Configuration, id?: string) => Promise<void>;
  send: (
    prompt: string,
    modelChoice: ModelChoice,
    selection?: ResultSelection,
  ) => Promise<void>;
  modelDefault: ModelChoice;
  checkModel: (model: ModelChoice) => Promise<boolean>;
  decide: (id: string, approve: boolean) => Promise<void>;
  loadMore?: () => void;
  token: string;
};
export function Workspace(props: WorkspaceProps) {
  const homeIntent = useNavigationIntent(
    props.project
      ? { kind: "project", projectId: props.project._id }
      : undefined,
  );
  const {
    projects,
    project,
    conversations,
    conversation,
    detail,
    messages,
    connect,
    save,
    send,
    decide,
  } = props;
  const [edit, setEdit] = useState<"new" | null>(!project ? "new" : null);
  const [menu, setMenu] = useState(false);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection | null>(null);
  const openSettings = (section: SettingsSection) => {
    setMenu(false);
    setSettingsSection(section);
  };
  const sidebarResize = useSidebarResize();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [selections, setSelections] = useState<
    Record<string, ResultSelection | undefined>
  >({});
  const selection = selections[conversation?.threadId ?? ""];
  const selectResult: SelectResult = useCallback(
    (value) => {
      setSelections((current) => ({
        ...current,
        [conversation?.threadId ?? ""]: value,
      }));
      setDrafts((current) =>
        current[conversation?.threadId ?? ""]?.trim()
          ? current
          : { ...current, [conversation?.threadId ?? ""]: "Investigate this" },
      );
      document.getElementById("message")?.focus();
    },
    [conversation?.threadId],
  );
  const prompt = drafts[conversation?.threadId ?? ""] ?? "";
  const setPrompt = (value: string) =>
    setDrafts((ds) => ({ ...ds, [conversation?.threadId ?? ""]: value }));
  const [modelDrafts, setModelDrafts] = useState<Record<string, ModelChoice>>(
    {},
  );
  const model =
    modelDrafts[conversation?.threadId ?? ""] ??
    conversation?.modelChoice ??
    props.modelDefault;
  const setModel = (choice: ModelChoice) =>
    setModelDrafts((ds) => ({ ...ds, [conversation?.threadId ?? ""]: choice }));
  const {
    scroll,
    content: chatContent,
    follow,
    onScroll,
  } = useChatScroll(conversation?.threadId);
  const active =
    conversation?.state === "queued" || conversation?.state === "running";
  const streaming = messages.some((message) => message.status === "streaming");
  const isHistoricalAutoThread =
    conversation && conversation.trigger !== "chat";
  const perform = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    setError("");
  }, [conversation?.threadId]);
  const sendPrompt = (
    sent: string,
    context?: { selection?: ResultSelection },
  ) => {
    if (!sent.trim() || busy || props.loading || !project?.enabled) return;
    const threadId = conversation?.threadId ?? "";
    const sentSelection = context ? context.selection : selection;
    const sendHeld = async (choice: ModelChoice) => {
      await send(sent, choice, sentSelection);
      setSelections((current) =>
        current[threadId] === sentSelection
          ? { ...current, [threadId]: undefined }
          : current,
      );
      setDrafts((drafts) =>
        drafts[threadId] === sent ? { ...drafts, [threadId]: "" } : drafts,
      );
      setModelDrafts((models) => ({ ...models, [threadId]: choice }));
      follow.current = true;
    };
    void perform(async () => {
      if (!(await props.checkModel(model))) {
        connect(model, { prompt: sent, send: sendHeld });
        return;
      }
      await sendHeld(model);
    });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    sendPrompt(prompt);
  };
  const visibleMessages = messages
    .filter(
      (message) => message.role === "assistant" || message.role === "user",
    )
    .filter(
      (message) =>
        !(
          isHistoricalAutoThread &&
          message.role === "user" &&
          detail.runs.some(
            (run) => run.trigger !== "chat" && run.prompt === message.text,
          )
        ),
    );
  const lastMessage = visibleMessages.at(-1);
  const suggestions =
    !active &&
    lastMessage?.role === "assistant" &&
    lastMessage.status !== "streaming" &&
    lastMessage.text
      ? nextPrompts(lastMessage)
      : [];
  const isStart =
    !conversation || (!messages.length && !active && !props.loading);
  const composer = (
    <div
      className={
        isStart
          ? "composer-area w-full"
          : "composer-area mx-auto w-full max-w-[820px] shrink-0 bg-canvas px-7 pt-2 pb-4 max-sm:px-4 max-sm:pb-4"
      }
    >
      {error && (
        <div
          className="error dismissible mb-3 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700 [&_button]:ml-auto"
          role="alert"
        >
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={14} />
          </button>
        </div>
      )}
      {suggestions.length > 0 && (
        <div
          className="mb-2 flex flex-wrap gap-2"
          aria-label="Suggested next prompts"
        >
          {suggestions.map((suggestion) => (
            <button
              type="button"
              key={suggestion}
              className="rounded-xl border border-line-strong/60 bg-surface px-3 py-1.5 text-xs text-ink-2 transition-colors enabled:hover:border-line-strong enabled:hover:bg-hover"
              disabled={busy || !conversation || !project?.enabled}
              onClick={() => sendPrompt(suggestion)}
            >
              {suggestion}
              <ArrowRight size={12} />
            </button>
          ))}
        </div>
      )}
      <PromptBar
        variant={isStart ? "start" : "reply"}
        value={prompt}
        selection={selection}
        clearSelection={() =>
          setSelections((current) => ({
            ...current,
            [conversation?.threadId ?? ""]: undefined,
          }))
        }
        onChange={setPrompt}
        onSubmit={submit}
        disabled={props.loading || !project?.enabled}
        sending={busy}
        canSend={
          !!prompt.trim() && !busy && !props.loading && !!project?.enabled
        }
        placeholder={
          project?.enabled === false
            ? "This connection is paused"
            : active
              ? "Add to this investigation…"
              : "Ask about your project…"
        }
        modelPicker={
          <ModelPicker
            token={props.token}
            value={model}
            onChange={setModel}
            disabled={busy}
          />
        }
      />
    </div>
  );
  return (
    <div
      className={`app relative flex h-dvh overflow-hidden bg-canvas text-zinc-900 ${sidebarResize.resizing ? "sidebar-resizing" : ""}`}
    >
      {menu && (
        <button
          className="mobile-scrim fixed inset-y-0 right-0 left-60 z-20 bg-zinc-950/40 backdrop-blur-sm md:hidden"
          aria-label="Close conversations"
          onClick={() => setMenu(false)}
        />
      )}
      <aside
        id="workspace-sidebar"
        style={
          { "--sidebar-width": `${sidebarResize.width}px` } as CSSProperties
        }
        className={`sidebar group/sidebar relative flex w-60 shrink-0 flex-col border-r border-line bg-sidebar max-md:invisible max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:-translate-x-full max-md:transition-transform md:w-[var(--sidebar-width)] max-md:[&.mobile-open]:visible max-md:[&.mobile-open]:translate-x-0 ${menu ? "mobile-open" : ""} ${sidebarResize.collapsed ? "sidebar-closed" : ""}`}
      >
        <header className="sidebar-header flex h-12 shrink-0 items-center gap-2 border-b border-line bg-canvas px-2">
          <ProjectSwitcher
            projects={projects}
            project={project}
            onSelect={props.selectProject}
            onConnect={() => setEdit("new")}
          />
        </header>
        <button
          type="button"
          className="new-chat mx-2 mt-2 flex h-8 shrink-0 transform-gpu justify-start gap-3 rounded-lg bg-transparent px-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-200/60 hover:text-zinc-950"
          aria-label="New investigation"
          {...homeIntent}
          title="New investigation"
          disabled={!project || busy}
          onClick={() =>
            void perform(async () => {
              await props.newChat();
              setMenu(false);
            })
          }
        >
          <SquarePen size={16} className="shrink-0" />
          <span className="sidebar-detail whitespace-nowrap">
            New investigation
          </span>
        </button>
        <div
          id="sidebar-conversations"
          className="sidebar-detail conversation-list mt-4 min-h-0 flex-1 overflow-y-auto px-2"
        >
          <section className="chat-section mb-6 [&>.section-label]:px-2">
            <div className="section-label mb-3 flex items-center justify-between text-xs font-medium tracking-wide text-zinc-500">
              Your chats
            </div>
            {conversations.length ? (
              conversations.map((c) => (
                <ConversationLink
                  key={c.threadId}
                  conversation={c}
                  onRename={(title) => props.renameChat(c, title)}
                  onDelete={() => props.deleteChat(c)}
                  className={`conversation-item mb-1 flex w-full items-start justify-start gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-left text-zinc-600 transition-colors hover:bg-zinc-100 [&.selected]:bg-selection [&.selected]:text-zinc-950 ${conversation?.threadId === c.threadId ? "selected" : ""}`}
                  onNavigate={() => setMenu(false)}
                  aria-current={
                    conversation?.threadId === c.threadId ? "page" : undefined
                  }
                >
                  <span className="thread-copy flex min-w-0 flex-1 items-center gap-2 [&_small]:mt-0 [&_small]:shrink-0 [&_small]:text-xs [&_small]:text-zinc-500 [&_small>span]:text-zinc-400 [&>span]:block [&>span]:flex-1 [&>span]:truncate [&>span]:text-sm [&>span]:font-medium">
                    <span>{c.title}</span>
                    <small>
                      {c.trigger !== "chat" && `${triggerName[c.trigger]} · `}
                      <span>{age(c.updatedAt)}</span>
                    </small>
                  </span>
                  {c.state === "running" || c.state === "queued" ? (
                    <LoaderCircle
                      aria-label={c.state === "queued" ? "Queued" : "Running"}
                      size={12}
                      className="mt-1 shrink-0 animate-spin text-accent-plum"
                    />
                  ) : c.state === "failed" ? (
                    <span
                      role="img"
                      aria-label="Failed investigation"
                      title="Failed investigation"
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-red-500"
                    />
                  ) : null}
                </ConversationLink>
              ))
            ) : (
              <p className="sidebar-empty px-2 py-1 text-xs leading-5 text-zinc-500">
                Start a new chat.
              </p>
            )}
          </section>
        </div>
        <div className="sidebar-bottom mt-auto shrink-0 p-2">
          <SidebarIndicators
            project={project}
            conversations={conversations}
            detail={detail}
            onProject={() => openSettings("project")}
            onActivity={() => openSettings("activity")}
          />
          <button
            className="flex h-8 w-full transform-gpu justify-start gap-3 rounded-lg px-2 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Settings"
            title="Settings"
            onClick={() => openSettings("model")}
          >
            <Settings2 size={16} className="shrink-0" />
            <span className="sidebar-detail">Settings</span>
          </button>
        </div>
        <div className="sidebar-resize-handle" {...sidebarResize.handleProps} />
      </aside>
      <main className="chat-shell relative flex min-w-0 flex-1 flex-col bg-canvas">
        <header className="chat-header flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line bg-canvas pr-4 pl-2 text-sm text-zinc-500">
          <div className="header-left flex min-w-0 items-center gap-3 max-sm:gap-2 max-sm:[&>.lucide-chevron-right]:hidden [&>span:last-child]:whitespace-nowrap">
            <button
              className={`icon-button menu-button hidden size-8 shrink-0 rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 max-md:inline-flex ${menu ? "max-md:fixed max-md:top-2 max-md:left-[248px] max-md:z-40 max-md:bg-canvas" : ""}`}
              onClick={() => setMenu((open) => !open)}
              aria-label={menu ? "Close sidebar" : "Open conversations"}
              aria-expanded={menu}
              aria-controls="workspace-sidebar"
            >
              {menu ? <PanelLeftClose size={17} /> : <Menu size={19} />}
            </button>
            <button
              type="button"
              className="result-control size-8 max-md:hidden"
              aria-label={
                sidebarResize.collapsed ? "Expand sidebar" : "Collapse sidebar"
              }
              title={
                sidebarResize.collapsed ? "Expand sidebar" : "Collapse sidebar"
              }
              aria-expanded={!sidebarResize.collapsed}
              aria-controls="workspace-sidebar"
              onClick={sidebarResize.toggle}
            >
              {sidebarResize.collapsed ? (
                <PanelLeftOpen size={17} />
              ) : (
                <PanelLeftClose size={17} />
              )}
            </button>
            {conversation ? (
              <>
                <Link
                  to="/chats"
                  {...homeIntent}
                  className="shrink-0 text-xs text-ink-3 hover:text-ink"
                >
                  Workspace
                </Link>
                <span className="text-line-strong">/</span>
                <span className="header-project truncate text-[13px] font-medium text-ink">
                  {conversation.title}
                </span>
              </>
            ) : null}
          </div>
          <a
            href="https://github.com/freestyle-sh/convex"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View source on GitHub (opens in a new tab)"
            title="GitHub"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-field hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-plum"
          >
            <Github size={16} aria-hidden="true" />
          </a>
        </header>
        <div
          className="message-scroll min-h-0 flex-1 [scrollbar-width:thin] [scrollbar-color:var(--color-zinc-300)_transparent] overflow-y-auto"
          ref={scroll}
          onScroll={onScroll}
        >
          {isStart ? (
            <ProjectStart
              token={props.token}
              model={model}
              project={project}
              detail={detail}
              conversations={conversations}
              composer={composer}
              onSend={(prompt, selection) => sendPrompt(prompt, { selection })}
              showArtifacts={!conversation}
              onConnect={() => setEdit("new")}
              disabled={busy || !!props.loading || !project?.enabled}
            />
          ) : (
            <div
              ref={chatContent}
              className="conversation-body mx-auto max-w-[1040px] px-7 pt-8 pb-8 max-sm:px-5"
            >
              {conversation && (messages.length > 0 || active) ? (
                <>
                  <div className="mx-auto mb-7 flex max-w-[680px] items-center gap-3 text-[10px] font-medium tracking-[0.1em] text-ink-3 uppercase">
                    <span className="text-accent-plum">Investigation</span>
                    <span className="text-line-strong">/</span>
                    {new Date(conversation.updatedAt).toLocaleDateString(
                      undefined,
                      { month: "short", day: "numeric" },
                    )}
                  </div>
                  {props.loadMore && (
                    <button
                      className="load-more mx-auto mb-6 flex rounded-lg px-3 py-2 text-xs font-medium text-zinc-500 hover:bg-zinc-100"
                      onClick={props.loadMore}
                    >
                      Load earlier messages
                    </button>
                  )}
                  <div
                    className="messages flex flex-col gap-6"
                    aria-live="polite"
                    aria-relevant="additions text"
                  >
                    {visibleMessages.map((m, i, all) => (
                      <MessageView
                        key={`${conversation?.threadId}:${m.key}`}
                        viewKey={`${conversation?.threadId}:${m.key}`}
                        message={m}
                        artifactSource={{
                          projectId: conversation.projectId,
                          threadId: conversation.threadId,
                        }}
                        showName={m.role !== all[i - 1]?.role || i === 0}
                        onSelect={selectResult}
                      />
                    ))}
                    {detail.proposals.length > 0 && (
                      <div id="chat-permissions">
                        <PermissionRequests
                          proposals={detail.proposals}
                          project={project}
                          busy={busy}
                          decide={(id, approve) =>
                            void perform(() => decide(id, approve))
                          }
                        />
                      </div>
                    )}
                    {active && !streaming && <StreamingCursor />}
                  </div>
                </>
              ) : null}
              {props.loading && (
                <div className="loading-messages flex items-center justify-center gap-3 p-5 text-sm text-zinc-500">
                  <LoaderCircle className="spin animate-spin" size={17} />
                  Loading conversation…
                </div>
              )}
            </div>
          )}
        </div>
        {!isStart && composer}
      </main>
      {settingsSection && (
        <WorkspaceSettings
          token={props.token}
          initialSection={settingsSection}
          close={() => setSettingsSection(null)}
          activity={
            project && (
              <ActivitySettings
                key={conversation?.threadId ?? project._id}
                project={project}
                conversation={conversation}
                messages={visibleMessages}
                detail={detail}
                decide={decide}
                onSelect={(value) => {
                  setSettingsSection(null);
                  requestAnimationFrame(() => selectResult(value));
                }}
              />
            )
          }
          projectSettings={
            project ? (
              <ConfigurationForm
                project={project}
                token={props.token}
                save={save}
                close={() => setSettingsSection(null)}
                reconnect={() => {
                  setSettingsSection(null);
                  setEdit("new");
                }}
              />
            ) : (
              <button
                className="w-full rounded-lg bg-zinc-100 px-3 py-3 text-sm text-zinc-700 hover:bg-zinc-200"
                onClick={() => {
                  setSettingsSection(null);
                  setEdit("new");
                }}
              >
                Connect a project <Plus size={15} />
              </button>
            )
          }
        />
      )}
      {edit === "new" && (
        <ConnectProject
          token={props.token}
          sources={projects}
          close={() => setEdit(null)}
          connected={props.selectProject}
        />
      )}
    </div>
  );
}
