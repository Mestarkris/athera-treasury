// A tiny in-memory stand-in for Upstash's REST API: just the commands AtheraStore uses.
// Used by the tests, and by `tsx packages/store/test/fake-redis.ts <port>` for local end-to-end checks.
import { createServer } from "node:http";

type Val = string | string[] | Map<string, string>;

export function fakeRedis() {
  const db = new Map<string, Val>();
  const list = (k: string) => (db.get(k) as string[] | undefined) ?? [];
  const hash = (k: string) => {
    let h = db.get(k) as Map<string, string> | undefined;
    if (!h) db.set(k, (h = new Map()));
    return h;
  };
  function run([cmd, ...a]: string[]): unknown {
    const k = a[0] ?? "";
    switch (cmd?.toUpperCase()) {
      case "GET":
        return (db.get(k) as string | undefined) ?? null;
      case "SET":
        if (a.includes("NX") && db.has(k)) return null;
        db.set(k, a[1] ?? "");
        return "OK";
      case "DEL":
        return db.delete(k) ? 1 : 0;
      case "LLEN":
        return list(k).length;
      case "RPUSH":
        db.set(k, [...list(k), ...a.slice(1)]);
        return list(k).length;
      case "LRANGE": {
        const l = list(k);
        const start = Number(a[1]);
        const stop = Number(a[2]);
        return l.slice(start, stop < 0 ? l.length + stop + 1 : stop + 1);
      }
      case "LINDEX":
        return list(k).at(Number(a[1])) ?? null;
      case "HSET":
        hash(k).set(a[1] ?? "", a[2] ?? "");
        return 1;
      case "HGET":
        return hash(k).get(a[1] ?? "") ?? null;
      case "HKEYS":
        return [...hash(k).keys()];
      case "HVALS":
        return [...hash(k).values()];
      default:
        throw new Error(`fake redis: unsupported ${cmd}`);
    }
  }
  const respond = (body: unknown) => {
    try {
      return { result: run((body as unknown[]).map(String)) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  };
  const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init.body)) as unknown[];
    return Response.json(url.endsWith("/pipeline") ? (body as unknown[][]).map(respond) : respond(body));
  };
  return { db, fetchImpl };
}

if (import.meta.main) {
  const port = Number(process.argv[2] ?? 8079);
  const { fetchImpl } = fakeRedis();
  createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", async () => {
      const r = await fetchImpl(`http://x${req.url}`, { method: "POST", body: b });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(await r.text());
    });
  }).listen(port, "127.0.0.1", () => console.log(`fake redis on http://127.0.0.1:${port}`));
}
