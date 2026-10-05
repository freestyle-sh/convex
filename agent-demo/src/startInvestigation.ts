/** Retain a newly created thread if sending fails, so a retry doesn't create another. */
export function investigationStarter(createThread: () => Promise<string>) {
  let pendingThread: Promise<string> | undefined;
  return async (send: (threadId: string) => Promise<unknown>) => {
    pendingThread ??= createThread().catch((error: unknown) => {
      pendingThread = undefined;
      throw error;
    });
    const threadId = await pendingThread;
    const result = await send(threadId);
    if (!result)
      throw new Error("Could not send your message. Your draft is still here.");
    pendingThread = undefined;
    return threadId;
  };
}
