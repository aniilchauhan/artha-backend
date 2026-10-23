# `@anvi/axion`

Axion's private, local npm facade for ANVI and other trusted code in this workspace.
It does not start the Axion Next.js server.

## Exports

```js
import {
  status,
  market,
  predictions,
  paperPortfolio,
  scan,
} from '@anvi/axion';
```

- `status()` reports that the local package is available.
- `market({ limit = 6 })` fetches live indices and up to 50 provider-backed equities. It does not return simulated fallback quotes.
- `predictions({ minScore = 70, limit = 5 })` reads predictions only when their artifact provenance is verified.
- `paperPortfolio()` reads the local paper-prediction ledger and cohort summaries.
- `scan()` explicitly runs Axion's bounded `core50` fast Python scan. It can use configured providers, job leases, and the Python runtime, and may update scanner artifacts. It is never run during import.

All calls are asynchronous where they perform I/O. Provider failures reject or return an explicit unavailable state; they are not replaced with fabricated market data.

## Local workspace use

The package is private and is not a self-contained published npm release. It requires the Axion project tree, its installed Node dependencies, configured data/artifacts, and the Python environment for `scan()`.

ANVI installs this sibling package through `integrations/node/package.json` and invokes it through the local stdin/stdout bridge. A consumer outside the Axion working directory is supported: paths resolve from this package's project root, not the caller's current directory.

```js
const report = await predictions({ minScore: 70, limit: 5 });
```
