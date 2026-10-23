from pathlib import Path
import sys

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(BASE_DIR))

import config
from src import dataset

print("Current TARGET_MODE:", getattr(config, "TARGET_MODE", "None"))
train, val, test = dataset.get_chronological_splits()
print(f"TRAIN: rows={len(train):,}, target mean={train['target'].mean()*100:.2f}% (pos={int(train['target'].sum()):,})")
print(f"VAL:   rows={len(val):,}, target mean={val['target'].mean()*100:.2f}% (pos={int(val['target'].sum()):,})")
print(f"TEST:  rows={len(test):,}, target mean={test['target'].mean()*100:.2f}% (pos={int(test['target'].sum()):,})")
