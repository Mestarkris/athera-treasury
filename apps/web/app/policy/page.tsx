import Link from "next/link";
import { ViewTransition } from "react";
import { Badge } from "../../components/ui/badge";
import { buttonVariants } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { CodeView } from "../../components/ui/code-view";
import { PageHeader } from "../../components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { currentPolicy, loadPolicy, readLedger } from "../../lib/ledger";
import { policyDirty, policyHistory } from "../../lib/policy-history";
import { cn } from "../../lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Policy" };

function Diff({ text }: { text: string }) {
  return (
    <pre tabIndex={0} translate="no" className="data bg-muted/40 overflow-x-auto rounded-lg border p-3 text-xs leading-relaxed">
      {text.split("\n").map((l, i) => (
        <span
          key={i}
          className={cn("block", l.startsWith("+") && "text-success", l.startsWith("-") && "text-destructive", l.startsWith("@@") && "text-muted-foreground")}
        >
          {l}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

export default async function PolicyPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const { v } = await searchParams;
  const policy = await currentPolicy();
  const source = (await loadPolicy()).source;
  const history = await policyHistory();
  const dirty = await policyDirty();
  const selected = v ? history.find((h) => h.commit === v) : undefined;
  const shown = selected
    ? { source: selected.source, version: selected.version ?? "?", hash: selected.hash, key: selected.commit }
    : { source, version: policy.version, hash: policy.hash, key: "current" };
  const { entries } = await readLedger();

  // Policy versions actually used, from the ledger: which hash every check ran under.
  const used = new Map<string, { version: number; checks: number; first: string; last: string }>();
  for (const e of entries) {
    if (e.type !== "policy_check") continue;
    const u = used.get(e.policy.hash) ?? { version: e.policy.version, checks: 0, first: e.ts, last: e.ts };
    u.checks++;
    u.last = e.ts;
    used.set(e.policy.hash, u);
  }
  const checks = entries.filter((e) => e.type === "policy_check").length;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Policy"
        description="The hard limits every agent works inside. Read-only here: the policy changes only through a reviewed commit to config.yaml, and every check records the exact hash it ran under."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* min-w-0: a long config line must scroll inside the code block, not widen the column. */}
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {selected ? "Committed version" : "Current version"}
              <Badge variant="outline" className="data font-normal">
                v{shown.version} · {shown.hash.slice(0, 6)}
              </Badge>
              {!selected && dirty ? <Badge variant="warning">Uncommitted edits</Badge> : null}
            </CardTitle>
            <CardDescription>
              sha256 of the file bytes: <span className="data [overflow-wrap:anywhere]">{shown.hash}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-[minmax(0,1fr)] min-w-0 gap-3">
            {selected ? (
              <Link href="/policy" className={buttonVariants({ variant: "outline", size: "sm", className: "justify-self-start" })}>
                Back to the current version
              </Link>
            ) : null}
            {/* Versions cross-fade (lateral: no slide). Keyed so a version change is an exit + enter. */}
            <ViewTransition key={shown.key} enter="policy-fade" exit="policy-fade" default="none">
              <div className="min-w-0">
                <CodeView source={shown.source} label={`config.yaml, v${shown.version}`} />
              </div>
            </ViewTransition>
          </CardContent>
        </Card>

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Versions used</CardTitle>
              <CardDescription>From the ledger: the policy hash each of {checks} checks ran under.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table label="Policy versions used by checks">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Version</TableHead>
                    <TableHead className="text-right">Checks</TableHead>
                    <TableHead className="text-right">Last (UTC)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...used.entries()].map(([hash, u]) => (
                    <TableRow key={hash}>
                      <TableCell className="data" translate="no" title={hash}>
                        v{u.version} · {hash.slice(0, 6)}
                        {hash === policy.hash ? <span className="text-muted-foreground font-sans"> (current)</span> : null}
                      </TableCell>
                      <TableCell className="data text-right">{u.checks}</TableCell>
                      <TableCell className="data text-right">{u.last.slice(5, 16).replace("T", " ")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Version history</CardTitle>
              <CardDescription>Every committed change to config.yaml, newest first. Straight from git.</CardDescription>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-muted-foreground text-sm">No committed versions yet. Each commit of config.yaml appears here with its hash and diff.</p>
              ) : (
                <ol className="grid grid-cols-[minmax(0,1fr)] gap-4">
                  {history.map((h) => (
                    <li key={h.commit} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge variant="outline" className="data font-normal">
                          v{h.version ?? "?"} · {h.hash.slice(0, 6)}
                        </Badge>
                        {h.hash === policy.hash ? <Badge variant="success">Current</Badge> : null}
                      </div>
                      <p className="text-sm">{h.subject}</p>
                      <p className="text-muted-foreground text-xs">
                        commit <span className="data">{h.commit.slice(0, 7)}</span> on {h.date.slice(0, 10)}
                      </p>
                      <Link href={`/policy?v=${h.commit}`} scroll={false} className="text-sm underline underline-offset-4">
                        Show this version
                      </Link>
                      {h.diff ? <Diff text={h.diff} /> : <p className="text-muted-foreground text-xs">First committed version.</p>}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
