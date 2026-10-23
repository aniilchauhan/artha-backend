import pandas as pd
import numpy as np
import logging
import yfinance as yf
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parent.parent))
import config

logger = logging.getLogger(__name__)

def generate_synthetic_fii_dii(force_regenerate=False) -> pd.DataFrame:
    """
    Generates synthetic but highly correlated FII/DII daily data.
    In reality, FII data should be scraped from the NSE website or via a premium API.
    Because FII flow is strongly correlated with Nifty 50 movement:
      - FII usually buys when the market goes up (trend following).
      - DII usually acts counter-cyclical (buying dips).
    """
    output_path = config.MARKET_DIR / "FIIDII.csv"
    
    if output_path.exists() and not force_regenerate:
        logger.info(f"Loaded synthetic FII/DII data from {output_path}")
        df = pd.read_csv(output_path, parse_dates=["Date"])
        df.set_index("Date", inplace=True)
        return df

    logger.info("Generating synthetic FII/DII data using Nifty 50 as a proxy...")
    nifty = yf.download("^NSEI", start=config.TRAIN_START, end=config.TEST_END, progress=False)
    
    # Flatten multi-index columns if present (yfinance >= 0.2.40)
    if isinstance(nifty.columns, pd.MultiIndex):
        nifty.columns = nifty.columns.get_level_values(0)
        
    nifty['Ret'] = nifty['Close'].pct_change()
    nifty.dropna(inplace=True)
    
    np.random.seed(42)
    
    # FII: Correlated positively with Nifty daily return + some noise
    # Base multiplier: 1% return ~ 3000 Cr FII buying
    fii_base = nifty['Ret'] * 300000 
    fii_noise = np.random.normal(loc=0, scale=1500, size=len(nifty))
    nifty['fii_net'] = fii_base + fii_noise
    
    # DII: Slightly counter-cyclical to FII (buying the dip) + constant SIP inflows
    dii_base = -0.4 * nifty['fii_net'] + 1000  # constant domestic SIP inflow
    dii_noise = np.random.normal(loc=0, scale=800, size=len(nifty))
    nifty['dii_net'] = dii_base + dii_noise
    
    # Round to 2 decimals
    df = pd.DataFrame({
        'fii_net': nifty['fii_net'].round(2),
        'dii_net': nifty['dii_net'].round(2)
    })
    
    config.MARKET_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_path)
    logger.info(f"Saved synthetic FII/DII data to {output_path}")
    
    return df

if __name__ == "__main__":
    generate_synthetic_fii_dii(force_regenerate=True)
