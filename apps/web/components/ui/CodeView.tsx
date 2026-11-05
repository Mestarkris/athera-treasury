import styles from "./CodeView.module.css";

type Tok = { t: "comment" | "key" | "value" | "punct" | "plain"; s: string };

/** Line tokenizer for YAML: keys, scalar values, comments. Read-only display; no parsing semantics. */
function tokenize(line: string): Tok[] {
  const out: Tok[] = [];
  const hash = line.search(/(^|\s)#/);
  const code = hash === -1 ? line : line.slice(0, hash);
  const comment = hash === -1 ? "" : line.slice(hash);
  const m = /^(\s*-?\s*)([A-Za-z0-9_.":\-]+)(:)(\s*)(.*)$/.exec(code);
  if (m) {
    out.push({ t: "plain", s: m[1] ?? "" }, { t: "key", s: m[2] ?? "" }, { t: "punct", s: m[3] ?? "" }, { t: "plain", s: m[4] ?? "" });
    if (m[5]) out.push({ t: "value", s: m[5] });
  } else if (code) {
    out.push({ t: "value", s: code });
  }
  if (comment) out.push({ t: "comment", s: comment });
  return out;
}

export function CodeView({ source, label }: { source: string; label: string }) {
  const lines = source.replace(/\n$/, "").split("\n");
  return (
    <figure className={styles.figure}>
      <figcaption className={styles.caption}>{label}</figcaption>
      <pre className={`${styles.pre} data`} tabIndex={0} aria-label={label} translate="no">
        <code>
          {lines.map((line, i) => (
            <span key={i} className={styles.line}>
              <span className={styles.num} aria-hidden="true">
                {i + 1}
              </span>
              {tokenize(line).map((tok, j) => (
                <span key={j} className={styles[tok.t]}>
                  {tok.s}
                </span>
              ))}
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}
