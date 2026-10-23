"""
Ensemble module for the Stock AI pipeline.
Contains the Soft Voting Classifier wrapper for combining LightGBM, XGBoost, and CatBoost
with uncertainty-aware probability calibration.
"""

import numpy as np


class EnsembleModel:
    """
    Advanced Soft Voting Ensemble combining LightGBM, XGBoost, and CatBoost.
    Features:
    1. Validation-weighted probability blending
    2. Epistemic uncertainty shrinkage (dampens extreme overconfident predictions when models strongly disagree)
    """
    def __init__(self, lgb_model, xgb_model, cb_model, weights=(0.40, 0.30, 0.30)):
        self.lgb_model = lgb_model
        self.xgb_model = xgb_model
        self.cb_model = cb_model
        self.estimators_ = [lgb_model, xgb_model, cb_model]
        total_w = sum(weights)
        self.weights = [w / total_w for w in weights]
        
    def predict_proba(self, X):
        p1 = self.lgb_model.predict_proba(X)
        p2 = self.xgb_model.predict_proba(X)
        p3 = self.cb_model.predict_proba(X)

        # Models saved before weighted blending used equal voting. Preserve
        # that exact scoring contract so their fitted calibrator remains valid.
        if not hasattr(self, 'weights'):
            return (p1 + p2 + p3) / 3.0
        
        # 1. Validation-weighted probability
        w_prob = self.weights[0] * p1 + self.weights[1] * p2 + self.weights[2] * p3
        
        # 2. Epistemic uncertainty shrinkage:
        # If the 3 gradient-boosted models have wide variance in predicted probability,
        # shrink towards 0.50 (uncertainty awareness) to eliminate hallucinated false breakouts.
        probs_matrix = np.stack([p1[:, 1], p2[:, 1], p3[:, 1]], axis=1)
        disagreement = np.std(probs_matrix, axis=1, keepdims=True)
        shrinkage = np.clip(1.0 - (disagreement * 0.4), 0.75, 1.0)
        
        calibrated_p1 = 0.5 + (w_prob[:, 1:2] - 0.5) * shrinkage
        calibrated_p0 = 1.0 - calibrated_p1
        
        return np.hstack([calibrated_p0, calibrated_p1])
        
    def predict(self, X, threshold=0.50):
        return (self.predict_proba(X)[:, 1] >= threshold).astype(int)
        
    @property
    def booster_(self):
        # Expose LGBM booster as a proxy for SHAP feature importance
        return self.lgb_model.booster_

