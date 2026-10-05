import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_workspace/chats/$chatId")({
  component: () => null,
});
