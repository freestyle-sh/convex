import { describe, expect, it } from "vitest";
import {
  deploymentOrigin,
  keyPrefix,
  parseArgs,
  requireFunction,
  validateApproval,
} from "../convex/lib/policy";
import {
  boundedBody,
  normalizeEvent,
  redact,
  verifySignature,
} from "../convex/lib/events";
const policy = {
  enabled: true,
  permissions: {
    readLogs: true,
    runQueries: true,
    analyze: true,
    proposeChanges: true,
  },
  allowedQueries: ["health:read"],
  allowedMutations: ["jobs:retry"],
  policyVersion: 3,
};

describe("target and function boundaries", () => {
  it("rejects lookalike, private, credential-bearing, and path-bearing URLs", () => {
    expect(deploymentOrigin("https://my-app-123.convex.cloud")).toBe(
      "https://my-app-123.convex.cloud",
    );
    for (const url of [
      "http://my-app.convex.cloud",
      "https://my-app.convex.cloud.evil.test",
      "https://127.0.0.1",
      "https://u:p@my-app.convex.cloud",
      "https://my-app.convex.cloud/api",
      "https://my-app.convex.cloud?host=evil",
      "https://my-app.convex.cloud:8443",
    ])
      expect(() => deploymentOrigin(url)).toThrow();
  });
  it("does not allow a user to select unrelated backend secrets", () => {
    expect(keyPrefix("TARGET_APP")).toBe("TARGET_APP");
    for (const ref of [
      "FREESTYLE_API_KEY",
      "OPERATOR_TOKEN",
      "TARGET_",
      "TARGET_APP\n",
    ])
      expect(() => keyPrefix(ref)).toThrow();
  });
  it("allows valid query reads while checking project state and mutation permissions", () => {
    expect(() => requireFunction(policy, "query", "health:read")).not.toThrow();
    expect(() =>
      requireFunction(
        {
          ...policy,
          allowedQueries: [],
          permissions: { ...policy.permissions, runQueries: false },
        },
        "query",
        "health:readMore",
      ),
    ).not.toThrow();
    for (const path of ["_system/cli:query", "../health:read"])
      expect(() => requireFunction(policy, "query", path)).toThrow();
    expect(() =>
      requireFunction({ ...policy, enabled: false }, "query", "health:read"),
    ).toThrow();
    expect(() =>
      requireFunction(
        {
          ...policy,
          permissions: { ...policy.permissions, proposeChanges: false },
        },
        "mutation",
        "jobs:retry",
      ),
    ).toThrow();
  });
  it("rejects reused, stale, expired, and newly disallowed proposals", () => {
    const proposal = {
      state: "pending",
      policyVersion: 3,
      expiresAt: 200,
      functionPath: "jobs:retry",
    };
    expect(() => validateApproval(policy, proposal, 100)).not.toThrow();
    for (const state of ["executing", "executed", "rejected", "uncertain"])
      expect(() =>
        validateApproval(policy, { ...proposal, state }, 100),
      ).toThrow();
    expect(() => validateApproval(policy, proposal, 200)).toThrow();
    expect(() =>
      validateApproval({ ...policy, policyVersion: 4 }, proposal, 100),
    ).toThrow();
    expect(() =>
      validateApproval({ ...policy, allowedMutations: [] }, proposal, 100),
    ).toThrow();
    expect(() => parseArgs("[]")).toThrow();
    expect(() => parseArgs("null")).toThrow();
  });
});
describe("untrusted log ingestion", () => {
  it("verifies the exact raw body and rejects changed bodies and malformed signatures", async () => {
    const body = '[{"timestamp":123,"message":"ok"}]',
      secret = "sample-webhook-secret";
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const bytes = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
    );
    const sig =
      "sha256=" +
      [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(await verifySignature(body, sig, secret)).toBe(true);
    expect(await verifySignature(body + " ", sig, secret)).toBe(false);
    expect(await verifySignature(body, sig, "wrong")).toBe(false);
    expect(await verifySignature(body, "sha256=zz", secret)).toBe(false);
  });
  it("normalizes both transports and deduplicates identical events stably", async () => {
    const a = await normalizeEvent(
      { timestamp: 100, identifier: "f:x", error: "failed" },
      "poll",
    );
    const b = await normalizeEvent(
      { timestamp: 100, identifier: "f:x", error: "failed" },
      "poll",
    );
    expect(a.timestamp).toBe(100_000);
    expect(a.eventId).toBe(b.eventId);
    expect(a.level).toBe("error");
    expect(
      (
        await normalizeEvent(
          {
            timestamp: 100_000,
            topic: "console",
            function: { path: "f:x" },
            level: "error",
            message: "failed",
          },
          "webhook",
        )
      ).timestamp,
    ).toBe(100_000);
    expect(
      (
        await normalizeEvent(
          {
            timestamp: 100_000,
            topic: "console",
            log_level: "ERROR",
            message: "failed",
          },
          "webhook",
        )
      ).level,
    ).toBe("error");
    expect(
      (
        await normalizeEvent(
          {
            timestamp: 100_000,
            topic: "function_execution",
            status: "failure",
          },
          "webhook",
        )
      ).level,
    ).toBe("error");
    await expect(
      normalizeEvent({ timestamp: "bad" }, "poll"),
    ).rejects.toThrow();
  });
  it("caps bodies independently of content-length and redacts common credentials", async () => {
    await expect(
      boundedBody(
        new Request("https://example.test", { method: "POST", body: "123456" }),
        5,
      ),
    ).rejects.toThrow();
    expect(
      redact("Authorization: Bearer sample-private-key password=abc"),
    ).not.toContain("sample-private-key");
    expect(
      redact("Authorization: Bearer sample-private-key password=abc"),
    ).not.toContain("abc");
  });
});
