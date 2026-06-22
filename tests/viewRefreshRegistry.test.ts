import { describe, expect, it, vi } from "vitest";
import { ViewRefreshRegistry, type RefreshableView } from "../src/obsidian/viewRefreshRegistry.js";

describe("ViewRefreshRegistry (cross-view invalidation)", () => {
  it("tracks registered views and their count", () => {
    const registry = new ViewRefreshRegistry();
    const a: RefreshableView = { refresh: () => undefined };
    const b: RefreshableView = { refresh: () => undefined };
    registry.register(a);
    registry.register(b);
    expect(registry.size()).toBe(2);
    registry.register(a); // idempotent (Set)
    expect(registry.size()).toBe(2);
  });

  it("notifyMutation refreshes other views but never the origin, and isolates a refresh failure", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const registry = new ViewRefreshRegistry();
    const calls: string[] = [];
    const origin: RefreshableView = { refresh: () => { calls.push("origin"); } };
    const boom: RefreshableView = { refresh: () => { throw new Error("boom"); } };
    const other: RefreshableView = { refresh: () => { calls.push("other"); } };
    registry.register(origin);
    registry.register(boom);
    registry.register(other);

    await registry.notifyMutation(origin);

    expect(calls).toEqual(["other"]); // origin excluded; boom threw but did not block 'other'
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("unregistering a closed view prevents later refresh calls on it", async () => {
    const registry = new ViewRefreshRegistry();
    const calls: string[] = [];
    const a: RefreshableView = { refresh: () => { calls.push("A"); } };
    const b: RefreshableView = { refresh: () => { calls.push("B"); } };
    registry.register(a);
    registry.register(b);
    registry.unregister(b);
    expect(registry.size()).toBe(1);

    await registry.notifyMutation();
    expect(calls).toEqual(["A"]); // B was unregistered (closed) and is not refreshed
  });

  it("awaits async refreshers", async () => {
    const registry = new ViewRefreshRegistry();
    const order: string[] = [];
    registry.register({ refresh: async () => { await Promise.resolve(); order.push("done"); } });
    await registry.notifyMutation();
    expect(order).toEqual(["done"]);
  });
});
