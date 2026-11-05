import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@athera/ledger", "@athera/policy", "@athera/agents", "@athera/settlement"],
  poweredByHeader: false,
};

export default config;
