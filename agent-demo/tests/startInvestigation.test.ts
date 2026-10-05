import { describe, expect, it, vi } from "vitest";
import { investigationStarter } from "../src/startInvestigation";

describe("starting an investigation from the workspace", () => {
  it("creates lazily and sends to the new thread, then starts a fresh thread next time", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");
    const send = vi.fn().mockResolvedValue("run");
    const start = investigationStarter(create);
    expect(create).not.toHaveBeenCalled();
    expect(await start(send)).toBe("first");
    expect(send).toHaveBeenLastCalledWith("first");
    expect(await start(send)).toBe("second");
    expect(send).toHaveBeenLastCalledWith("second");
  });
  it("reuses the empty thread on a send failure and only reports success after sending", async () => {
    const create = vi.fn().mockResolvedValue("retry-thread");
    const start = investigationStarter(create);
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("run");
    await expect(start(send)).rejects.toThrow("offline");
    await expect(start(send)).rejects.toThrow("Your draft is still here");
    expect(await start(send)).toBe("retry-thread");
    expect(create).toHaveBeenCalledTimes(1);
    expect(send.mock.calls).toEqual([
      ["retry-thread"],
      ["retry-thread"],
      ["retry-thread"],
    ]);
  });
  it("allows retry after creation fails without attempting to send", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("thread");
    const send = vi.fn().mockResolvedValue("run");
    const start = investigationStarter(create);
    await expect(start(send)).rejects.toThrow("offline");
    expect(send).not.toHaveBeenCalled();
    expect(await start(send)).toBe("thread");
    expect(create).toHaveBeenCalledTimes(2);
  });
});
