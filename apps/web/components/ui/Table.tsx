import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import styles from "./Table.module.css";

/** A real <table>. Hairline rows, sticky head, numeric columns right-aligned in the data face. */
export function Table({ caption, children, dense, className, explicitRoles }: { caption: ReactNode; children: ReactNode; dense?: boolean; className?: string | undefined; explicitRoles?: boolean }) {
  // explicitRoles: keep table semantics when CSS changes the table's display (some browsers drop them).
  return (
    <div
      className={`${styles.scroll} ${className ?? ""}`}
      // Wide tables scroll sideways on narrow screens: keyboard users must be able to focus and scroll them.
      tabIndex={0}
      role="region"
      aria-label={typeof caption === "string" ? caption : "Table"}
    >
      <table className={`${styles.table} ${dense ? styles.dense : ""}`} role={explicitRoles ? "table" : undefined}>
        <caption className={styles.caption}>{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function Th({ numeric, className, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <th scope="col" className={`${styles.th} ${numeric ? styles.numeric : ""} ${className ?? ""}`} {...rest} />;
}

export function Td({ numeric, data, className, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean; data?: boolean }) {
  return <td className={`${styles.td} ${numeric ? styles.numeric : ""} ${data || numeric ? "data" : ""} ${className ?? ""}`} translate={data || numeric ? "no" : undefined} {...rest} />;
}

/** A row; `blocked` adds the 2px vermilion left rule. `id` makes it URL-addressable (#id). */
export function Row({ blocked, highlight, className, ...rest }: HTMLAttributes<HTMLTableRowElement> & { blocked?: boolean; highlight?: boolean }) {
  return <tr className={`${styles.row} ${blocked ? styles.blocked : ""} ${highlight ? styles.highlight : ""} ${className ?? ""}`} {...rest} />;
}
