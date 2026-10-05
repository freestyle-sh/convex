import { type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import type { ResultSelection } from "../../convex/lib/resultSelection";
import type { Conversation, Detail, Project } from "../types";
import { AISuggestions } from "./AISuggestions";
import type { ModelChoice } from "../../convex/lib/models";
import { ArtifactGrid } from "./ArtifactGrid";

export function ProjectStart({
  project,
  token,
  model,
  detail,
  conversations,
  composer,
  onSend,
  onConnect,
  disabled,
  showArtifacts,
}: {
  project?: Project;
  token?: string;
  model: ModelChoice;
  detail: Detail;
  conversations: Conversation[];
  composer: ReactNode;
  onSend: (prompt: string, selection?: ResultSelection) => void;
  onConnect: () => void;
  disabled: boolean;
  showArtifacts: boolean;
}) {
  const projectName = (project?.name ?? "Your project").split(" · ")[0];
  return (
    <div className="project-start mx-auto w-full max-w-[1060px] px-10 pt-[clamp(40px,8vh,88px)] pb-12 max-sm:px-5 max-sm:pt-10">
      <h1 className="mb-9 text-[clamp(40px,5.5vw,76px)] leading-[0.98] font-semibold tracking-[-0.065em] break-words text-ink">
        {projectName}
        <span className="text-accent-plum">.</span>
      </h1>
      {project ? (
        <>
          {composer}
          {token && (
            <AISuggestions
              key={`${project._id}:${model.provider}:${model.id}`}
              token={token}
              projectId={project._id}
              model={model}
              revision={JSON.stringify([
                conversations[0]?.updatedAt,
                detail.logs[0]?._id,
                detail.runs.map((r) => [r._id, r.state]),
              ])}
              enabled={project.enabled}
              disabled={disabled}
              onSend={onSend}
            />
          )}
          {token && showArtifacts && (
            <ArtifactGrid key={project._id} token={token} project={project} />
          )}
        </>
      ) : (
        <button
          onClick={onConnect}
          className="rounded-xl bg-action px-5 py-3 text-sm text-white hover:bg-action-hover"
        >
          Connect a project <ArrowUpRight size={16} />
        </button>
      )}
    </div>
  );
}
