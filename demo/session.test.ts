import { describe, expect, test } from "vitest";
import {
  demoOwnerId,
  demoVmDisplayName,
  demoVmSlug,
  normalizeDemoSessionId,
} from "./convex/session";

const SESSION_ID = "3F8A44CD-53BF-4D14-8D64-4B6A69D6C299";

describe("browser-scoped demo VM identity", () => {
  test("derives stable, account-unique identifiers", () => {
    expect(normalizeDemoSessionId(SESSION_ID)).toBe(
      "3f8a44cd-53bf-4d14-8d64-4b6a69d6c299",
    );
    expect(demoOwnerId(SESSION_ID)).toBe(
      "browser:3f8a44cd-53bf-4d14-8d64-4b6a69d6c299",
    );
    expect(demoVmSlug(SESSION_ID)).toBe(
      "convex-demo-3f8a44cd53bf4d148d644b6a69d6c299",
    );
    expect(demoVmDisplayName(SESSION_ID)).toBe("convex-demo-3f8a44cd");
  });

  test("rejects ids that were not minted as browser UUIDs", () => {
    expect(() => normalizeDemoSessionId("shared-demo")).toThrow(
      "Invalid browser session",
    );
  });
});
