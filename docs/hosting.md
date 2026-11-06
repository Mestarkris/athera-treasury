# Hosting the site on Vercel

The public site runs on Vercel. The agent, which holds the signing keys, keeps running on the
operator's machine. A small Upstash Redis database sits between them.

```
 customer ──► Vercel (Next.js, no keys) ──► Upstash Redis ◄── pnpm worker (this machine, keys in .env)
              pages, free preview,           orders, ledger,     copies orders here, fulfils paid ones
              order quotes, halt button      reports, halt       with `pnpm demo --mode=fulfil`, publishes
```

## What runs where

**Vercel (no signing keys).** It serves every page and the free preview. It asks 1Click for order
quotes and writes new orders to the store. The halt button also writes to the store. It never
starts a run: `/api/runs` answers 501 in hosted mode.

**`pnpm worker` (this machine, every 30 s):**
1. Copies a halt set on the site into `data/HALT`, and publishes a local halt to the site.
2. Copies new orders into `data/orders/`.
3. When 1Click reports an order as paid, runs `pnpm demo --mode=fulfil --order=<id>`. That is a
   separate process that loads the keys and re-checks the payment, the policy and the halt itself.
4. Publishes the ledger, reports, order status, `config.yaml` and its git history.

**The store** holds only what the public site already shows, plus the orders customers create
there. Refund addresses are shortened on every page.

If the worker is offline, the site keeps working. Paid orders wait, and the order page says the
agent is offline and that the payment is safe. The ledger shown is whatever was last published.

## One-time setup

1. **Put the code on GitHub.** Create an empty private repository, then push:
   `git remote add origin https://github.com/<you>/athera-treasury.git && git push -u origin main`.
2. **Create the Vercel project.** In Vercel, choose Add New → Project and import the repository.
   Set **Root Directory** to `apps/web`. The framework (Next.js) and the install and build
   commands come from `apps/web/vercel.json`. Don't deploy yet.
3. **Add the store.** In the project, open Storage → Create → **Upstash for Redis** (free plan),
   and connect it to the project. This sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` on Vercel.
4. **Optional operator token.** To show the halt button on the live site, add
   `ATHERA_OPERATOR_TOKEN` (a long random string) under Settings → Environment Variables.
   Without it, the site is read-only for everyone and you halt with `pnpm halt` here.
5. **Give the worker the same store.** In the database's `.env.local` tab, copy the URL and the
   token, then run `pnpm store:keys` here (the token is not shown).
6. **Publish, then deploy.** Run `pnpm worker --once`. It prints how many ledger entries it
   published. Then deploy on Vercel. The site shows "The agent has not published its policy
   yet" until this has run once.
7. **Keep the worker running.** Run `pnpm worker` in a terminal, as a systemd user service, or
   from cron with `--once` every minute.

Never add `ATHERA_TREASURY_FC_KEY`, `ATHERA_REVENUE_INTENT_KEY` or `NEARAI_API_KEY` to Vercel.
The site does not need them, and keeping them on this machine is the custody model (D21).

## Kill switch

- **Engage:** use the site's halt button (needs the operator token) or run `pnpm halt "reason"`
  here. A halt on the site reaches this machine on the worker's next tick. Every run also checks
  `data/HALT` before each stage.
- **Release:** run `pnpm halt --release` here only. It clears the site first, then the local
  file. The site has no release button.

## Checking it locally without Vercel

`packages/store/test/fake-redis.ts` is an in-memory stand-in for the Upstash REST API:

```bash
npx tsx packages/store/test/fake-redis.ts 8079 &
KV_REST_API_URL=http://127.0.0.1:8079 KV_REST_API_TOKEN=x pnpm worker --once --no-fulfil
cd apps/web && KV_REST_API_URL=http://127.0.0.1:8079 KV_REST_API_TOKEN=x ATHERA_ROOT=/nonexistent npx next start --port 3001
```

`ATHERA_ROOT=/nonexistent` proves the hosted site reads nothing from this machine's files.
