import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // self-contained server for the Dockerfile (node server.js)
  output: "standalone",
  // the README is this app's guide for AI agents; do not let next dev write its own AGENTS.md here
  agentRules: false,
}

export default nextConfig
