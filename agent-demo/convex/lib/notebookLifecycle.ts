// Preserve the chat's kernel and disk; idle time pauses compute instead of deleting it.
export const notebookVmOptions = {
  ttlSeconds: -1,
  autoDeleteSeconds: -1,
  idleTimeoutSeconds: 600,
};
