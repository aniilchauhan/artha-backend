import sys
import unittest
import json
import tempfile
import hashlib
from datetime import datetime, timezone, timedelta
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
import pandas as pd
from src.predict import prepare_inference_features
from src import daily_scan

class InferenceParity(unittest.TestCase):
    def test_training_medians_and_feature_order(self):
        result = prepare_inference_features(pd.DataFrame({"b": [2.0], "a": [np.nan]}), ["a", "b"], {"a": 7.0, "b": 9.0})
        self.assertEqual(list(result.columns), ["a", "b"])
        self.assertEqual(result.iloc[0].tolist(), [7.0, 2.0])
        self.assertEqual(str(result.dtypes.iloc[0]), "float32")

    def test_invalid_schema_and_artifact_fail_closed(self):
        for frame, medians in [(pd.DataFrame({"b": [2]}), {"a": 7}), (pd.DataFrame({"a": [np.nan]}), {}), (pd.DataFrame({"a": [np.inf]}), {"a": 7})]:
            with self.assertRaises(ValueError):
                prepare_inference_features(frame, ["a"], medians)


class DailyScannerParity(unittest.TestCase):
    def setUp(self):
        self.context = ExitStack()
        self.addCleanup(self.context.close)
        self.root = Path(self.context.enter_context(tempfile.TemporaryDirectory()))
        (self.root / "TEST_NS.csv").write_text("Close\n" + "100\n" * 60)
        self.columns = ["ret_1d", "ret_5d", "ret_20d", "rsi_14"]
        (self.root / "imputation_values.json").write_text(json.dumps(dict.fromkeys(self.columns, 7.0)))
        self.frame = pd.DataFrame({"Date": [(datetime.now(timezone.utc) - timedelta(days=1)).strftime('%Y-%m-%d')], "Close": [100.0],
                                   "ret_1d": [0.15], "ret_5d": [0.25],
                                   "ret_20d": [0.35], "rsi_14": [np.nan]})
        self.model = Mock()
        self.model.predict_proba.return_value = np.array([[0.6, 0.4]])
        for name in ("RAW_DIR", "MODELS_DIR", "OUTPUTS_DIR"):
            self.context.enter_context(patch.object(daily_scan.config, name, self.root))
        for name in ('MODEL_FILE', 'CALIBRATED_MODEL_FILE'):
            file = self.root / (name + '.pkl')
            file.write_bytes(b'test model')
            self.context.enter_context(patch.object(daily_scan.config, name, file))
        self.metadata = dict(target_version='2.0-executable', preprocessing_version='2.0-temporal-isolated',
                             model_sha256=hashlib.sha256(b'test model').hexdigest())
        self.context.enter_context(patch.object(daily_scan, "get_universe_tickers", return_value=["TEST.NS"]))
        self.context.enter_context(patch.object(daily_scan.features, "load_market_benchmarks", return_value={}))
        self.context.enter_context(patch.object(daily_scan.features, "build_stock_pipeline", side_effect=lambda **kw: self.frame.copy()))
        self.context.enter_context(patch.object(daily_scan.explain, "explain_prediction_row", return_value={
            "positive_drivers": [], "negative_drags": [], "narrative": "Test"}))
        self.sentiment = self.context.enter_context(patch.object(daily_scan.sentiment, "analyze_sentiment", return_value={
            "score": 0.95, "label": "Bullish", "catalyst_headline": "Test news", "catalyst_reason": "Test",
            "source_mode": "test_llm"}))

    def run_scan(self, **kwargs):
        with patch.object(daily_scan, "load_inference_model", return_value=(self.model, self.columns, self.metadata)):
            return daily_scan.run_daily_scan(**kwargs)

    def test_news_and_fast_mode_do_not_replace_trained_features(self):
        enriched = self.run_scan(fast=False)
        fast = self.run_scan(fast=True)
        self.sentiment.assert_called_once_with("TEST.NS")
        self.assertEqual(enriched[0]["Sentiment Engine"], "test_llm")
        self.assertEqual(fast[0]["Sentiment Engine"], "not_requested")
        self.assertEqual(enriched[0]["Model Score"], fast[0]["Model Score"])
        for call in self.model.predict_proba.call_args_list:
            vector = call.args[0]
            self.assertEqual(list(vector.columns), self.columns)
            np.testing.assert_allclose(vector.iloc[0], [0.15, 0.25, 0.35, 7.0])
            self.assertTrue(all(str(dtype) == "float32" for dtype in vector.dtypes))

    def test_missing_calibrator_cannot_fall_back_to_raw_model(self):
        model_path, metadata_path = self.root / "model.pkl", self.root / "metadata.json"
        model_path.touch()
        metadata_path.touch()
        with patch.multiple(daily_scan.config, MODEL_FILE=model_path, METADATA_FILE=metadata_path,
                            USE_CALIBRATED_MODEL=True, CALIBRATED_MODEL_FILE=self.root / "missing.pkl"):
            with self.assertRaisesRegex(FileNotFoundError, "refusing raw probability fallback"):
                daily_scan.load_inference_model()

    def test_invalid_probability_preserves_existing_predictions(self):
        artifact = self.root / "latest_predictions.json"
        artifact.write_text('[{"existing":true}]')
        self.model.predict_proba.return_value = np.array([[0.0, np.nan]])
        with self.assertRaisesRegex(ValueError, "No valid prediction rows"):
            self.run_scan(fast=True)
        self.assertEqual(artifact.read_text(), '[{"existing":true}]')

    def test_stale_candles_preserve_existing_predictions(self):
        artifact = self.root / 'latest_predictions.json'
        artifact.write_text('[{"existing":true}]')
        self.frame['Date'] = '2000-01-01'
        with self.assertRaisesRegex(ValueError, 'No valid prediction rows'):
            self.run_scan(fast=True)
        self.model.predict_proba.assert_not_called()
        self.assertEqual(artifact.read_text(), '[{"existing":true}]')

    def test_missing_feature_is_rejected_instead_of_zero_filled(self):
        self.frame = self.frame.drop(columns=["ret_1d"])
        with self.assertRaisesRegex(ValueError, "No valid prediction rows"):
            self.run_scan(fast=True)
        self.model.predict_proba.assert_not_called()

    def test_missing_training_median_fails_before_inference(self):
        (self.root / "imputation_values.json").write_text('{}')
        with self.assertRaisesRegex(ValueError, "training imputation values"):
            self.run_scan(fast=True)
        self.model.predict_proba.assert_not_called()

if __name__ == "__main__":
    unittest.main()
