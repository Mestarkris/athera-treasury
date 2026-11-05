import Link from "next/link";
import page from "../components/ui/page.module.css";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div className={page.head}>
      <h1>Nothing at this address</h1>
      <p className={page.lead}>
        No page or ledger entry matches this URL. Ledger entry IDs are 16 hex characters; check for a stray character at the end of the address.
      </p>
      <p>
        <Link href="/ledger">Open the ledger</Link> or go to the <Link href="/">control room</Link>.
      </p>
    </div>
  );
}
