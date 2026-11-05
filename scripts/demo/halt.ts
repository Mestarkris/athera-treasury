// pnpm halt "reason"   -> engage the operator kill switch (takes effect at the next stage check)
// pnpm halt --release  -> release it
import { FileKillSwitch } from "@athera/policy";
import { HALT_PATH } from "./wire.ts";

const ks = new FileKillSwitch(HALT_PATH);
if (process.argv.includes("--release")) {
  ks.release();
  console.log("kill switch released");
} else {
  ks.engage(process.argv.slice(2).join(" ") || "operator halt from CLI");
  console.log(`kill switch ENGAGED: ${ks.state().reason}`);
}
