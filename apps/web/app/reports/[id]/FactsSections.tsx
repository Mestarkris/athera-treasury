import type { AccountFacts, AccountFactsV2 } from "@athera/agents";
import { Badge, Dot } from "../../../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";

const usd = (n: number | null) => (n === null ? "unpriced" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const amt = (s: string) => Number(s).toLocaleString("en-US", { maximumFractionDigits: 4 });

function Row({ where, asset, amount, value, title }: { where: string; asset: string; amount: string; value: number | null; title?: string }) {
  return (
    <TableRow>
      <TableCell>{where}</TableCell>
      <TableCell title={title} className="max-w-[14rem] truncate">
        {asset}
      </TableCell>
      <TableCell className="num text-right">{amt(amount)}</TableCell>
      <TableCell className="num text-right">{usd(value)}</TableCell>
    </TableRow>
  );
}

function Holdings({ f }: { f: AccountFacts | AccountFactsV2 }) {
  const v2 = "version" in f ? f : null;
  const priced = v2 ? v2.tokens.filter((t) => !t.spam_like) : [];
  const spam = v2 ? v2.tokens.filter((t) => t.spam_like) : [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Holdings</CardTitle>
        <CardDescription>
          Read from NEAR mainnet at block <span className="data">{f.block_height}</span>. Prices from the 1Click token list at that time.
          {v2?.largest_asset_pct !== null && v2?.largest_asset_pct !== undefined ? ` The largest single asset is ${v2.largest_asset_pct}% of the total.` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Table label="Holdings">
          <TableHeader>
            <TableRow>
              <TableHead>Where</TableHead>
              <TableHead>Asset</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <Row where="Account" asset="NEAR" amount={f.native_near} value={f.native_usd} />
            {v2?.staked.map((s) => <Row key={s.pool} where="Staked" asset={`NEAR · ${s.pool}`} amount={s.near} value={s.usd} />)}
            {priced.map((t) => <Row key={t.contract} where="Account" asset={t.symbol} amount={t.amount} value={t.usd} title={t.contract} />)}
            {f.intents.map((h) => <Row key={h.asset} where="NEAR Intents" asset={h.symbol} amount={h.amount} value={h.usd} title={h.asset} />)}
            <TableRow>
              <TableCell colSpan={3} className="font-medium">
                Total of priced assets
              </TableCell>
              <TableCell className="num text-right font-medium">{usd(f.total_usd)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        {spam.length ? (
          <p className="text-sm">
            <Badge variant="danger" className="mr-2">
              <Dot tone="block" />
              {spam.length} spam-like token{spam.length > 1 ? "s" : ""}
            </Badge>
            Unpriced tokens with link-style or “claim” names, usually phishing airdrops: {spam.map((t) => t.symbol).join(", ")}. Don’t visit or interact with them.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Control({ f }: { f: AccountFactsV2 }) {
  const d = f.dao;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Who can move the money</CardTitle>
        <CardDescription>
          {f.keys.full_access === 0
            ? "No full-access key exists on this account: only its contract logic can move funds."
            : `${f.keys.full_access} full-access key${f.keys.full_access > 1 ? "s" : ""} can sign anything for this account, including draining it.`}{" "}
          {f.keys.function_call ? `${f.keys.function_call} limited (function-call) key${f.keys.function_call > 1 ? "s" : ""}.` : ""}
        </CardDescription>
      </CardHeader>
      {d ? (
        <CardContent className="grid gap-4 text-sm">
          <p>
            Sputnik DAO. A transfer passes with{" "}
            <strong className="num">{d.approvals_needed !== null ? `${d.approvals_needed} of ${d.transfer_approvers.length}` : d.threshold}</strong> approvals from:{" "}
            <span className="data">{d.transfer_approvers.join(", ") || "no listed members (token-weighted)"}</span>.
          </p>
          <ul className="text-muted-foreground grid gap-1">
            <li>
              Proposals: <span className="num text-foreground">{d.proposal_count.toLocaleString("en-US")}</span> in total, <span className="num text-foreground">{d.proposals_90d}</span> in the last 90 days.
            </li>
            <li>
              Voting window <span className="num text-foreground">{d.proposal_period_days}</span> days; proposal bond <span className="num text-foreground">{amt(d.proposal_bond_near)} NEAR</span>.
            </li>
            <li>
              Roles:{" "}
              {d.roles.map((r, i) => (
                <span key={r.name}>
                  {i ? "; " : ""}
                  <span className="text-foreground">{r.name}</span> ({r.kind === "everyone" ? "anyone" : `${r.members.length} member${r.members.length === 1 ? "" : "s"}`}
                  {r.can_approve_transfers ? ", approves transfers" : r.can_propose_transfers ? ", can propose" : ""})
                </span>
              ))}
            </li>
          </ul>
        </CardContent>
      ) : null}
    </Card>
  );
}

function Payouts({ f }: { f: AccountFactsV2 }) {
  const t = f.dao?.recent_transfers ?? [];
  if (!f.dao) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent transfer proposals</CardTitle>
        <CardDescription>
          From the DAO’s last 40 proposals. Approved transfers in the last 90 days: <span className="num text-foreground">{usd(f.dao.approved_transfers_usd_90d)}</span> (priced tokens only).
          Descriptions are written by proposers and shown as-is.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {t.length === 0 ? (
          <p className="text-muted-foreground text-sm">No transfer proposals among the recent ones.</p>
        ) : (
          <Table label="Recent transfer proposals">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>To</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {t.map((x) => (
                <TableRow key={x.id}>
                  <TableCell className="num">{x.date}</TableCell>
                  <TableCell className="data max-w-[12rem] truncate" title={x.receiver}>
                    {x.receiver}
                  </TableCell>
                  <TableCell className="num text-right">
                    {amt(x.amount)} {x.symbol}
                  </TableCell>
                  <TableCell>
                    <Badge variant={x.status === "Approved" ? "success" : x.status === "InProgress" ? "warning" : "outline"}>
                      <Dot tone={x.status === "Approved" ? "pass" : x.status === "InProgress" ? "pending" : "idle"} />
                      {x.status === "InProgress" ? "Voting" : x.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-[18rem] truncate" title={x.description}>
                    {x.description}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/** Facts sections of a report: v1 reports show holdings only; v2 adds control, payouts and gaps. */
export function FactsSections({ facts }: { facts: AccountFacts | AccountFactsV2 }) {
  const v2 = "version" in facts ? facts : null;
  return (
    <>
      {v2 ? <Control f={v2} /> : null}
      <Holdings f={facts} />
      {v2 ? <Payouts f={v2} /> : null}
      {v2?.missing.length ? (
        <p className="text-muted-foreground text-sm">
          Could not be read when this report was made, so not covered: {v2.missing.join(", ")}.
        </p>
      ) : null}
    </>
  );
}
