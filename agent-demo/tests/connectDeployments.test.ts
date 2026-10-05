import { expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";
import {
  connectDeployments,
  type DeploymentResult,
} from "../src/connectDeployments";

it("keeps successful connections when another fails and retries failures independently", async () => {
  const results: Record<string, DeploymentResult> = {};
  const update = (name: string, result: DeploymentResult) => {
    results[name] = result;
  };
  const connect = vi.fn(async (name: string) => {
    if (name === "production") throw new ConvexError("Project Admin required.");
    return `id-${name}`;
  });
  await connectDeployments(
    ["development", "production", "development"],
    connect,
    update,
  );
  expect(results.development).toEqual({
    state: "connected",
    projectId: "id-development",
  });
  expect(results.production).toEqual({
    state: "error",
    message: "Project Admin required.",
  });
  expect(connect).toHaveBeenCalledTimes(2);
  connect.mockImplementation(async (name) => `id-${name}`);
  await connectDeployments(
    Object.keys(results).filter((name) => results[name].state === "error"),
    connect,
    update,
  );
  expect(connect).toHaveBeenCalledTimes(3);
  expect(results.production.state).toBe("connected");
});

it("bounds concurrent verifications and sanitizes unexpected provider failures", async () => {
  let active = 0,
    peak = 0;
  const outcomes: DeploymentResult[] = [];
  await connectDeployments(
    ["a", "b", "c", "d", "e"],
    async () => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      throw new Error("private-provider-key");
    },
    (_name, result) => outcomes.push(result),
  );
  expect(peak).toBe(3);
  expect(outcomes.filter((r) => r.state === "error")).toHaveLength(5);
  expect(JSON.stringify(outcomes)).not.toContain("private-provider-key");
});
