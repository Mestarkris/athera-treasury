// Node globals the Meteor connector and near-js expect. Imported first in main.ts so it
// evaluates before any library module.
import { Buffer } from "buffer";

const g = globalThis as unknown as { Buffer?: typeof Buffer; global?: unknown; process?: { env: Record<string, string> } };
g.Buffer ??= Buffer;
g.global ??= globalThis;
g.process ??= { env: {} };
