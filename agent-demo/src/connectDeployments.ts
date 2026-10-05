import { connectionError } from "./errors";

export type DeploymentResult =
  | { state: "connecting" }
  | { state: "connected"; projectId: string }
  | { state: "error"; message: string };

// Each deployment commits independently. Retry only failed selections, with at
// most three checks running so a quiet project doesn't serialize long polls.
export async function connectDeployments(
  names: string[],
  connect: (name: string) => Promise<string>,
  update: (name: string, result: DeploymentResult) => void,
) {
  const queue = [...new Set(names)];
  await Promise.all(
    Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length) {
        const name = queue.shift()!;
        update(name, { state: "connecting" });
        try {
          update(name, { state: "connected", projectId: await connect(name) });
        } catch (error) {
          update(name, { state: "error", message: connectionError(error) });
        }
      }
    }),
  );
}
