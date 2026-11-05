import "./polyfills.ts";
import { PublicKey } from "@near-js/crypto";
import { actionCreators } from "@near-js/transactions";
import { setupWalletSelector, type Wallet } from "@near-wallet-selector/core";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";

type Status = {
  treasury: string;
  revenue: string;
  treasuryPk: string;
  revenuePk: string;
  ephemeralPk: string;
  ownerFullAccessKeys: string[];
  nearBalance: string;
  wrapRegistered: boolean;
  intentsBalance: string;
  steps: Record<string, boolean | unknown>;
};

const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;
const $ = (id: string) => document.getElementById(id) as HTMLElement;
// Every page log line and uncaught error is mirrored to the local setup server (127.0.0.1 only)
// so the operator can read failures from the terminal. No keys or secrets pass through here.
const report = (line: string) => {
  void fetch("/api/client-log", { method: "POST", body: line }).catch(() => {});
};
const log = (s: string) => {
  report(s);
  $("log").textContent = `${new Date().toLocaleTimeString()}  ${s}\n${$("log").textContent ?? ""}`;
};
const describe = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ""}` : JSON.stringify(e));
window.addEventListener("error", (ev) => log(`uncaught: ${describe(ev.error ?? ev.message)}`));
window.addEventListener("unhandledrejection", (ev) => log(`unhandled rejection: ${describe(ev.reason)}`));
log(`page loaded (${navigator.userAgent})`);
const near = (yocto: string) => (Number(BigInt(yocto) / 10n ** 18n) / 1e6).toFixed(4);

let wallet: Wallet | undefined;
let s: Status | undefined;

const selector = await setupWalletSelector({ network: "mainnet", modules: [setupMeteorWallet()], debug: true }).catch((e: unknown) => {
  log(`wallet selector setup failed: ${describe(e)}`);
  throw e;
});
log("wallet selector ready");

async function refresh() {
  const r = await fetch("/api/status");
  const body = (await r.json()) as Status | { error: string };
  if ("error" in body) return log(`status error: ${body.error}`);
  s = body;
  render();
}

interface Step {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  run?: () => Promise<void>;
  needsWallet: boolean;
}

function steps(st: Status): Step[] {
  const k = st.steps;
  const owner = st.ownerFullAccessKeys[0];
  return [
    {
      id: "funded",
      title: `Fund ${st.treasury} with about 1 NEAR`,
      detail: `Current balance ${near(st.nearBalance)} NEAR. Send NEAR to this account from Meteor or an exchange, then refresh. Needed: 0.5 deposit + ~0.02 revenue account + gas.`,
      done: Boolean(k["funded"]),
      needsWallet: false,
    },
    {
      id: "fcKey",
      title: "Add Athera's scoped key to your account",
      detail: `AddKey ${st.treasuryPk} → function-call only: receiver intents.near, method execute_intents, gas allowance 0.25 NEAR. It cannot transfer NEAR or call anything else.`,
      done: Boolean(k["fcKey"]),
      needsWallet: true,
      run: () =>
        send(st.treasury, [
          actionCreators.addKey(PublicKey.from(st.treasuryPk), actionCreators.functionCallAccessKey("intents.near", ["execute_intents"], NEAR / 4n)),
        ]),
    },
    {
      id: "treasuryRegistered",
      title: "Register that key inside NEAR Intents",
      detail: `intents.near.add_public_key(${st.treasuryPk}) · deposit 1 yoctoNEAR. Lets the key sign intents for ${st.treasury}'s balance inside intents.near.`,
      done: Boolean(k["treasuryRegistered"]),
      needsWallet: true,
      run: () => send("intents.near", [actionCreators.functionCall("add_public_key", { public_key: st.treasuryPk }, 30n * TGAS, 1n)]),
    },
    {
      id: "deposited",
      title: "Deposit 0.5 wNEAR into NEAR Intents",
      detail: `wrap.near: ${st.wrapRegistered ? "" : "storage_deposit 0.00125 NEAR, "}near_deposit 0.5 NEAR, ft_transfer_call 0.5 wNEAR → intents.near (msg "" = credit ${st.treasury}). Current intents balance ${near(st.intentsBalance)} wNEAR.`,
      done: Boolean(k["deposited"]),
      needsWallet: true,
      run: () =>
        send("wrap.near", [
          ...(st.wrapRegistered ? [] : [actionCreators.functionCall("storage_deposit", { account_id: st.treasury, registration_only: true }, 30n * TGAS, 1_250_000_000_000_000_000_000n)]),
          actionCreators.functionCall("near_deposit", {}, 30n * TGAS, NEAR / 2n),
          actionCreators.functionCall("ft_transfer_call", { receiver_id: "intents.near", amount: (NEAR / 2n).toString(), msg: "" }, 150n * TGAS, 1n),
        ]),
    },
    {
      id: "revenueAccount",
      title: "Fund the revenue account with 0.05 NEAR",
      detail: `Plain transfer to ${st.revenue}, the implicit account of a one-time setup key held only in the setup server's memory. (Meteor blocks adding full-access keys, so this replaces creating a named sub-account.) Covers storage (~0.002) and prepaid gas for the two setup transactions (20 Tgas, charged at up to 10× the base gas price, then refunded).`,
      done: Boolean(k["revenueAccount"]),
      needsWallet: true,
      run: () => send(st.revenue, [actionCreators.transfer(NEAR / 20n)]),
    },
    {
      id: "revenueGas",
      title: "Top up the revenue account for gas (only if short)",
      detail: `NEAR requires the signer to prepay the attached gas (60 Tgas ≈ 0.06 NEAR at the current price); 0.02 NEAR is not enough, which caused INVALID_TRANSACTION. Unused gas is refunded. Current balance ${near(String((st as unknown as { revenueBalance?: string }).revenueBalance ?? "0"))} NEAR; leftover stays in the account, which becomes yours in the next step.`,
      done: BigInt((st as unknown as { revenueBalance?: string }).revenueBalance ?? "0") >= (NEAR * 4n) / 100n || (Boolean(k["revenueRegistered"]) && !k["ephemeralOnRevenue"]),
      needsWallet: true,
      run: () => send(st.revenue, [actionCreators.transfer(NEAR / 10n)]),
    },
    {
      id: "revenueRegistered",
      title: "Register the revenue intent key and hand the account to you",
      detail: owner
        ? `Signed by the one-time key (no wallet): intents.near add_public_key(${st.revenuePk}) + remove_public_key(setup key); then on ${st.revenue}: AddKey YOUR key ${owner} (full access) + DeleteKey setup key.`
        : "Your account has no full-access key visible on-chain; cannot continue.",
      done: Boolean(k["revenueRegistered"]) && !k["ephemeralOnRevenue"] && !k["setupKeyInVerifier"] && Boolean(k["ownerOnRevenue"]),
      needsWallet: false,
      run: async () => {
        const r = await fetch("/api/finish-revenue", { method: "POST" });
        const b = (await r.json()) as Record<string, string>;
        log(r.ok ? `done: ${Object.entries(b).map(([k, v]) => `${k} https://nearblocks.io/txns/${v}`).join("  ")}` : `failed: ${b["error"]}`);
      },
    },
  ];
}

async function send(receiverId: string, actions: ReturnType<typeof actionCreators.transfer>[]) {
  if (!wallet || !s) throw new Error("connect Meteor first");
  log(`asking Meteor to approve: ${receiverId} (${actions.length} action${actions.length > 1 ? "s" : ""})`);
  // signAndSendTransactions opens Meteor's approval window and signs with the account's
  // full-access key. The singular variant signs locally with Meteor's limited sign-in key,
  // which cannot AddKey, CreateAccount or attach deposits.
  const slow = setTimeout(() => log("still waiting on Meteor after 45s. If its window still says 'Receiving details', close it and click Approve again."), 45_000);
  let outs: unknown;
  try {
    outs = await wallet.signAndSendTransactions({ transactions: [{ signerId: s.treasury, receiverId, actions }] });
  } finally {
    clearTimeout(slow);
  }
  log(`Meteor returned: ${JSON.stringify(outs, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))?.slice(0, 800)}`);
  const hashes = (Array.isArray(outs) ? (outs as unknown[]) : [])
    .map((o) => (o && typeof o === "object" && "transaction" in o ? (o.transaction as { hash: string }).hash : undefined))
    .filter(Boolean);
  log(hashes.length ? `sent ${hashes.map((h) => `https://nearblocks.io/txns/${h}`).join(" ")}` : "sent (Meteor returned no hash; status refreshes from chain)");
}

function render() {
  if (!s) return;
  const list = steps(s);
  const firstOpen = list.findIndex((x) => !x.done);
  $("steps").replaceChildren(
    ...list.map((st, i) => {
      const row = document.createElement("div");
      row.className = "step";
      const n = document.createElement("div");
      n.className = "n";
      n.textContent = String(i + 1).padStart(2, "0");
      const body = document.createElement("div");
      body.innerHTML = `<div class="what"></div><div class="detail mono"></div>`;
      (body.firstElementChild as HTMLElement).textContent = st.title;
      (body.lastElementChild as HTMLElement).textContent = st.detail;
      const right = document.createElement("div");
      if (st.done) {
        right.innerHTML = `<span class="state done">done</span>`;
      } else if (st.run) {
        const b = document.createElement("button");
        b.textContent = st.needsWallet ? "Approve in Meteor" : "Run";
        b.disabled = i !== firstOpen || (st.needsWallet && !wallet);
        b.onclick = async () => {
          b.disabled = true;
          try {
            await st.run?.();
          } catch (e) {
            log(`error: ${describe(e)}`);
            console.error("[athera setup]", e);
          }
          await refresh();
        };
        right.append(b);
      } else {
        right.innerHTML = `<span class="state todo">waiting</span>`;
      }
      row.append(n, body, right);
      return row;
    }),
  );
  if (firstOpen === -1) log("all steps done. Back in the terminal: pnpm preflight");
}

$("connect").onclick = async () => {
  log("connect clicked");
  try {
    wallet = await selector.wallet("meteor-wallet");
    log("meteor module loaded; requesting sign-in");
    const accounts = await wallet.signIn({ accounts: [] } as never);
    const id = accounts[0]?.accountId;
    $("who").textContent = id ? `connected: ${id}` : "connected";
    if (s && id && id !== s.treasury) log(`warning: connected ${id}, but config.yaml treasury is ${s.treasury}`);
    render();
  } catch (e) {
    log(`connect failed: ${describe(e)}`);
  }
};

if (selector.isSignedIn()) {
  wallet = await selector.wallet();
  $("who").textContent = `connected: ${(await wallet.getAccounts())[0]?.accountId ?? ""}`;
}
await refresh();
setInterval(refresh, 15000);
