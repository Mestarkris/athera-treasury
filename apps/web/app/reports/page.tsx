import Link from "next/link";
import { Card, CardContent } from "../../components/ui/card";
import { PageHeader } from "../../components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { listReports, loadPolicy } from "../../lib/ledger";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

export default function ReportsPage() {
  const reports = listReports();
  const sales = loadPolicy().config.sales;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Treasury reports"
        description={`What Athera sells: an AI-written review of a NEAR account's treasury, built only from public chain data. Each one is paid for through 1Click in USDC${sales ? ` ($${sales.min_price_usd}–$${sales.max_price_usd})` : ""}, and every payment, revenue split and AI cost is in the public ledger.`}
        actions={
          <Link href="/buy" className="text-sm font-medium underline underline-offset-4">
            Buy a report
          </Link>
        }
      />
      <Card>
        <CardContent>
          {reports.length === 0 ? (
            <p className="text-muted-foreground text-sm">No reports sold yet. Run a sale from the Run page, or with pnpm demo --mode=sale on the server.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Report</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">AI cost</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-[28rem] whitespace-normal">
                      <Link href={`/reports/${r.id}`} className="font-medium underline underline-offset-4">
                        {r.analysis.headline}
                      </Link>
                    </TableCell>
                    <TableCell className="data [overflow-wrap:anywhere] whitespace-normal">{r.subject}</TableCell>
                    <TableCell className="data text-right">${r.price_usd}</TableCell>
                    <TableCell className="data text-right">${Number(r.cost_usd).toFixed(4)}</TableCell>
                    <TableCell className="data">{r.created_at.slice(0, 10)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
