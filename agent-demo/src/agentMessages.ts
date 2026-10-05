import type { UIMessage } from "@convex-dev/agent/react";
import { getToolName, isToolUIPart } from "ai";
import { readSelectedPrompt } from "../convex/lib/resultSelection";
import { openRouterProviders } from "./messageProviders";
import type { Message, Run } from "./types";

export function agentMessages(
  results: UIMessage[],
  runs: Run[] = [],
): Message[] {
  return results
    .filter(
      (m) =>
        m.agentName !== "Monitor permissions" &&
        !(
          m.role === "assistant" &&
          /^(The user approved one operation with the exact proposed arguments for |Approved operation for |The user declined access for )/.test(
            m.text,
          )
        ),
    )
    .map((m) => ({
      id: m.status === "streaming" ? undefined : m.id,
      key: m.key,
      role: m.role,
      status: m.status,
      thinking:
        m.status === "streaming" &&
        m.parts.some((p) => p.type === "reasoning" && p.state === "streaming"),
      openrouterProviders: openRouterProviders(m),
      queued: runs.some(
        (run) => run.state === "queued" && run.promptMessageId === m.id,
      ),
      ...(m.role === "user"
        ? readSelectedPrompt(m.text)
        : { text: m.text.split("\n\nEvidence from")[0] }),
      tools: m.parts.filter(isToolUIPart).map((p) => ({
        id: p.toolCallId,
        name: getToolName(p),
        state: p.state,
        input: p.input,
        output: "output" in p ? p.output : undefined,
        error: "errorText" in p ? p.errorText : undefined,
      })),
    }));
}
