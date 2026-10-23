---
title: Axion Stock AI
emoji: 📈
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
---

# Indian NSE Stock Market AI/ML Prediction & Backtesting System

A research-grade, leak-free machine learning and backtesting pipeline for Indian National Stock Exchange (NSE) equities. The system predicts whether a stock will touch at least **+2%** from today's closing price during the next trading day (`next_day_high >= today_close * 1.02`), strictly utilizing information available after market close on Date $T$.

---

## Prediction validity and refresh

The prediction API checks the artifact checksum, row dates, prices, probabilities,
and duplicate tickers. It refuses input candles older than four calendar days,
future candles, and today's daily candle before the 15:30 IST market close.
This conservative cutoff allows normal weekends; a longer closure can require a
refresh. File verification establishes integrity, not predictive accuracy.

Refresh the latest market data and regenerate the research snapshot on Windows:

```powershell
$env:AXION_CLEAN_FEATURES = '1'
& stock-ai/venv/Scripts/python.exe stock-ai/src/daily_scan.py --universe nifty500 --refresh-data --fast
```

The scanner preserves existing outputs when there are no valid results and writes
new prediction checksums and input dates to provenance after a successful scan.
It preserves the original equal-vote behavior for saved ensembles without weights.

Forward observations must be recorded before the intended session's 09:15 IST
open, with an input cutoff no later than the recording time. Reconciliation stores
the observed daily OHLC and provider. Reports exclude late predictions and legacy
outcomes without price-source evidence, preserving the old ledger for inspection.
Fresh predictions remain research candidates until independently evaluated.

## Table of Contents

1. [Project Overview](#project-overview)
2. [Key Design Principles & Anti-Leakage Controls](#key-design-principles--anti-leakage-controls)
3. [Project Directory Structure](#project-directory-structure)
4. [Installation & Setup](#installation--setup)
5. [End-to-End Pipeline Execution](#end-to-end-pipeline-execution)
   - [Step 3: Historical Data Collection](#step-3-historical-data-collection)
   - [Step 4 & 5: Feature Engineering & Dataset Assembly](#step-4--5-feature-engineering--dataset-assembly)
   - [Step 6 & 7: Model Training & Imbalance Handling](#step-6--7-model-training--imbalance-handling)
   - [Step 8: Model Evaluation & Calibration](#step-8-model-evaluation--calibration)
   - [Step 9: Walk-Forward Backtesting](#step-9-walk-forward-backtesting)
   - [Step 10: Daily Prediction Scanner](#step-10-daily-prediction-scanner)
6. [Evaluation & Backtest Results Summary](#evaluation--backtest-results-summary)
7. [Important Limitations & Risk Warning](#important-limitations--risk-warning)
8. [Probability Calibration & Real-World Interpretation](#probability-calibration--real-world-interpretation)

---

## Project Overview

The objective of this research system is to answer the core quantitative question:
> **"Based only on information available after today's market close, what is the probability that a stock will touch at least +2% from today's close during tomorrow's trading session?"**

### What It Is
- A systematic research and backtesting framework using LightGBM gradient-boosted decision trees.
- A multi-stock learner trained across a liquid 50-stock NSE large-cap universe.
- An expanding walk-forward simulator evaluating out-of-sample trading performance with realistic entry timing, stop losses, profit targets, slippage, and transaction costs.

### What It Is NOT
- It is **not** an automated "get-rich-quick" black box.
- It does **not** guarantee profitable live execution.
- It does **not** use tomorrow's open/high/low/close or any future look-ahead data during feature generation.

---

## Key Design Principles & Anti-Leakage Controls

1. **Zero Look-Ahead Bias**:
   - Every feature computed for Date $T$ utilizes only slices up to Date $T$ (`.iloc[:T+1]`).
   - `next_day_high` is computed solely for ground truth evaluation (`target = 1 if High_{T+1} >= Close_T * 1.02 else 0`).
   - `next_day_high` and all $T+1$ prices are **strictly excluded** from model features.
   - The final completed trading day has an unknown target set to `np.nan` (never treated as a false negative).
2. **Chronological Train/Validation/Test Splits**:
   - Standard random `train_test_split` destroys temporal structure and causes cross-asset market leakage.
   - We enforce strict chronological boundaries:
     - **Training Split**: 2018-03-15 to 2023-12-29 (71,490 samples)
     - **Validation Split**: 2024-01-01 to 2025-06-30 (18,450 samples)
     - **Out-of-Sample Test Split**: 2025-07-01 to 2026-09-02 (14,749 samples)
3. **Walk-Forward Validation**:
   - Evaluates the strategy over 22 expanding out-of-sample quarters with model retraining, ensuring robustness against market regime shifts.
4. **Conservative Ambiguous Intraday Resolution**:
   - When both the +2% target and -1% stop loss fall within the same daily candle, the system conservatively assumes the **stop loss was hit first**.

---

## Project Directory Structure

```
stock-ai/
├── data/
│   ├── raw/                 # 50 liquid stock OHLCV CSVs (e.g. RELIANCE_NS.csv)
│   ├── processed/           # combined_dataset.parquet (104,739 rows, 64 features)
│   └── market/              # Benchmarks: ^NSEI, ^INDIAVIX, ^NSEBANK, ^CNXIT, ^CNXAUTO
├── models/
│   ├── lightgbm_stock_model.pkl   # Serialized LightGBM model
│   ├── model_metadata.json        # Training metadata, features, date spans, metrics
│   └── feature_importance.csv     # Feature ranking by information gain
├── outputs/
│   ├── evaluation_report.json     # Test split performance metrics
│   ├── threshold_sweep.csv        # Precision/recall at 0.50-0.80 thresholds
│   ├── calibration_curve.png      # Probability calibration curve
│   ├── walk_forward_predictions.parquet # 67,249 out-of-sample walk-forward predictions
│   ├── backtest_summary.json      # Simulation A & B metrics
│   ├── backtest_trades.csv        # Simulated trade log
│   ├── backtest_equity_curve.png  # Cumulative net equity curve and drawdown
│   └── latest_predictions.csv     # Daily scanner candidate rankings
├── src/
│   ├── __init__.py
│   ├── download_data.py     # Step 3: Resilient NSE data fetcher with caching
│   ├── features.py          # Step 4: Technical & market-relative feature engineering
│   ├── dataset.py           # Step 5 & 6: Multi-stock dataset assembler & splitter
│   ├── train.py             # Step 7: LightGBM training with imbalance handling
│   ├── evaluate.py          # Step 8: Multi-metric evaluation & calibration analysis
│   ├── backtest.py          # Step 9: Walk-forward engine & Simulations A/B
│   └── predict.py           # Step 10: Daily scanner ranking latest stocks
├── scripts/
│   └── audit_leakage.py     # Automated look-ahead bias and integrity audit
├── config.py                # Centralized project configuration
├── requirements.txt         # Core dependencies
└── README.md                # Project documentation
```

---

## Installation & Setup

### 1. Prerequisites
- Python 3.10 to 3.14 on Windows, Linux, or macOS.
- Virtual environment recommended.

### 2. Activate Virtual Environment & Install Dependencies
```powershell
# Windows PowerShell
.\venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

---

## End-to-End Pipeline Execution

### Step 3: Historical Data Collection
Downloads ~50 liquid NSE stocks and benchmarks (`NIFTY 50`, `India VIX`, `Nifty Bank`, `Nifty IT`, `Nifty Auto`) from 2018 to the present day:
```powershell
python src/download_data.py
```
*Note: Existing downloads are automatically cached to avoid redundant network requests.*

### Step 4 & 5: Feature Engineering & Dataset Assembly
Builds 64 technical, momentum, candlestick, volatility, and market-relative features:
```powershell
python src/dataset.py
```
*Outputs: `data/processed/combined_dataset.parquet` (104,739 rows).*

### Step 6 & 7: Model Training
Fits the LightGBM classifier with early stopping and class-weight balancing:
```powershell
python src/train.py
```
*Outputs: `models/lightgbm_stock_model.pkl` and `models/model_metadata.json`.*

### Step 8: Model Evaluation & Calibration
Evaluates test metrics across probability thresholds (0.50 to 0.80) and checks calibration:
```powershell
python src/evaluate.py
```
*Outputs: `outputs/threshold_sweep.csv` and `outputs/calibration_curve.png`.*

### Step 9: Walk-Forward Backtesting
Runs expanding-window retraining (22 rolling steps) and executes Simulation A & B:
```powershell
python src/backtest.py
```
*Outputs: `outputs/backtest_trades.csv` and `outputs/backtest_equity_curve.png`.*

### Step 10: Daily Prediction Scanner
Scans today's closing data across the universe and ranks candidates for tomorrow:
```powershell
python src/predict.py
```
*Outputs: `outputs/latest_predictions.csv` and formatted console ranking.*

### Automated Look-Ahead Bias Audit
Runs 5 automated checks verifying absence of future tokens, chronological separation, and target consistency:
```powershell
python scripts/audit_leakage.py
```

---

## Evaluation & Backtest Results Summary

> **Portfolio-return caution:** The historical results below are research outputs, not an investor return forecast. The current capital-limited simulator starts with ₹100,000, allows up to 10 equal slots (about ₹10,000 each initially), selects the highest-probability eligible signal per session, holds at most one position per ticker, and leaves unused capital in cash. The +2% target applies to each position: a fully deployed ₹10,000 slot earns about ₹200 gross when its target fills, before fees and slippage. It does not mean 2% account growth each day, and a target touch is not a guaranteed fill.

The saved legacy `backtest_summary.json` baseline at threshold 0.60 reports 4,567 candidate trades, 29.0% wins, -0.348% mean net return per trade, and 0.55 profit factor. Its near-total cumulative loss comes from repeated full-account per-signal compounding and must not be read as a portfolio result. A breakout/ATR variant in that artifact reports +0.241% average net return per trade but a 74.4% reported max drawdown under the same legacy sequence method; that result is not evidence of a viable strategy either.

The preferred served artifact (`stock-ai/outputs/backtest_summary.json`, generated 2026-09-12) is a different clean-model evaluation: 230 candidate trades, 64% win rate, +0.387% mean net return per trade, and 1.50 profit factor. Its trade log contains only three signal dates (2026-01-20, 2026-03-13, and 2026-03-30), while its per-trade compounded curve reports a 37.0% drawdown. Applying the 10-slot selection rule to those logged trades selects 21 positions and changes ₹100,000 to about ₹99,085 across the three active sessions (-0.9%). That log-only estimate is superseded by the full-calendar isolated rerun below; both samples are too sparse to support a dependable annual estimate.

An isolated capital-limited rerun of the clean candidate used the full test prediction calendar (2025-07-01 to 2026-09-10: 301 sessions). At the configured 0.60 score threshold, it produced 1,396 candidate signals on only **6 active sessions**; the 10-slot, whole-share portfolio selected **44 positions**, of which **14 reached the +2% target** (31.8%). The simulated account ended at **₹96,782** (-3.22% cumulative; -2.70% annualized) with -3.53% maximum drawdown. Doubling modeled fees and slippage changed the result to -3.87% with -4.03% drawdown. This previously inspected test period is not a fresh blind holdout, and the promotion gate correctly remains `OBSERVATION_ONLY` (too few active sessions and positions, negative base and stressed returns, and no blind holdout). Six active days across a 301-session calendar are far too sparse for a reliable yearly return estimate. The run is isolated under `scratch/clean-candidate-capital-limited`; it does not replace the served model or its artifacts.

The cutoff diagnostic confirms that **all 301 dates have scored stock rows**, so missing sessions are not caused by absent model output in this dataset. Scores are below 0.50 on most dates. Lowering the cutoff from 0.60 to 0.50 expands activity from 6 to **18 sessions** and selected positions from 44 to **150**, but the portfolio result worsens from -3.22% to **-7.16%** (-9.75% at doubled costs; -7.52% maximum drawdown). At 0.55, the signal count and return are nearly unchanged from 0.60. This is an exploratory comparison on an already inspected holdout; it does not justify adopting 0.50 or another threshold. The dashboard's cutoff table is diagnostic, not a recommendation.

**Calibration correction (6 October 2026):** The legacy candidate records training through June 2024 and tuning through June 2025. A later recalibration using the current 2024 validation window overlapped its recorded training window. The numbers above reproduce historical diagnostics; their calibration isolation is unverified. The corrected runner uses training through 2023, tuning in 2024, and a separate January–June 2025 calibration partition. It rejects incompatible legacy models before loading data or replacing artifacts, so this older candidate requires retraining before a corrected full evaluation. New reports record the actual calibration dates and model hash, and their evaluation identity also includes the calibrator, saved preprocessing, execution code, and configuration. The previously inspected evaluation period remains research data even after this repair.

The numbers in the tables below are retained as historical model evaluation outputs. Some are from earlier report generations and can differ from the saved JSON artifacts; provenance and generation dates should be checked before using them.

### 1. Out-of-Sample Test Set (2025-07-01 to 2026-09-02, 14,749 rows)
- **Baseline Positive Rate (Chance Level)**: **15.39%**
- **ROC-AUC**: **0.6636**
- **PR-AUC (Average Precision)**: **0.2837** (84% lift over baseline)

#### Precision by Threshold:
| Threshold | Signals | Win Rate (+2% Touch) | Lift vs Baseline |
|:---:|:---:|:---:|:---:|
| **0.50** | 1,570 | 34.27% | 2.23x |
| **0.55** | 1,006 | 37.38% | 2.43x |
| **0.60** | 633 | 41.55% | 2.70x |
| **0.65** | 409 | 45.23% | 2.94x |
| **0.70** | 242 | 50.00% | 3.25x |
| **0.75** | 122 | 54.92% | 3.57x |
| **0.80** | 58 | **63.79%** | **4.14x** |

### 2. Walk-Forward Backtest (67,249 out-of-sample predictions across 22 quarters)
- **Simulation A (Signal Quality — Reference: Today's Close)**:
  - At Threshold 0.60: **43.88%** win rate (vs 20% random baseline).
  - At Threshold 0.70: **52.5%** win rate.
  - At Threshold 0.80: **64.2%** win rate.
  - These signal-hit rates measure target touches, not returns available from an executable portfolio.

- **Simulation B (Realistic Trade Execution — Entry at Next Day Open, Target +2%, Stop -1%)**:
  - Win Rate: **29.01%**
  - Average Net Return per Trade: **-0.35%** (after 0.10% costs and 0.05% slippage)
  - *Key Takeaway: Entering blindly at Next Open with an asymmetric 2:1 profit/stop ratio (-1% stop vs +2% target) in volatile equities triggers the tight stop loss first in ~70% of random intraday fluctuations.*

### 3. Top Most Influential Features
1. `atr_pct` (Average True Range as % of Close): Highest information gain; volatility level dominates next-day upside amplitude.
2. `india_vix_level`: Overall market volatility index.
3. `daily_hl_pct`: Intraday high-low range.
4. `nifty_ret_1d` & `nifty_ret_5d`: Benchmark index momentum.
5. `india_vix_change_1d`: Daily expansion/contraction in fear index.
6. `vol_20d` & `vol_to_sma20`: Realized volatility and volume surges.

---

## Important Limitations & Risk Warning

> [!WARNING]
> **Financial & Execution Risks:**
> 1. **Overnight Gap Risk**: A stock may gap down at market open due to overnight corporate news, global markets, or geopolitical developments.
> 2. **Intraday Sequence Uncertainty**: Daily OHLC data does not disclose tick-level timing. If a candle's Low is -1.5% and High is +2.5%, it is impossible to know with daily data whether the high or low was reached first. The system assumes the conservative stop-loss-first outcome.
> 3. **Non-Stationarity**: Market regimes evolve. Bull markets exhibit higher baseline +2% positive rates than sideways or bear markets.

---

## Probability Calibration & Real-World Interpretation

- Because the model is trained with class-weight balancing to counteract the ~4:1 negative-to-positive class imbalance, raw probability estimates represent **relative rankings**, not absolute probabilities.
- A score of `0.75` should **never** be cited as a literal "75% guaranteed win chance".
- As empirically verified in the calibration curve, a model score of ~0.75 translates to an empirical win rate of approximately **45% to 55%** in out-of-sample trading.
- Always use the threshold sweep table and probability calibration chart (`outputs/calibration_curve.png`) to set strategy cutoffs.
