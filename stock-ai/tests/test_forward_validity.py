import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import ledger
from src.ensemble import EnsembleModel
import numpy as np


class ForwardValidityTests(unittest.TestCase):
    def prediction(self):
        return dict(prediction_id='p1', ticker='TEST.NS', intended_session='2026-10-05',
                    recorded_at='2026-10-05T03:44:00+00:00', input_cutoff='2026-10-01T10:00:00+00:00')

    def test_open_boundary_and_future_input(self):
        p = self.prediction()
        self.assertIsNone(ledger.prospective_prediction_error(p))
        p['recorded_at'] = '2026-10-05T03:45:00+00:00'
        self.assertIsNotNone(ledger.prospective_prediction_error(p))
        p = self.prediction()
        p['input_cutoff'] = '2026-10-05T03:44:01+00:00'
        self.assertIsNotNone(ledger.prospective_prediction_error(p))

    def test_legacy_outcomes_and_late_predictions_are_excluded(self):
        p = self.prediction()
        late = dict(p, prediction_id='late', recorded_at='2026-10-06T00:00:00+00:00')
        out = dict(prediction_id='p1', ticker='TEST.NS', intended_session='2026-10-05')
        with patch.object(ledger, 'load_all_predictions', return_value=[p, late]), patch.object(ledger, 'load_all_outcomes', return_value=[out]):
            valid, outcomes, excluded = ledger.validated_observations()
            self.assertEqual(len(valid), 1)
            self.assertEqual(excluded, 1)
            self.assertEqual(outcomes, [])

    def test_backdated_record_is_rejected_before_write(self):
        with self.assertRaises(ValueError):
            ledger.record_prediction('TEST.NS', 'next', '2000-01-01', 100, 0.5)

    def test_legacy_ensemble_preserves_original_equal_vote(self):
        class Estimator:
            def __init__(self, prob):
                self.prob = prob
            def predict_proba(self, X):
                return np.array([[1-self.prob, self.prob]])
        model = EnsembleModel(Estimator(0.1), Estimator(0.4), Estimator(0.7))
        del model.weights  # Equivalent to the older serialized state.
        np.testing.assert_allclose(model.predict_proba(None), [[0.6, 0.4]])


if __name__ == '__main__':
    unittest.main()
