import { ConvexError } from "convex/values";
export function connectionError(error: unknown) {
  return error instanceof ConvexError && typeof error.data === "string"
    ? error.data
    : "Could not complete the connection. Check your credentials and try again.";
}
