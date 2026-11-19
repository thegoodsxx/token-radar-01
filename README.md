# Token Radar (`token-radar-01`)

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/thegoodsxx/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/thegoodsxx/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token opportunity radar and dynamic valuation engine built for the make.fun flagship bounty [`token-radar-01`](https://make.fun/bounty/token-radar-01).

Token Radar scans the frozen DefiLlama protocol universe, isolates all **342 protocols that record no token**, derives an implied market valuation for each from empirical peer metrics, and provides concrete, costed, and timed farm plans.

---

## Intellectual Core: The Implied-Value Model

Unlike static aggregators or raw TVL tables, Token Radar computes valuations dynamically from the snapshot's own figures at runtime:

1. **Peer Multiple $M(P)$**: The runtime median market-cap to TVL ratio of tokenized peers in the protocol's category. To prevent small samples from distorting valuations, Empirical Bayes shrinkage pulls small category cohorts toward the global peer median ($M_{\text{global}} \approx 0.214\text{x}$):
   $$M(P) = \min\left(3.0,\ \frac{n \cdot M_{\text{cat}} + 6 \cdot M_{\text{global}}}{n + 6}\right)$$
   *(Capped at 3.0x max ceiling to prevent thin peer sets from over-crediting; falls back to $M_{\text{global}}$ when category is null or $n = 0$.)*
2. **Base Valuation $B$**: Grounded in verifiable on-chain capital scaled by peer valuation multiples:
   $$B = \text{tvl\_usd} \times M(P)$$
3. **Momentum Factor $f_{\text{mom}}$**: Derived from 7-day TVL percentage change, bounded so single-week volatility cannot dominate:
   $$f_{\text{mom}} = \text{clamp}\left(1 + \frac{\text{change\_7d}}{100},\ 0.5,\ 2.0\right)$$
4. **Seasoning Factor $f_{\text{age}}$**: Longevity premium for established protocols that have survived without issuing a token:
   $$f_{\text{age}} = 1 + 0.25 \times \frac{\min(\text{age\_days},\ 1460)}{1460} \quad (\text{up to } +25\% \text{ at } 4 \text{ years})$$
5. **Chain Breadth Factor $f_{\text{chain}}$**: Scaling factor rewarding broad cross-chain deployment:
   $$f_{\text{chain}} = 1 + 0.05 \times \min(\text{len}(\text{chains}) - 1,\ 6) \quad (\text{up to } +30\% \text{ at } 7+ \text{ chains})$$
6. **Launch Plausibility Factor $f_{\text{plaus}}$**: Structural factor mirroring house watchlist logic ($0.10\text{x}$ discount for wrapped, bridged, liquid-staked, or exchange-affiliated products with existing token lineage; $1.00\text{x}$ for primary pre-token protocol primitives).
7. **Implied Valuation**:
   $$\text{implied} = \max\left(1,\ \text{round}\left(B \times f_{\text{mom}} \times f_{\text{age}} \times f_{\text{chain}} \times f_{\text{plaus}}\right)\right)$$

Rows are strictly sorted by implied value descending, with deterministic tie-breaking on TVL descending and slug ascending.

---

## Concrete Farm Playbooks (v2 Data-Anchored)

Every ranked row includes a concrete, 6-step tactical operational plan strictly data-anchored to the protocol's own verified metrics:
- **TVL-Tier Position Sizing**: Explicit dollar sizing grounded in protocol liquidity depth:
  * Sub-$50M TVL: $250-$1,000 position size (meaningful entry without adverse market impact).
  * $50M-$500M TVL: $1,000-$5,000 position size (meaningful share of daily flow without disturbing pool equilibrium).
  * Over $500M TVL: $5,000-$25,000 institutional test size (unlocks top-tier reward brackets across deep liquidity).
- **Network Fees by Chain Class**: Gas costs calibrated strictly to the deployment chain named in the step:
  * Ethereum Mainnet: $5-$25 per transaction in ETH gas.
  * L2 Rollups (Base, Arbitrum, Optimism, Ink, Polygon, Blast, etc.): $0.05-$0.50 in native L2 gas.
  * Other L1 Networks: $0.10-$2.00 in native network fees.
- **Cross-Chain Routing vs Single-Chain Depth**:
  * Multi-chain protocols (2+ chains): Explicit cross-chain bridge and rotation step routing 25%-35% capital to secondary network (`chains[1]`).
  * Single-chain protocols: Targeted depth step concentrating liquidity or staking receipt tokens on primary network (`chains[0]`).
- **Weekly Time Budget & Cadence**: Explicit commitment line ("Budget 20 minutes a week...") with recurring cadence actions (collateral monitoring, pool rebalancing, governance voting).
- **Momentum-Aware Directives**:
  * Surge ($\ge +10\%$ 7d change): Tranche entry over 10 days to avoid chasing transient price momentum.
  * Contraction ($\le -10\%$ 7d change): Audit protocol outflows, solvency, and recent security disclosures before committing capital.
- **Honest Long-Shot Tagging**: Plausibility-discounted protocols explicitly detail why they carry long-shot status.
- **Language Discipline**: Protocols are strictly described as *recording no token*.

---

## Standalone Zero-Network Dashboard

The dashboard (`dashboard/`) operates completely self-contained with no external font or script requests:
- **Board View**: Sortable by every column (Rank, Name, TVL, 7d Change, Multiple, Implied Value, Age) with text search, category dropdown, chain selector, TVL floor filter, and watchlist-only toggle.
- **Top 7d Movers Strip**: Live market pulse banner highlighting top 5 gainers among the top 50 ranked protocols.
- **Honesty Labelling**: Plausibility-discounted protocols feature high-contrast `LONG SHOT` badges on the board and in modal headers.
- **Why This Rank Factor Breakdown**: Detail modal showcases dedicated horizontal progress bars for peer multiple (vs 3.0x cap), momentum ($f_{\text{mom}}$), seasoning ($f_{\text{age}}$), chain breadth ($f_{\text{chain}}$), and launch plausibility ($f_{\text{plaus}}$).
- **Live Category-Median Table**: Interactive benchmark table in the model explainer listing every category, live peer counts ($n$), empirical category medians, and effective shrunk multiples.
- **URL Hash Routing**: Deterministic navigation via `#board`, `#detail=<slug>`, and `#filter=<category>`.
- **Dossier Compliance**: Source files total ~62 KB, fitting untruncated into make.fun's 65,536-byte dossier limit.

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
