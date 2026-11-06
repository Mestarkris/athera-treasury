import { describe, expect, it } from "vitest";
import { AtheraStore, K, RedisRest, storeEnv } from "../src/index.ts";
import { fakeRedis } from "./fake-redis.ts";

const make = () => {
  const f = fakeRedis();
  return { ...f, store: new AtheraStore(new RedisRest({ url: "http://store", token: "t" }, f.fetchImpl)) };
};

describe("hosted store", () => {
  it("reads credentials from the Vercel or Upstash variable names, or none", () => {
    expect(storeEnv({})).toBeNull();
    expect(storeEnv({ KV_REST_API_URL: "https://a.upstash.io/", KV_REST_API_TOKEN: "x" })).toEqual({ url: "https://a.upstash.io", token: "x" });
    expect(storeEnv({ UPSTASH_REDIS_REST_URL: "https://b", UPSTASH_REDIS_REST_TOKEN: "y" })?.url).toBe("https://b");
  });

  it("appends and reads the ledger in order", async () => {
    const { store } = make();
    await store.redis.cmd("RPUSH", K.ledger, JSON.stringify({ seq: 0 }), JSON.stringify({ seq: 1 }), JSON.stringify({ seq: 2 }));
    expect(await store.ledgerLength()).toBe(3);
    expect(await store.ledgerFrom<{ seq: number }>(1)).toEqual([{ seq: 1 }, { seq: 2 }]);
  });

  it("keeps the first halt's reason when engaged twice, and clears it on release", async () => {
    const { store } = make();
    await store.engageHalt("first", "2026-11-06T00:00:00Z");
    const h = await store.engageHalt("second");
    expect(h).toEqual({ reason: "first", since: "2026-11-06T00:00:00Z" });
    await store.releaseHalt();
    expect(await store.halt()).toBeNull();
  });

  it("stores documents by id", async () => {
    const { store } = make();
    await store.hset(K.orders, "o1", { id: "o1", status: "awaiting_payment" });
    expect(await store.hget(K.orders, "o1")).toEqual({ id: "o1", status: "awaiting_payment" });
    expect(await store.hget(K.orders, "nope")).toBeNull();
    expect(await store.hkeys(K.orders)).toEqual(["o1"]);
  });

  it("surfaces store errors instead of returning empty data", async () => {
    const { store } = make();
    await expect(store.redis.cmd("FLUSHALL")).rejects.toThrow(/unsupported FLUSHALL/);
    await expect(store.redis.pipeline([["GET", "a"], ["NOPE"]])).rejects.toThrow(/pipeline failed/);
  });
});
