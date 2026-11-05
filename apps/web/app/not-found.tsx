import Link from "next/link";
import { buttonVariants } from "../components/ui/button";
import { PageHeader } from "../components/ui/page-header";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <PageHeader
      title="Nothing at this address"
      description="No page or ledger entry matches this URL. Ledger entry IDs are 16 hex characters; check for a stray character at the end of the address."
      actions={
        <>
          <Link href="/ledger" className={buttonVariants()}>
            Open the ledger
          </Link>
          <Link href="/" className={buttonVariants({ variant: "outline" })}>
            Control room
          </Link>
        </>
      }
    />
  );
}
