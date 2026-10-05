import { useEffect, useMemo, useRef, useState } from "react";
import {
  ConvexProvider,
  ConvexReactClient,
  useAction,
  useMutation,
  useQuery,
} from "convex/react";
import { useUIMessages } from "@convex-dev/agent/react";
import { LoaderCircle } from "lucide-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { defaultModel, type ModelChoice } from "../convex/lib/models";
import { emptyDetail, type Conversation } from "./types";
import { agentMessages } from "./agentMessages";
import { WorkspaceSettings } from "./WorkspaceSettings";
import { Workspace, type HeldMessage, type WorkspaceProps } from "./Workspace";
import { NotFound } from "./components/NotFound";
import { appName } from "./brand";
import { investigationStarter } from "./startInvestigation";
import { NavigationPreloadProvider } from "./useNavigationIntent";
import { INITIAL_MESSAGE_COUNT } from "./navigationPreload";
import { ArtifactToken } from "./components/OpenArtifactButton";
import { RoutedArtifact } from "./components/RoutedArtifact";

const backendUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
const client =
  backendUrl && typeof window !== "undefined"
    ? new ConvexReactClient(backendUrl)
    : null;
export function App() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const open = async () => {
      if (!client) {
        setError(
          `${appName} is temporarily unavailable. Please try again shortly.`,
        );
        return;
      }
      try {
        const storageKey = `convex-monitor.workspace:${backendUrl}`;
        let access = localStorage.getItem(storageKey);
        if (!access) {
          access = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
            b.toString(16).padStart(2, "0"),
          ).join("");
          localStorage.setItem(storageKey, access);
        }
        await client.mutation(api.workspaces.open, { token: access });
        if (!cancelled) setToken(access);
      } catch {
        if (!cancelled)
          setError(
            "Could not open your workspace. Check your connection and allow this site to store data, then try again.",
          );
      }
    };
    void open();
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  if (!token || !client)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-zinc-50 px-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight">{appName}</h1>
        {error ? (
          <>
            <p
              role="alert"
              className="max-w-sm text-sm leading-6 text-zinc-500"
            >
              {error}
            </p>
            <button
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white"
              onClick={() => {
                setError("");
                setAttempt((a) => a + 1);
              }}
            >
              Try again
            </button>
          </>
        ) : (
          <p className="flex items-center gap-2 text-sm text-zinc-500">
            <LoaderCircle size={16} className="animate-spin" />
            Opening your workspace…
          </p>
        )}
      </div>
    );
  return (
    <ConvexProvider client={client}>
      <NavigationPreloadProvider token={token}>
        <ArtifactToken.Provider value={token}>
          <Live token={token} />
        </ArtifactToken.Provider>
      </NavigationPreloadProvider>
    </ConvexProvider>
  );
}
function Live({ token }: { token: string }) {
  const projects = useQuery(api.projects.list, { token });
  const { chatId, artifactId } = useParams({ strict: false });
  const artifact = useQuery(
    api.artifacts.get,
    artifactId ? { token, artifactId } : "skip",
  );
  const routedThreadId = chatId ?? artifact?.threadId;
  const navigate = useNavigate();
  const routedChat = useQuery(
    api.projects.chat,
    routedThreadId ? { token, threadId: routedThreadId } : "skip",
  );
  const [selected, setSelected] = useState("");
  useEffect(() => {
    if (routedChat) setSelected(routedChat.projectId);
  }, [routedChat?.projectId]);
  const save = useMutation(api.projects.save);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [serviceModel, setServiceModel] = useState<ModelChoice>();
  const [heldMessage, setHeldMessage] = useState<HeldMessage>();
  const heldMessageRef = useRef<HeldMessage | undefined>(undefined);
  const closeServices = () => {
    heldMessageRef.current = undefined;
    setServicesOpen(false);
    setHeldMessage(undefined);
  };
  const project =
    routedChat?.project ??
    projects?.find((p) => p._id === selected) ??
    projects?.[0];
  if (!projects)
    return (
      <div className="loading flex h-dvh items-center justify-center gap-3 bg-surface text-sm text-zinc-500">
        <LoaderCircle className="spin animate-spin" /> Connecting to Convex
        Monitor…
      </div>
    );
  if (artifactId && (artifact === null || routedChat === null))
    return <NotFound resource="artifact" />;
  if (chatId && routedChat === null) return <NotFound resource="chat" />;
  return (
    <>
      <LiveWorkspace
        key={project?._id || "initial"}
        token={token}
        projects={
          project && !projects.some((p) => p._id === project._id)
            ? [project, ...projects]
            : projects
        }
        project={project}
        routedChat={routedChat ?? undefined}
        requestedThreadId={chatId}
        selectProject={(id) => {
          setSelected(id);
          void navigate({ to: "/chats" });
        }}
        connect={(model, held) => {
          setServiceModel(model);
          heldMessageRef.current = held;
          setHeldMessage(held);
          setServicesOpen(true);
        }}
        save={async (config, id) => {
          const next = await save({
            token,
            ...config,
            ...(id ? { projectId: id as Id<"projects"> } : {}),
          });
          setSelected(next);
          await navigate({ to: "/chats" });
        }}
      />
      {artifactId && artifact && routedChat && (
        <RoutedArtifact
          key={artifactId}
          token={token}
          artifact={artifact}
          project={routedChat.project}
        />
      )}
      {servicesOpen && (
        <WorkspaceSettings
          token={token}
          initialModel={serviceModel}
          heldMessage={heldMessage?.prompt}
          onReady={
            heldMessage
              ? async (model) => {
                  if (heldMessageRef.current !== heldMessage) return;
                  await heldMessage.send(model);
                  if (heldMessageRef.current === heldMessage) closeServices();
                }
              : undefined
          }
          close={closeServices}
        />
      )}
    </>
  );
}
function LiveWorkspace(
  props: Pick<
    WorkspaceProps,
    "projects" | "project" | "selectProject" | "connect" | "save"
  > & { token: string; requestedThreadId?: string; routedChat?: Conversation },
) {
  const { token, project } = props;
  const navigate = useNavigate();
  const services = useQuery(api.workspaces.settings, { token });
  const checkAccess = useAction(api.models.access);
  const chats = useQuery(
    api.projects.conversations,
    project ? { token, projectId: project._id as Id<"projects"> } : "skip",
  );
  const conversation = props.requestedThreadId
    ? (chats?.find((c) => c.threadId === props.requestedThreadId) ??
      props.routedChat)
    : undefined;
  const conversations =
    conversation && !chats?.some((c) => c.threadId === conversation.threadId)
      ? [conversation, ...(chats ?? [])]
      : (chats ?? []);
  const args =
    project && conversation
      ? {
          token,
          projectId: project._id as Id<"projects">,
          threadId: conversation.threadId,
        }
      : null;
  const detail = useQuery(
    api.projects.inspect,
    args ??
      (project ? { token, projectId: project._id as Id<"projects"> } : "skip"),
  );
  const { results, status, loadMore } = useUIMessages(
    api.projects.messages,
    args ?? "skip",
    { initialNumItems: INITIAL_MESSAGE_COUNT, stream: true },
  );
  const ask = useMutation(api.projects.ask),
    create = useMutation(api.projects.newChat),
    rename = useMutation(api.projects.renameChat),
    removeChat = useMutation(api.projects.deleteChat),
    decide = useMutation(api.approvals.decide);
  const startInvestigation = useMemo(
    () =>
      investigationStarter(async () => {
        if (!project) throw new Error("Connect a project first.");
        return await create({
          token,
          projectId: project._id as Id<"projects">,
        });
      }),
    [create, token, project?._id],
  );
  const messages = agentMessages(args ? results : [], detail?.runs);
  return (
    <Workspace
      {...props}
      conversations={conversations}
      conversation={conversation}
      detail={detail ?? emptyDetail}
      messages={messages}
      modelDefault={
        services
          ? { provider: services.modelProvider, id: services.model }
          : defaultModel
      }
      checkModel={async (model) =>
        (await checkAccess({ token, provider: model.provider })).ready
      }
      newChat={async () => {
        await navigate({ to: "/chats" });
      }}
      renameChat={async (chat, title) => {
        await rename({
          token,
          projectId: chat.projectId as Id<"projects">,
          threadId: chat.threadId,
          title,
        });
      }}
      deleteChat={async (chat) => {
        await removeChat({
          token,
          projectId: chat.projectId as Id<"projects">,
          threadId: chat.threadId,
        });
        if (props.requestedThreadId === chat.threadId)
          await navigate({ to: "/chats", replace: true });
      }}
      send={async (prompt, modelChoice, selection) => {
        if (!project) throw new Error("Connect a project first.");
        if (args) {
          if (!(await ask({ ...args, prompt, modelChoice, selection })))
            throw new Error(
              "Could not send your message. Your draft is still here.",
            );
        } else {
          const threadId = await startInvestigation((threadId) =>
            ask({
              token,
              projectId: project._id as Id<"projects">,
              threadId,
              prompt,
              modelChoice,
              selection,
            }),
          );
          await navigate({
            to: "/chats/$chatId",
            params: { chatId: threadId },
          });
        }
      }}
      decide={async (proposalId, approve) => {
        await decide({
          token,
          proposalId: proposalId as Id<"proposals">,
          approve,
        });
      }}
      loadMore={
        args && status === "CanLoadMore" ? () => loadMore(30) : undefined
      }
      loading={
        (!props.requestedThreadId && !!project && !detail) ||
        (!!props.requestedThreadId && !conversation) ||
        (status === "LoadingFirstPage" && !!args)
      }
    />
  );
}
