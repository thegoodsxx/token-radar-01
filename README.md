# Token Radar (`token-radar-01`)

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/thegoodsxx/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/thegoodsxx/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token opportunity radar and dynamic valuation engine built for the make.fun flagship bounty [`token-radar-01`](https://make.fun/bounty/token-radar-01).

Token Radar scans the frozen DefiLlama protocol universe, isolates all **342 protocols that record no token**, derives an implied market valuation for each from empirical peer metrics, and provides concrete, costed, and timed farm plans.

---

## Intellectual Core: The Implied-Value Model v3

Unlike static aggregators or raw TVL tables, Token Radar v3 computes valuations dynamically from the snapshot's own figures at runtime with distance-weighted peer multiples, dispersion analysis, explicit conviction scoring, and a sanity layer:

1. **Similarity-Weighted Peer Multiples $M(P)$**: Rather than relying on unweighted category medians, peers in the same category are weighted by log-scale TVL proximity ($w_{\text{tvl}} = 1 / (1 + 0.5 \cdot |\Delta\log_{10}(\text{TVL})|)$) and chain overlap Jaccard similarity ($w_{\text{chain}} = 1 + J$). Individual peer ratios are capped at 3.0x to eliminate distortion from extreme outliers.
2. **Bayesian Shrinkage & Cohort Dispersion (IQR)**: Empirical Bayes shrinkage pulls small category cohorts toward the category median (and global median $M_{\text{global}} \approx 0.214\text{x}$) via prior weighting:
   $$M(P) = \min\left(3.0,\ \frac{w_{\text{peer}} \cdot M_{\text{sim}} + 4 \cdot M_{\text{cat}}}{w_{\text{peer}} + 4}\right)$$
   Cohort dispersion is explicitly measured via Interquartile Range ($\text{IQR} = Q_3 - Q_1$), quantifying valuation agreement among category peers.
3. **Explicit 0–100 Conviction Score**: Synthesizes model upside, peer agreement (inverse dispersion $30 / (1 + \text{IQR})$), 7-day momentum, and protocol seasoning into an objective conviction metric.
4. **Base Valuation $B$**: Grounded in on-chain capital scaled by empirical peer multiples:
   $$B = \text{tvl\_usd} \times M(P)$$
5. **Momentum Factor $f_{\text{mom}}$**: Derived from 7-day TVL percentage change, bounded to prevent single-week volatility distortion:
   $$f_{\text{mom}} = \text{clamp}\left(1 + \frac{\text{change\_7d}}{100},\ 0.5,\ 2.0\right)$$
6. **Seasoning Factor $f_{\text{age}}$**: Longevity premium for established protocols sustaining capital without issuing a token:
   $$f_{\text{age}} = 1 + 0.25 \times \frac{\min(\text{age\_days},\ 1460)}{1460} \quad (\text{up to } +25\% \text{ at } 4 \text{ years})$$
7. **Chain Breadth Factor $f_{\text{chain}}$**: Scaling factor rewarding broad cross-chain deployment:
   $$f_{\text{chain}} = 1 + 0.05 \times \min(\text{len}(\text{chains}) - 1,\ 6) \quad (\text{up to } +30\% \text{ at } 7+ \text{ chains})$$
8. **Launch Plausibility Factor $f_{\text{plaus}}$ & Reasoned Long Shots**: Structural factor mirroring house watchlist logic ($0.10\text{x}$ discount for wrapped, bridged, liquid-staked, or exchange-affiliated products with existing token lineage; $1.00\text{x}$ for primary pre-token protocol primitives). Long shots carry explicit stated reasons (lineage, contraction, or peer valuation gap).
9. **Sanity Layer**: Flags category concentration outliers (>45% share of multi-protocol categories) to protect against valuation distortion.
10. **Implied Valuation**:
    $$\text{implied} = \max\left(1,\ \text{round}\left(B \times f_{\text{mom}} \times f_{\text{age}} \times f_{\text{chain}} \times f_{\text{plaus}}\right)\right)$$

Rows are strictly sorted by implied value descending, with deterministic tie-breaking on TVL descending and slug ascending.

---

## Concrete Farm Playbooks v3 (Anchored & Differentiated)

Every ranked row includes a concrete tactical playbook (varying between 4 and 7 steps, spanning 45 distinct step sequence shapes with 0 duplicate shapes within any category):
- **Intra-Category Differentiation**: Mean intra-category word Jaccard similarity dropped to **0.323**, well below the competition threshold.
- **Protocol Fact Anchoring**: Every step is grounded in verifiable snapshot metrics: exact TVL, capital tier, deployment chain, 7-day momentum, and protocol seasoning.
- **Cost & Time Estimates**: Every operational step details realistic network fees (Ethereum mainnet gas vs L2 gas vs alt-L1 fees) and recurring weekly time allocations.
- **Why-Now Lines**: Contextual rationale explaining why capital should be deployed into the protocol at this exact snapshot juncture.
- **Language Discipline**: Protocols are strictly described as *recording no token*.

---

## Standalone Zero-Network Dashboard v3

The dashboard (`dashboard/`) operates completely self-contained with no external font or script requests:
- **Board View**: Sortable by every column (Rank, Name, TVL, 7d Change, Multiple & IQR, Conviction, Implied Value) with text search, category dropdown, chain selector, TVL floor filter, and watchlist-only toggle.
- **Conviction Column & Badges**: Color-coded conviction scores (high $\ge 70$, moderate 45–69, low $< 45$) providing clear signal prioritization.
- **Peer Dispersion Display**: Live $\text{IQR}$ tags displaying cohort multiple spread for every protocol.
- **Reasoned Long Shot & Outlier Badges**: Prominent badges and modal callouts explaining specific discount and sanity concentration factors.
- **Collapsible Methodology & Validation Panel**: Dedicated panel detailing Model v3 formulas, Empirical Bayes shrinkage, plausibility rules, sanity layer limits, and known snapshot boundaries.
- **Top 7d Movers Strip**: Live market pulse banner highlighting top 5 gainers among the top 50 ranked protocols.
- **Factor Breakdown Bars**: Visual representation of multiple, dispersion agreement, momentum, seasoning, breadth, and plausibility.
- **Live Category-Median Table**: Interactive benchmark table listing every category, peer counts ($n$), empirical category medians, IQR dispersion, and effective multiples.
- **URL Hash Routing**: Deterministic navigation via `#board`, `#detail=<slug>`, and `#filter=<category>`.
- **Strict Dossier Compliance**: Entire dashboard package fits cleanly into make.fun's 65,536-byte dossier limit (63,192 bytes, 2,344 bytes headroom, zero cut marker).

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
