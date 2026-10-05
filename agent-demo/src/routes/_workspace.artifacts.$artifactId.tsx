import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_workspace/artifacts/$artifactId")({
  component: () => null,
});
