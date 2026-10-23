"""
Master End-of-Day Pipeline Runner for Indian NSE Stock AI System.
Automates the daily post-market routine (recommended run time: 3:45 PM IST on trading days):
  1. Synchronizes latest market data for universe and benchmarks.
  2. Updates feature matrices.
  3. (Optional) Retrains model if monthly cycle due.
  4. Runs daily prediction scanner with Tree SHAP explainability.
  5. Exports updated predictions to JSON and CSV for the web dashboard.
"""

import sys
import argparse
import datetime
import logging
from pathlib import Path

# Add project root to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config
from src import download_data, features, dataset, train, predict

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


def run_pipeline(force_download: bool = False, retrain_model: bool = False):
    start_time = datetime.datetime.now()
    print("\n" + "=" * 80)
    print("INDIAN NSE STOCK MARKET AI/ML — DAILY AUTOMATED PIPELINE")
    print(f"Timestamp : {start_time.strftime('%Y-%m-%d %H:%M:%S IST')}")
    print("=" * 80)

    # 1. Sync Data
    print("\n[STEP 1/4] Synchronizing Market & Stock Universe Data...")
    provider = download_data.YFinanceDataProvider(max_retries=3, retry_delay=1.0)

    # Download indices & stocks (cached unless force_download=True)
    download_data.download_universe(
        tickers=list(config.MARKET_INDICES.values()),
        output_dir=config.MARKET_DIR,
        provider=provider,
        force=force_download,
    )
    download_data.download_universe(
        tickers=config.STOCK_UNIVERSE,
        output_dir=config.RAW_DIR,
        provider=provider,
        force=force_download,
    )
    print("  [OK] Market data synchronized.")

    # 2. Rebuild Dataset if Retraining
    if retrain_model or not config.COMBINED_DATASET_PARQUET.exists():
        print("\n[STEP 2/4] Updating Combined Multi-Stock Dataset...")
        dataset.build_combined_dataset(save_parquet=True, save_csv=False)
        print("  [OK] Dataset updated.")

        print("\n[STEP 3/4] Retraining LightGBM Classifier...")
        train.train_model(save_artifacts=True)
        print("  [OK] Model retrained and persisted.")
    else:
        print("\n[STEP 2/4] Using active trained model from models/.")
        print(f"  Model file: {config.MODEL_FILE}")

    # 3. Run Inference Scanner with Tree SHAP
    print("\n[STEP 3/4] Running Daily Prediction Scanner & SHAP Explainability...")
    predictions_df = predict.scan_latest_universe()
    print("  [OK] Predictions and SHAP feature drivers computed.")

    # 4. Completion Summary
    elapsed = (datetime.datetime.now() - start_time).total_seconds()
    print("\n" + "=" * 80)
    print("DAILY PIPELINE COMPLETED SUCCESSFULLY!")
    print(f"Execution Time : {elapsed:.1f} seconds")
    print(f"Outputs Saved  : {config.PREDICTIONS_CSV}")
    print(f"JSON Payload   : {config.OUTPUTS_DIR / 'latest_predictions.json'}")
    print("=" * 80)

    return predictions_df


def parse_args():
    parser = argparse.ArgumentParser(description="Master Daily EOD Pipeline for NSE Stock AI")
    parser.add_argument("--force-download", action="store_true", help="Force redownload of all historical stock files")
    parser.add_argument("--retrain", action="store_true", help="Retrain model on latest updated dataset")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run_pipeline(force_download=args.force_download, retrain_model=args.retrain)
