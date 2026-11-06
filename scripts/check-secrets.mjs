#!/usr/bin/env node
// Rejects private-key-like strings in staged files (pre-commit) or in given paths.
// Usage: node scripts/check-secrets.mjs            -> scans staged files
//        node scripts/check-secrets.mjs --all      -> scans every tracked file
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const all = process.argv.includes("--all");
const files = execFileSync("git", all ? ["ls-files"] : ["diff", "--cached", "--name-only", "--diff-filter=ACM"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const patterns = [
  // NEAR secret keys: ed25519: followed by 64+ base58 chars (public keys are ~44 chars).
  // A 64-byte ed25519 *signature* has the same base58 length; values under a "signature" JSON key
  // (e.g. 1Click quote signatures in the ledger) are public and skipped.
  { name: "NEAR ed25519 secret key", re: /(?<!"signature"\s*:\s*")ed25519:[1-9A-HJ-NP-Za-km-z]{70,100}/ },
  { name: "secp256k1 secret key", re: /secp256k1:[1-9A-HJ-NP-Za-km-z]{40,}/ },
  { name: "PEM private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "0x 32-byte hex secret", re: /\b(private|secret)[_-]?key\W{0,4}["'=: ]+0x[0-9a-fA-F]{64}\b/i },
  { name: "assigned secret key value", re: /^[ \t]*[A-Z_]*(SECRET|PRIVATE|FC|INTENT)_KEY[ \t]*=[ \t]*\S+/m },
  { name: "BIP-39 seed phrase field", re: /"?(seed_?phrase|mnemonic)"?\s*[:=]\s*"(\w+\s){11,}\w+"/i },
];

let bad = 0;
for (const f of files) {
  if (/(^|\/)(pnpm-lock\.yaml|node_modules\/)/.test(f) || /\.(png|jpg|pdf|woff2?)$/.test(f)) continue;
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  for (const p of patterns) {
    if (p.re.test(text)) {
      console.error(`✗ ${f}: looks like a ${p.name}`);
      bad++;
    }
  }
}
if (bad) {
  console.error(`\nRefusing: ${bad} secret-like value(s). Secrets belong in .env (gitignored) or custody, never in git.`);
  process.exit(1);
}
console.log(`secret scan: ${files.length} file(s) clean`);
