# Token Radar (`token-radar-01`)

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/thegoodsxx/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/thegoodsxx/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token opportunity radar and dynamic valuation engine built for the make.fun flagship bounty [`token-radar-01`](https://make.fun/bounty/token-radar-01).

Token Radar scans the frozen DefiLlama protocol universe, isolates all **342 protocols that record no token**, derives an implied market valuation for each from empirical peer metrics, and provides concrete, costed, and timed farm plans.

---

## Intellectual Core: The Implied-Value Model

Unlike static aggregators or raw TVL tables, Token Radar computes valuations dynamically from the snapshot's own figures at runtime:

1. **Peer Multiple $M(P)$**: The runtime median market-cap to TVL ratio of tokenized peers in the protocol's category. To prevent small samples from distorting valuations, Empirical Bayes shrinkage pulls small category cohorts toward the global peer median ($M_{\text{global}} \approx 0.205\text{x}$):
   $$M(P) = \frac{n \cdot M_{\text{cat}} + 6 \cdot M_{\text{global}}}{n + 6}$$
   *(Falls back to $M_{\text{global}}$ when category is null or $n = 0$.)*
2. **Base Valuation $B$**: Grounded in verifiable on-chain capital scaled by peer valuation multiples:
   $$B = \text{tvl\_usd} \times M(P)$$
3. **Momentum Factor $f_{\text{mom}}$**: Derived from 7-day TVL percentage change, bounded so single-week volatility cannot dominate:
   $$f_{\text{mom}} = \text{clamp}\left(1 + \frac{\text{change\_7d}}{100},\ 0.5,\ 2.0\right)$$
4. **Seasoning Factor $f_{\text{age}}$**: Longevity premium for established protocols that have survived without issuing a token:
   $$f_{\text{age}} = 1 + 0.25 \times \frac{\min(\text{age\_days},\ 1460)}{1460} \quad (\text{up to } +25\% \text{ at } 4 \text{ years})$$
5. **Chain Breadth Factor $f_{\text{chain}}$**: Scaling factor rewarding broad cross-chain deployment:
   $$f_{\text{chain}} = 1 + 0.05 \times \min(\text{len}(\text{chains}) - 1,\ 6) \quad (\text{up to } +30\% \text{ at } 7+ \text{ chains})$$
6. **Implied Valuation**:
   $$\text{implied} = \max\left(1,\ \text{round}\left(B \times f_{\text{mom}} \times f_{\text{age}} \times f_{\text{chain}}\right)\right)$$

Rows are strictly sorted by implied value descending, with deterministic tie-breaking on TVL descending and slug ascending.

---

## Concrete Farm Playbooks

Every ranked row includes a concrete, 5-step tactical operational plan instantiated from the protocol's verified attributes:
- **Category Playbooks**: Dedicated playbooks for Dexs, Lending, Liquid Staking, Bridge, Yield, RWA, CEX, Risk Curators, Onchain Capital Allocator, Basis Trading, and a resilient fallback.
- **Capital Tiering**: Farm positions scaled dynamically by protocol TVL ($1k, $10k, or $100k farm portfolio allocations).
- **Network Fees**: Chain-aware gas estimates (Ethereum mainnet, Solana micro-fees, L2 rollups).
- **Time Horizons**: Clear setup times, weekly cadence commitments, and minimum holding durations ($30\text{--}60$ days).
- **Language Discipline**: Protocols are strictly described as *recording no token*.

---

## Standalone Zero-Network Dashboard

The dashboard (`dashboard/`) operates completely self-contained with no external font or script requests:
- **Board View**: Sortable by every numeric column (Rank, Name, TVL, 7d Change, Multiple, Implied Value, Age) with text search, category dropdown, chain selector, TVL floor filter, and watchlist-only toggle.
- **Detail Modal**: Full model decomposition showing base value, peer multiple shrinkage, momentum, seasoning, and breadth alongside the 5-step farm playbook.
- **Model Explainer**: Live category median cards and transparent formula explanation.
- **URL Hash Routing**: Deterministic navigation via `#detail=<slug>` and `#filter=<category>`.
- **Dossier Compliance**: Source files total under 58 KB, fitting untruncated into make.fun's 65,536-byte dossier limit.

---

## How to Run & Validate

### 1. Execute the Radar
Run `main.ts` with Node 22+ using standard library only:
```bash
node main.ts --input /path/to/snapshot.json --output /output
```

Or set the environment variable:
```bash
MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

### 2. Verify Output Artifacts
`main.ts` generates:
- `/output/board.json`: 342 pre-token protocol rows meeting every gate constraint.
- `/output/data.js`: Dashboard dataset containing the complete board, model parameters, and live peer benchmarks.
- `/output/dashboard/`: Static dashboard interface (`index.html`, `app.css`, `app.js`).
- `/output/screenshots/`: Visual verification screenshots (board, detail, filtered).
- `/output/dossier.json`: Sealed dossier summary built with `vendor/makefun-board.ts`.

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
