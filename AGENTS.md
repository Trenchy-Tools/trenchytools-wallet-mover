<!-- trenchytools:agents -->
## Working on this repo with an AI agent

This app is a starter for the TrenchyTools API (Solana · Robinhood · ETH · BNB). Before changing it:

1. Read https://api.trenchy.tools/AGENTS.md (the API's rules) and https://api.trenchy.tools/openapi.json (every endpoint). Use only endpoints that exist there.
2. Every API call goes through `lib/trenchy.ts`. Add new calls there, one documented method per endpoint.
3. Wallet backup rule: a wallet is written to its JSON file in the wallet folder BEFORE it is used or funded, and nothing funds a wallet whose file is missing (`assertBackedUp`). Never weaken this.
4. Signing happens in this app: the API returns unsigned transactions, this app signs and sends them.
5. Show API errors as returned (message, code, hint, docs). Never print secrets, keys or the API key.
