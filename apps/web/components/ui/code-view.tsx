type Tok = { t: "comment" | "key" | "value" | "plain"; s: string };

/** Line tokenizer for YAML display: keys, scalar values, comments. Read-only. */
function tokenize(line: string): Tok[] {
  const out: Tok[] = [];
  const hash = line.search(/(^|\s)#/);
  const code = hash === -1 ? line : line.slice(0, hash);
  const comment = hash === -1 ? "" : line.slice(hash);
  const m = /^(\s*-?\s*)([A-Za-z0-9_.":\-]+)(:)(\s*)(.*)$/.exec(code);
  if (m) {
    out.push({ t: "plain", s: m[1] ?? "" }, { t: "key", s: m[2] ?? "" }, { t: "plain", s: `${m[3] ?? ""}${m[4] ?? ""}` });
    if (m[5]) out.push({ t: "value", s: m[5] });
  } else if (code) {
    out.push({ t: "value", s: code });
  }
  if (comment) out.push({ t: "comment", s: comment });
  return out;
}

const TONE: Record<Tok["t"], string> = { key: "text-foreground font-medium", value: "text-foreground/80", comment: "text-muted-foreground", plain: "text-muted-foreground" };

export function CodeView({ source, label }: { source: string; label: string }) {
  const lines = source.replace(/\n$/, "").split("\n");
  return (
    <figure className="m-0 min-w-0">
      <figcaption className="text-muted-foreground pb-2 text-xs">{label}</figcaption>
      <pre tabIndex={0} aria-label={label} translate="no" className="data bg-muted/40 m-0 max-w-full overflow-x-auto rounded-lg border py-3 text-xs leading-relaxed">
        <code>
          {lines.map((line, i) => (
            <span key={i} className="block pr-4">
              <span aria-hidden="true" className="text-muted-foreground mr-3 inline-block w-[4ch] border-r pr-2 text-right select-none">
                {i + 1}
              </span>
              {tokenize(line).map((tok, j) => (
                <span key={j} className={TONE[tok.t]}>
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
