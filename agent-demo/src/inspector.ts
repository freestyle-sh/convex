import type { Message, ToolStep } from "./types";

export function inspectorCells(messages: Message[]) {
  const cells = new Map<string, ToolStep>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const tool of message.tools ?? []) {
      if (tool.name !== "notebook") continue;
      const output = tool.output as { status?: string } | undefined;
      if (["duplicate", "awaiting_approval"].includes(output?.status ?? ""))
        continue;
      cells.set(tool.id, tool);
    }
  }
  const failed = [...cells.values()].filter(
    (tool) =>
      tool.state === "output-error" ||
      ["error", "timeout"].includes(
        (tool.output as { status?: string } | undefined)?.status ?? "",
      ),
  ).length;
  return { total: cells.size, failed };
}
