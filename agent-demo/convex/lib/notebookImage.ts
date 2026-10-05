"use node";
import { createHash } from "node:crypto";
import { installKernel, kernelScript } from "./jupyterKernel";

// A private, pristine image is reusable only within this workspace, credential,
// base image and exact trusted runtime version. The hash never leaves Convex.
export function notebookImageKey(
  owner: string,
  apiKey: string,
  sourceSnapshot: string,
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        owner,
        apiKey,
        sourceSnapshot,
        installKernel,
        kernelScript,
      ]),
    )
    .digest("hex");
}

export function missingSnapshot(error: unknown) {
  return (error as { status?: number })?.status === 404;
}

export const kernelHealthCheck =
  "curl --fail --silent --max-time 5 http://127.0.0.1:8766/health >/dev/null";
