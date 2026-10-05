import { useRef } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Plus } from "lucide-react";
import type { Project } from "./types";
import { useNavigationIntent } from "./useNavigationIntent";

export function ProjectSwitcher({
  projects,
  project,
  onSelect,
  onConnect,
}: {
  projects: Project[];
  project?: Project;
  onSelect: (id: string) => void;
  onConnect: () => void;
}) {
  const openingConnection = useRef(false);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`Switch project: ${project?.name ?? "No project connected"}`}
          title={project?.name ?? "Select a project"}
          className="group flex min-h-8 w-full min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-zinc-200/60 data-[state=open]:bg-zinc-200/60 md:group-[.sidebar-closed]/sidebar:px-0"
        >
          <span className="min-w-0 flex-1 md:group-[.sidebar-closed]/sidebar:hidden">
            <span className="block truncate text-[15px] font-semibold tracking-tight text-ink">
              {project?.name ?? "Select a project"}
            </span>
          </span>
          <span
            aria-hidden="true"
            className="hidden text-sm font-semibold text-ink uppercase md:group-[.sidebar-closed]/sidebar:inline"
          >
            {project?.name.slice(0, 1) ?? "P"}
          </span>
          <ChevronDown
            size={14}
            className="text-zinc-400 transition-transform group-data-[state=open]:rotate-180 group-data-[state=open]:text-zinc-700 md:group-[.sidebar-closed]/sidebar:hidden"
          />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={8}
          collisionPadding={16}
          loop
          onCloseAutoFocus={(event) => {
            // Open after the menu releases its focus trap.
            if (openingConnection.current) {
              event.preventDefault();
              openingConnection.current = false;
              onConnect();
            }
          }}
          className="z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-zinc-200 bg-surface p-1.5 shadow-xl shadow-zinc-950/10 outline-none"
        >
          <DropdownMenu.Label className="px-3 py-2.5 text-xs font-medium text-zinc-500">
            Your projects
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={project?._id ?? ""}
            onValueChange={onSelect}
          >
            {projects.map((item) => (
              <ProjectOption key={item._id} project={item} />
            ))}
          </DropdownMenu.RadioGroup>
          {!projects.length && (
            <p className="px-3 py-4 text-sm leading-6 text-zinc-500">
              Connect your first deployment to start monitoring.
            </p>
          )}
          <DropdownMenu.Separator className="mx-2 my-1.5 h-px bg-zinc-100" />
          <DropdownMenu.Item
            onSelect={() => {
              openingConnection.current = true;
            }}
            className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-zinc-600 outline-none select-none data-[highlighted]:bg-zinc-100 data-[highlighted]:text-zinc-900"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-dashed border-zinc-300">
              <Plus size={17} />
            </span>
            Connect project
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ProjectOption({ project }: { project: Project }) {
  const intent = useNavigationIntent({
    kind: "project",
    projectId: project._id,
  });
  return (
    <DropdownMenu.RadioItem
      {...intent}
      value={project._id}
      textValue={project.name}
      className="group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-3 outline-none select-none data-[highlighted]:bg-zinc-100 data-[state=checked]:bg-zinc-50"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-zinc-900">
          {project.name}
        </span>
        <span className="mt-0.5 block truncate text-xs text-zinc-500">
          {new URL(project.deploymentUrl).hostname}
        </span>
      </span>
      <span className="size-4 shrink-0 text-zinc-800">
        <DropdownMenu.ItemIndicator>
          <Check size={16} />
        </DropdownMenu.ItemIndicator>
      </span>
    </DropdownMenu.RadioItem>
  );
}
