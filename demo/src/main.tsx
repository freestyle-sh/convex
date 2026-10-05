import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import App from "./App";
import "./styles.css";

const deploymentUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;

if (!deploymentUrl) {
  throw new Error("VITE_CONVEX_URL is not configured");
}

const convex = new ConvexReactClient(deploymentUrl);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>
  </StrictMode>,
);
