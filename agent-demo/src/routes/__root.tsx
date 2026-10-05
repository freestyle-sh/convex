import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { NotFound } from "../components/NotFound";
import stylesheet from "../styles.css?url";
import { appName } from "../brand";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#f7f8fa" },
      { title: appName },
    ],
    links: [
      { rel: "stylesheet", href: stylesheet },
      { rel: "icon", href: "data:," },
    ],
  }),
  notFoundComponent: () => <NotFound />,
  component: RootDocument,
});

function RootDocument() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
