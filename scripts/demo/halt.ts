// pnpm halt "reason"   -> engage the operator kill switch (takes effect at the next stage check)
// pnpm halt --release  -> release it (also on the hosted site, when a store is configured)
import { FileKillSwitch } from "@athera/policy";
import { AtheraStore } from "@athera/store";
import { HALT_PATH, loadEnv } from "./wire.ts";

loadEnv();
const ks = new FileKillSwitch(HALT_PATH);
const store = AtheraStore.fromEnv();
if (process.argv.includes("--release")) {
  // Clear the site first: the worker copies a halt from the site back here otherwise.
  if (store) await store.releaseHalt();
  ks.release();
  console.log(`kill switch released${store ? " (here and on the site)" : ""}`);
} else {
  ks.engage(process.argv.slice(2).join(" ") || "operator halt from CLI");
  if (store) await store.engageHalt(ks.state().reason ?? "operator halt", ks.state().since).catch(() => console.warn("could not reach the store; the worker will publish the halt on its next tick"));
  console.log(`kill switch ENGAGED: ${ks.state().reason}`);
}
