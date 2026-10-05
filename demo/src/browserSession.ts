import { normalizeDemoSessionId } from "../convex/session";

const STORAGE_KEY = "freestyle-convex-demo-browser-id";
let inMemorySessionId: string | undefined;

function createSessionId() {
  return normalizeDemoSessionId(crypto.randomUUID());
}

export function getBrowserSessionId() {
  if (inMemorySessionId) return inMemorySessionId;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      inMemorySessionId = normalizeDemoSessionId(stored);
      return inMemorySessionId;
    }
  } catch {
    // Fall back to a page-scoped id when browser storage is unavailable.
  }

  inMemorySessionId = createSessionId();
  try {
    localStorage.setItem(STORAGE_KEY, inMemorySessionId);
  } catch {
    // The in-memory id still keeps this page isolated.
  }
  return inMemorySessionId;
}

export function rotateBrowserSessionId() {
  inMemorySessionId = createSessionId();
  try {
    localStorage.setItem(STORAGE_KEY, inMemorySessionId);
  } catch {
    // Reloading still picks up the in-memory id when storage is unavailable.
  }
  return inMemorySessionId;
}
