# Token Radar (`token-radar-01`)

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/thegoodsxx/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/thegoodsxx/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token opportunity radar and dynamic valuation engine built for the make.fun flagship bounty [`token-radar-01`](https://make.fun/bounty/token-radar-01).

**Round 4 (HYBRID)** combines **Round 2's proven valuation model** (category-median peer multiples with Bayesian shrinkage and 3.0x cap, achieving the competition-best dev grade of 0.647) with **Round 3's rich presentation and deep farm playbooks** (4–7 steps per protocol anchored to snapshot facts, why-now lines, and zero external dependencies). All gate validation rules pass strictly.

Token Radar scans the frozen DefiLlama protocol universe, isolates all **342 protocols that record no token**, derives an implied market valuation for each from empirical peer metrics, and provides concrete, costed, and timed farm plans.

---

## Intellectual Core: The Implied-Value Model v2

Token Radar derives protocol valuations dynamically at runtime from DefiLlama snapshot metrics using category-median peer multiples with Bayesian shrinkage and disciplined factor adjustments:

1. **Category-Median Peer Multiples $M(P)$**:
   Peer multiples derive from the median market cap to TVL ratio of tokenized protocols in each DefiLlama category. Thin cohorts are shrunk toward the global tokenized median ($M_{\text{global}} \approx 0.214\text{x}$) via Empirical Bayes weighting (prior weight 6):
   $$M(P) = \min\left(3.0,\ \frac{n \cdot M_{\text{cat}} + 6 \cdot M_{\text{global}}}{n + 6}\right)$$
   A hard cap of **3.0x** is enforced to avoid thin-cohort over-crediting.
2. **Base Valuation $B$**:
   Grounded in verifiable protocol locked capital scaled by empirical peer multiples:
   $$B = \text{tvl\_usd} \times M(P)$$
3. **Momentum Factor $f_{\text{mom}}$**:
   Derived from 7-day TVL percentage change, bounded between 0.5x and 2.0x to avoid wild short-term swings:
   $$f_{\text{mom}} = \text{clamp}\left(1 + \frac{\text{change\_7d}}{100},\ 0.5,\ 2.0\right)$$
4. **Seasoning Factor $f_{\text{age}}$**:
   Longevity premium rewarding protocols sustaining liquidity without issuing a token:
   $$f_{\text{age}} = 1 + 0.25 \times \frac{\min(\text{age\_days},\ 1460)}{1460} \quad (\text{up to } +25\% \text{ at } 4 \text{ years})$$
5. **Chain Breadth Factor $f_{\text{chain}}$**:
   Scaling factor rewarding multi-chain liquidity infrastructure:
   $$f_{\text{chain}} = 1 + 0.05 \times \min(\text{len}(\text{chains}) - 1,\ 6) \quad (\text{up to } +30\% \text{ at } 7+ \text{ chains})$$
6. **Launch Plausibility Factor $f_{\text{plaus}}$ & Reasoned Long Shots**:
   Structural factor mirroring house watchlist logic ($0.10\text{x}$ discount for wrapped, bridged, liquid restaking, or exchange-affiliated products with existing token lineage; $1.00\text{x}$ for primary pre-token protocol primitives). Long shots carry explicit stated reasons.
7. **Implied Valuation**:
   $$\text{implied} = \max\left(1,\ \text{round}\left(B \times f_{\text{mom}} \times f_{\text{age}} \times f_{\text{chain}} \times f_{\text{plaus}}\right)\right)$$

Rows are strictly sorted by implied value descending, with deterministic tie-breaking on TVL descending and slug ascending.

---

## Ranking Highlights & Watchlist Coverage

### Top 5 Overall Pre-Token Protocols
1. **Steakhouse Financial** (`steakhouse-financial`) — Implied **$2,327,797,636** ($2.75B TVL, Risk Curators peer multiple 0.61x, 11 chains).
2. **Sentora Curator** (`sentora-curator`) — Implied **$2,112,065,889** ($2.76B TVL, Risk Curators peer multiple 0.61x, 4 chains).
3. **Gauntlet** (`gauntlet`) — Implied **$1,440,409,106** ($1.58B TVL, Risk Curators peer multiple 0.61x, 9 chains).
4. **Polymarket International** (`polymarket-international`) — Implied **$1,187,737,150** ($320M TVL, Prediction Market capped peer multiple 3.00x).
5. **Coinbase Bridge** (`coinbase-bridge`) — Implied **$349,587,288** ($7.23B TVL, Bridge peer multiple 0.39x, 0.10x plausibility long shot).

### Watchlist Coverage (100% — All 40 Included)
All **40 of 40** watchlist protocols are fully represented and scored on the board:
- **Top 10 Watchlist**: Steakhouse Financial (#1), Gauntlet (#3), Veda (#6, $338M implied), Nonce Capital (#7, $298M implied), USDD (#10, $248M implied), RockawayX (#11, $234M implied), Hyperithm (#14, $183M implied), K3 Capital (#15, $164M implied), Upshift (#19, $129M implied), and Hive Protocol (#20, $127M implied).
- **Universe Summary**: 758 snapshot protocols $\to$ 30 live-token peers providing runtime category medians $\to$ 342 pre-token protocols ranked $\to$ 40/40 watchlist covered.

---

## Concrete Farm Playbooks v3 (Anchored & Differentiated)

Every ranked row includes a concrete tactical playbook (varying between 4 and 7 steps across 45 distinct step sequence shapes, with 0 duplicate shapes within any category):
- **Protocol Fact Anchoring**: Every step is grounded in verifiable snapshot metrics: exact TVL, capital tier, primary and secondary deployment chains, 7-day momentum, and protocol seasoning.
- **Why-Now Lines**: Contextual rationale explaining why capital should be deployed into the protocol at this exact snapshot juncture.
- **Cost & Time Estimates**: Every operational step details realistic network fees (Ethereum mainnet gas vs L2 gas vs alt-L1 fees) and recurring weekly time allocations.
- **Language Discipline**: Protocols are strictly described as *recording no token*.

---

## Standalone Zero-Network Dashboard

The dashboard (`dashboard/`) operates completely self-contained with zero external requests:
- **Board View**: Sortable by Rank, Protocol, TVL, 7d Change, Multiple M(P), vs Cat Peers (premium/discount), and Implied Value. Includes text search, category dropdown, chain selector, TVL floor filter, and watchlist-only toggle.
- **Relative Peer Signals**: Displays effective peer multiple alongside category median reference tags (`cat 0.34x`) and peer relative discount/premium badges (`+15% prem`, `-22% disc`, `par`).
- **Detail Modal**: Features comprehensive factor breakdown bars (Peer Multiple vs 3.0x cap, Momentum, Seasoning, Chain Breadth, Launch Plausibility), structured breakdown figures, and fact-anchored farm playbooks.
- **Reasoned Long Shot Chips**: High-contrast chips and modal callouts explicitly detailing the structural discount reason.
- **Collapsible Methodology & Validation Panel**: Dedicated panel detailing Model v2 specifications, Empirical Bayes shrinkage, plausibility rules, and model limits.
- **Top 7d Movers Strip**: Live market pulse banner highlighting top gainers among the top 50 ranked protocols.
- **Live Category-Median Table**: Interactive benchmark table listing every category, peer counts ($n$), empirical category medians, and effective multiples.
- **Deterministic URL Hash Routing**: Fully navigable via `#board`, `#detail=<slug>`, and `#filter=<category>`.
- **Strict Size Compliance**: All dashboard source files stay strictly under the 65,536-byte limit.

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
- `/output/screenshots/`: Visual verification screenshots (`1-board.png`, `2-detail.png`, `3-filtered.png`).
- `/output/dossier.json`: Sealed dossier summary built with `vendor/makefun-board.ts`.

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
