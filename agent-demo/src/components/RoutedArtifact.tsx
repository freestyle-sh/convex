import { useCallback, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { Artifact } from "../../convex/lib/artifacts";
import { defaultModel } from "../../convex/lib/models";
import { artifactSourceId } from "../artifactLayout";
import type { Project } from "../types";
import { ArtifactViewer } from "./ArtifactViewer";

export function RoutedArtifact({
  token,
  artifact,
  project,
}: {
  token: string;
  artifact: Artifact;
  project: Project;
}) {
  const navigate = useNavigate();
  const returnChat = useLocation({
    select: (location) => location.state.artifactReturnChat,
  });
  const close = useCallback(() => {
    void navigate(
      returnChat
        ? { to: "/chats/$chatId", params: { chatId: returnChat } }
        : { to: "/chats" },
    );
  }, [navigate, returnChat]);
  const args = { token, projectId: project._id as Id<"projects"> };
  const pins = useQuery(api.artifacts.pinned, args);
  const settings = useQuery(api.workspaces.settings, { token });
  const setPinned = useMutation(api.artifacts.setPinned);
  const [pinning, setPinning] = useState(false);
  const [error, setError] = useState("");
  const sourceId = artifactSourceId(artifact);
  const pinned = !!pins?.some(
    (pin) =>
      pin.threadId === artifact.threadId && artifactSourceId(pin) === sourceId,
  );
  return (
    <ArtifactViewer
      artifact={artifact}
      token={token}
      project={project}
      initialModel={
        settings
          ? { provider: settings.modelProvider, id: settings.model }
          : defaultModel
      }
      pinned={pinned}
      pinning={pinning || pins === undefined}
      pinError={error}
      close={close}
      togglePin={() => {
        setPinning(true);
        setError("");
        void setPinned({
          ...args,
          threadId: artifact.threadId,
          sourceId,
          pinned: !pinned,
        })
          .catch((e) =>
            setError(
              e instanceof Error ? e.message : "Could not save the pin.",
            ),
          )
          .finally(() => setPinning(false));
      }}
    />
  );
}
