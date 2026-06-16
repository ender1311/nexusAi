import { describe, expect, it } from "bun:test";
import { createSegmentMemberLoader } from "@/lib/cron/segment-member-cache";

describe("createSegmentMemberLoader", () => {
  it("fetches a segment only once across repeated calls (cross-agent sharing)", async () => {
    const calls: string[] = [];
    const load = createSegmentMemberLoader(async (name) => {
      calls.push(name);
      return ["a", "b"];
    });

    const first = await load("giving-has-given");
    const second = await load("giving-has-given");

    expect(calls).toEqual(["giving-has-given"]); // one query, not two
    expect([...first]).toEqual(["a", "b"]);
    expect(second).toBe(first); // same resolved Set instance
  });

  it("fetches each distinct segment exactly once", async () => {
    const calls: string[] = [];
    const load = createSegmentMemberLoader(async (name) => {
      calls.push(name);
      return [name];
    });

    await Promise.all([
      load("giving-has-given"),
      load("giving-recurring-active"),
      load("giving-has-given"),
    ]);

    expect(calls.sort()).toEqual(["giving-has-given", "giving-recurring-active"]);
  });

  it("collapses concurrent in-flight calls into a single fetch", async () => {
    let fetches = 0;
    let resolveFetch: (ids: string[]) => void = () => {};
    const load = createSegmentMemberLoader(
      () =>
        new Promise<string[]>((res) => {
          fetches++;
          resolveFetch = res;
        }),
    );

    const p1 = load("seg");
    const p2 = load("seg"); // called while the first is still pending
    resolveFetch(["x"]);
    const [s1, s2] = await Promise.all([p1, p2]);

    expect(fetches).toBe(1);
    expect(s1).toBe(s2);
    expect([...s1]).toEqual(["x"]);
  });

  it("returns a Set built from the fetched ids", async () => {
    const load = createSegmentMemberLoader(async () => ["u1", "u2", "u2"]);
    const set = await load("seg");
    expect(set instanceof Set).toBe(true);
    expect(set.has("u1")).toBe(true);
    expect(set.size).toBe(2); // dedups
  });
});
