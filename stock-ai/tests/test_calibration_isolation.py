"""Regression coverage for fitting probability calibration on independent dates."""
import hashlib
import json
import os
import sys
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
import pandas as pd
from src import calibrate


def valid_metadata():
    return {
        'train_start': calibrate.config.TRAIN_START,
        'train_end': calibrate.config.TRAIN_END,
        'val_start': calibrate.config.TUNING_START,
        'val_end': calibrate.config.TUNING_END,
        'features': ['metric'],
    }


class CalibrationIsolationTests(unittest.TestCase):
    def test_report_identity_changes_when_calibration_or_execution_changes(self):
        from scripts import revalidate_model
        provenance = {
            'model_sha256': 'model', 'dataset_sha256': 'data',
            'calibrator_sha256': 'calibrator', 'simulator_sha256': 'simulator',
            'configuration_sha256': 'config', 'target_version': '2.0',
            'imputation_sha256': 'training medians',
        }
        original = revalidate_model.evaluation_identity(provenance)
        for field in ('calibrator_sha256', 'simulator_sha256', 'imputation_sha256'):
            with self.subTest(field=field):
                updated = {**provenance, field: 'changed'}
                self.assertNotEqual(original, revalidate_model.evaluation_identity(updated))

    def test_accepts_separate_training_tuning_and_calibration(self):
        contract = calibrate.validate_calibration_contract(valid_metadata())
        self.assertEqual(contract['calibration_window']['start'], calibrate.config.CALIBRATION_START)
        self.assertLess(contract['tuning_window']['end'], contract['calibration_window']['start'])

    def test_rejects_training_or_tuning_overlap_including_equal_boundary(self):
        for field in ('train_end', 'val_end'):
            for value in (calibrate.config.CALIBRATION_START, calibrate.config.CALIBRATION_END):
                with self.subTest(field=field, value=value):
                    metadata = {**valid_metadata(), field: value}
                    with self.assertRaisesRegex(ValueError, 'overlaps'):
                        calibrate.validate_calibration_contract(metadata)

    def test_rejects_legacy_candidate_and_unknown_dates(self):
        cases = [
            {**valid_metadata(), 'train_end': '2024-06-30', 'val_end': '2025-06-30'},
            {key: value for key, value in valid_metadata().items() if key != 'train_end'},
            {**valid_metadata(), 'train_end': 'not-a-date'},
            {**valid_metadata(), 'val_start': None},
            {**valid_metadata(), 'train_start': '2024-01-01'},
        ]
        for metadata in cases:
            with self.subTest(metadata=metadata):
                with self.assertRaises(ValueError):
                    calibrate.validate_calibration_contract(metadata)

    def test_rejects_overlapping_or_reversed_config_windows(self):
        cases = [
            {'CALIBRATION_START': calibrate.config.TUNING_END},
            {'CALIBRATION_END': '2024-12-31'},
            {'UNTOUCHED_TEST_START': calibrate.config.CALIBRATION_END},
            {'UNTOUCHED_TEST_END': '2025-01-01'},
        ]
        for changes in cases:
            with self.subTest(changes=changes), patch.multiple(calibrate.config, **changes):
                with self.assertRaises(ValueError):
                    calibrate.validate_calibration_contract(valid_metadata())

    def test_overlap_aborts_before_loading_or_replacing_artifacts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            metadata_path = root / 'model_metadata.json'
            metadata_path.write_text(json.dumps({**valid_metadata(), 'val_end': '2025-06-30'}))
            artifact = root / 'calibrated.pkl'
            artifact.write_bytes(b'existing calibrator')
            with patch.multiple(calibrate.config, METADATA_FILE=metadata_path, CALIBRATED_MODEL_FILE=artifact), \
                 patch.object(calibrate.joblib, 'load') as load_model, \
                 patch.object(calibrate.joblib, 'dump') as save_model, \
                 patch.object(calibrate.dataset, 'load_combined_dataset') as load_data:
                with self.assertRaisesRegex(ValueError, 'overlaps'):
                    calibrate.run_calibration()
                load_model.assert_not_called()
                load_data.assert_not_called()
                save_model.assert_not_called()
            self.assertEqual(artifact.read_bytes(), b'existing calibrator')

    def test_fits_only_calibration_rows_and_records_window_and_model_hash(self):
        def frame(start, value):
            return pd.DataFrame({
                'Date': pd.bdate_range(start, periods=60),
                'metric': [value] * 60,
                'target': [0, 1] * 30,
            })
        partitions = (frame('2023-01-01', 10), frame('2024-01-01', 20),
                      frame('2025-01-01', 30), frame('2025-07-01', 40))
        base_model = Mock()
        base_model.predict_proba.side_effect = lambda matrix: np.column_stack([
            1 - np.linspace(.1, .9, len(matrix)), np.linspace(.1, .9, len(matrix))
        ])
        with tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
            root = Path(temporary)
            metadata_path = root / 'model_metadata.json'
            metadata_path.write_text(json.dumps(valid_metadata()))
            model_path = root / 'base.pkl'
            model_path.write_bytes(b'known base model')
            stack.enter_context(patch.multiple(calibrate.config,
                METADATA_FILE=metadata_path, MODEL_FILE=model_path,
                CALIBRATED_MODEL_FILE=root / 'calibrated.pkl', MODELS_DIR=root, OUTPUTS_DIR=root))
            stack.enter_context(patch.object(calibrate.joblib, 'load', return_value=base_model))
            stack.enter_context(patch.object(calibrate.dataset, 'load_combined_dataset', return_value=pd.DataFrame()))
            stack.enter_context(patch.object(calibrate.dataset, 'get_four_period_splits', return_value=partitions))
            stack.enter_context(patch.object(calibrate, '_plot_calibration_comparison'))
            fit = stack.enter_context(patch.object(calibrate, 'fit_explicit_calibrator', wraps=calibrate.fit_explicit_calibrator))
            _, report = calibrate.run_calibration(method='sigmoid')
            fitted_features = fit.call_args.args[1]
            self.assertEqual(len(fitted_features), 60)
            self.assertTrue((fitted_features['metric'] == 30).all())
            provenance = report['calibration_provenance']
            self.assertEqual(provenance['calibration_samples_used_for_fitting'], 60)
            self.assertEqual(provenance['calibration_window']['start'], '2025-01-01')
            self.assertEqual(provenance['base_model_sha256'], hashlib.sha256(b'known base model').hexdigest())
            self.assertTrue((root / 'calibrated.pkl').exists())

    def test_candidate_resume_rejects_legacy_dates_before_artifact_mutation(self):
        from scripts import revalidate_model
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            metadata_path = root / 'model_metadata.json'
            original = json.dumps({**valid_metadata(), 'train_end': '2024-06-30',
                                   'val_end': '2025-06-30',
                                   'target_version': calibrate.config.TARGET_VERSION})
            metadata_path.write_text(original)
            model_path = root / 'base.pkl'
            model_path.write_bytes(b'legacy model')
            with patch.dict(os.environ, {'AXION_MODEL_RUN_DIR': str(root)}), \
                 patch.object(sys, 'argv', ['revalidate_model.py', '--resume', '--skip-latest-scan']), \
                 patch.multiple(calibrate.config, METADATA_FILE=metadata_path, MODEL_FILE=model_path), \
                 patch.object(calibrate.dataset, 'load_combined_dataset') as load_data:
                with self.assertRaisesRegex(ValueError, 'overlaps'):
                    revalidate_model.main()
                load_data.assert_not_called()
            self.assertEqual(metadata_path.read_text(), original)
            self.assertEqual(model_path.read_bytes(), b'legacy model')


if __name__ == '__main__':
    unittest.main()
