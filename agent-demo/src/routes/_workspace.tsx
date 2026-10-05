import { createFileRoute, Outlet } from "@tanstack/react-router";
import { App } from "../App";

export const Route = createFileRoute("/_workspace")({
  ssr: false,
  // Preserve the workspace and unsent drafts across chat and artifact routes.
  component: () => (
    <>
      <App />
      <Outlet />
    </>
  ),
});
