# Setup: accounts and custody (NEAR mainnet, tiny amounts)

The repo never sees a full-access key. It generates two narrow keys; you authorize their
**public** halves from your own wallet. Background: docs/decisions.md D1, D4, D9, D10.

## 0. Prerequisites

- Node ≥ 22 and pnpm (`corepack enable`), then `pnpm install`.
- A NEAR mainnet account you control in a NEAR Wallet Selector wallet (tested with Meteor),
  funded with about **1 NEAR**. You need about 0.62 NEAR for setup and the 0.5 wNEAR deposit; the rest is gas.
- If the repo runs on a remote machine, reach the setup page through an SSH tunnel:
  `ssh -N -L 5174:127.0.0.1:5174 <user>@<host>` (the page binds to 127.0.0.1 only).

## 1. Name the treasury and recipients in `config.yaml`

`accounts.treasury` is your account. `counterparties` (vendor) and `revenue_split` recipients
can be any account IDs you control. Sub-account IDs of your account that do not exist yet are
fine: they only hold balances inside `intents.near`, and only you can create them later (D9).
`accounts.revenue` is filled in at step 4.

## 2. Generate the runtime keys

```bash
pnpm keygen
```

This writes `.env` (mode 600) and prints only the two public keys.

## 3. Approve the setup transactions in your wallet

```bash
pnpm setup:wallet
```

Open http://localhost:5174, click **Connect Meteor**, then approve each step in order. The page
shows each step's live on-chain status and never handles your key.

| Step | Transaction (signed in your wallet) | Why |
|---|---|---|
| Scoped key | `AddKey TREASURY_PK`: function-call only, receiver `intents.near`, method `execute_intents`, allowance 0.25 NEAR | The runtime can submit intents and do nothing else on your account. |
| Register | `intents.near.add_public_key(TREASURY_PK)`, 1 yoctoNEAR | The same key may sign intents for your balance inside the verifier. |
| Deposit | `wrap.near`: `storage_deposit` (if needed), `near_deposit 0.5`, `ft_transfer_call 0.5 → intents.near` (msg `""`) | Funds the treasury inside the verifier (cap: D5). |
| Revenue funding | plain transfer 0.05 NEAR → revenue implicit account | Creates the revenue account (D10) and covers prepaid gas for the final step. Unused gas is refunded, and the leftover stays yours. |
| Gas top-up | only shown if the revenue account holds < 0.04 NEAR | Prepaid gas is charged at up to 10× the base price before refund. |

The last step, **Run**, needs no wallet. The setup server signs as the revenue implicit account
with a one-time key that exists only in its memory:

1. `intents.near`: `add_public_key(REVENUE_PK)` + `remove_public_key(one-time key)`
2. the account: `AddKey(your wallet key, FullAccess)` + `DeleteKey(one-time key)`

Do not restart `pnpm setup:wallet` between the revenue funding and **Run**. The one-time key
lives only in that process, and a restart strands the 0.05 NEAR.

## 4. Record the revenue account, then check

Put the revenue implicit account ID shown on the page into `config.yaml` as
`accounts.revenue`, bump `version`, and commit. This is a policy change, so it goes through git.

```bash
pnpm preflight
```

`preflight` is read-only. It refuses to continue if the treasury key is full-access, targets
anything but `intents.near.execute_intents`, or if either key is not registered in the verifier.
`pnpm tsx scripts/demo/verify-setup.ts` prints every key on both accounts and in the verifier.

## 5. Run

```bash
pnpm demo
```

```bash
pnpm demo:halt
```

```bash
pnpm verify
```

`pnpm demo` and `pnpm demo:halt` broadcast real mainnet transfers of the configured tiny amounts.
`pnpm verify` is read-only.

### Selling a report (the business loop)

The Analyst writes reports with NEAR AI Cloud. Put your key in `.env` without it showing on screen
or in shell history:

```bash
read -rs -p "NEAR AI key: " K && printf 'NEARAI_API_KEY=%s\n' "$K" >> .env && unset K && echo
```

```bash
pnpm demo --mode=sale
```

This pays about $0.05 of wNEAR from the treasury's intents balance to a 1Click deposit address. 1Click
delivers $0.05 USDC to the revenue account, which is then split 70/30. One AI call, capped at $0.02
by policy, writes the report. The report is at `/reports/<id>`. Add `--subject=<account>` to report on
another account.

### Orders from outside customers

Customers order at `/buy` on the web app and pay 1Click from their own chain. The order page
starts fulfilment once 1Click reports the payment as complete. To also catch orders whose
customer closed the page, run this every few minutes, for example from cron:

```bash
pnpm demo --mode=fulfil
```

## Revoking

From your wallet: delete the `TREASURY_PK` access key from your account, and call
`intents.near.remove_public_key` (1 yoctoNEAR) from each account for its registered key.

## Why not near-cli or a named revenue sub-account?

- **near-cli:** with no OS keychain, near-cli stores full-access keys as plaintext files (D9).
- **Named sub-account:** Meteor blocks any transaction that adds a full-access key, so a named revenue
  sub-account can't be given an owner key from the wallet (D10).
