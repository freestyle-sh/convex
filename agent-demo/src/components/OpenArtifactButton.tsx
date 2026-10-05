import {
  createContext,
  useContext,
  useState,
  type ComponentProps,
} from "react";
import { useMutation } from "convex/react";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useNavigationIntent } from "../useNavigationIntent";

export const ArtifactToken = createContext("");
export type ArtifactSource = {
  projectId: string;
  threadId: string;
  messageId?: string;
};

declare module "@tanstack/react-router" {
  interface HistoryState {
    artifactReturnChat?: string;
  }
}

export function OpenArtifactButton({
  source,
  sourceId,
  children,
  disabled,
  ...props
}: ComponentProps<"button"> & {
  source: ArtifactSource;
  sourceId: string;
}) {
  const token = useContext(ArtifactToken);
  const open = useMutation(api.artifacts.open);
  const navigate = useNavigate();
  const { chatId } = useParams({ strict: false });
  const returnChat = useLocation({
    select: (location) => location.state.artifactReturnChat,
  });
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const intent = useNavigationIntent({ kind: "artifact", ...source, sourceId });
  return (
    <>
      <button
        {...intent}
        {...props}
        type="button"
        disabled={disabled || opening}
        aria-busy={opening}
        onClick={async () => {
          if (opening) return;
          setOpening(true);
          setError("");
          try {
            const artifactId = await open({
              token,
              ...source,
              projectId: source.projectId as Id<"projects">,
              sourceId,
            });
            await navigate({
              to: "/artifacts/$artifactId",
              params: { artifactId },
              state: { artifactReturnChat: chatId ?? returnChat },
            });
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Could not open this artifact.",
            );
          } finally {
            setOpening(false);
          }
        }}
      >
        {children}
      </button>
      {error && (
        <span role="alert" className="block px-3 py-2 text-xs text-red-600">
          {error}
        </span>
      )}
    </>
  );
}
