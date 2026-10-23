"""
Audits historical event frequency, legacy model outputs, and executable targets.
"""

from pathlib import Path
import json
import pandas as pd
import numpy as np

BASE_DIR = Path(__file__).resolve().parent.parent
PARQUET_FILE = BASE_DIR / "data" / "processed" / "combined_dataset.parquet"
EVAL_FILE = BASE_DIR / "outputs" / "evaluation_report.json"

print("Reading combined_dataset.parquet...")
df = pd.read_parquet(PARQUET_FILE)
print(f"Total rows: {len(df):,}")
print(f"Date range: {df['Date'].min()} to {df['Date'].max()}")

# Date boundaries
train_mask = (df["Date"] >= "2020-11-11") & (df["Date"] <= "2024-06-27")
val_mask = (df["Date"] >= "2024-07-01") & (df["Date"] <= "2025-06-27")
test_mask = (df["Date"] >= "2025-07-01") & (df["Date"] <= "2026-09-04")

splits = [
    ("TRAIN (2020-11 to 2024-06)", df[train_mask]),
    ("VAL (2024-07 to 2025-06)", df[val_mask]),
    ("TEST (2025-07 to 2026-09)", df[test_mask]),
    ("FULL UNIVERSE", df),
]

print("\n" + "=" * 65)
print("HISTORICAL EVENT FREQUENCY AUDIT")
print("=" * 65)

for name, s_df in splits:
    n_rows = len(s_df)
    target_sum = s_df["target"].sum()
    target_rate = s_df["target"].mean()

    # Check executable target if next_open & next_high are present
    if "next_open" in s_df.columns and "next_high" in s_df.columns:
        exec_open_high = (s_df["next_high"] >= s_df["next_open"] * 1.02).astype(float)
        exec_sum = exec_open_high.sum()
        exec_rate = exec_open_high.mean()
        print(
            f"{name:<30} | Rows: {n_rows:>7,} | "
            f"Close->NextHigh: {target_rate * 100:>5.2f}% ({int(target_sum):>6,}) | "
            f"Open->NextHigh: {exec_rate * 100:>5.2f}% ({int(exec_sum):>6,})"
        )
    else:
        print(
            f"{name:<30} | Rows: {n_rows:>7,} | "
            f"Close->NextHigh: {target_rate * 100:>5.2f}% ({int(target_sum):>6,})"
        )

# Check evaluation report
if EVAL_FILE.exists():
    with open(EVAL_FILE, "r") as f:
        eval_data = json.load(f)
    print("\n" + "=" * 65)
    print("SAVED EVALUATION REPORT (TEST SPLIT: 2025-07 to 2026-09)")
    print("=" * 65)
    print(f"ROC-AUC: {eval_data.get('roc_auc', 0):.4f}")
    print(f"PR-AUC:  {eval_data.get('pr_auc', 0):.4f}")
    print("\nTop Threshold Sweeps (Legacy Close->High):")
    for t in eval_data.get("threshold_sweep", [])[:5]:
        print(
            f"  Threshold >= {t['Threshold']:<4} | "
            f"Signals: {t['Signals']:>6,} ({t['Signal Rate (%)']:>5.2f}%) | "
            f"Precision: {t['Precision / Win Rate'] * 100:>5.2f}% | "
            f"Recall: {t['Recall'] * 100:>5.2f}%"
        )
