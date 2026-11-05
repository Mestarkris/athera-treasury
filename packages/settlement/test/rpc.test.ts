import { describe, expect, it } from "vitest";
import { NearRpc } from "../src/index.ts";

const ok = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: "athera", result }), { status: 200 });

describe("NearRpc endpoint rotation", () => {
  it("moves to the next endpoint on 429 and succeeds", async () => {
    const hit: string[] = [];
    const fake = (async (url: string | URL | Request) => {
      hit.push(String(url));
      return String(url).includes("a.example") ? new Response("slow down", { status: 429 }) : ok({ header: { hash: "h", height: 7, timestamp_nanosec: "0" } });
    }) as typeof fetch;
    const rpc = new NearRpc("https://a.example, https://b.example", fake);
    const b = await rpc.block({ finality: "final" });
    expect(b.header.height).toBe(7);
    expect(hit).toEqual(["https://a.example", "https://b.example"]);
  });

  it("treats a JSON-RPC -429 inside HTTP 200 as a rate limit and rotates", async () => {
    const hit: string[] = [];
    const fake = (async (url: string | URL | Request) => {
      hit.push(String(url));
      return String(url).includes("a.example")
        ? new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -429, message: "deprecated" } }), { status: 200 })
        : ok({ header: { hash: "h", height: 9, timestamp_nanosec: "0" } });
    }) as typeof fetch;
    const rpc = new NearRpc("https://a.example,https://b.example", fake);
    expect((await rpc.block({ finality: "final" })).header.height).toBe(9);
    expect(hit).toEqual(["https://a.example", "https://b.example"]);
  });

  it("gives up with an error after cycling every endpoint", async () => {
    const fake = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    const rpc = new NearRpc(["https://a.example"], fake);
    await expect(rpc.block({ finality: "final" })).rejects.toThrow(/HTTP 503/);
  }, 20_000);
});
