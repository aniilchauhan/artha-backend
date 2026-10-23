# Axion Backend API & Quantitative Engine

Dedicated API server, database models, market daemons, and machine learning engine for Axion.

## Architecture
- **54 API Endpoints**: NSE stock screening, fundamentals, dividends, backtesting, portfolio management.
- **Stock-AI**: Python ML service (FastAPI + XGBoost, CatBoost, LightGBM).
- **Background Daemons**: Market session daemons, paper prediction reconcilers, radar workers.

## Environment Variables
Create `.env.local`:
```env
PORT=4000
MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.mongodb.net/axion
NEXTAUTH_SECRET=your_secret_key_32_chars
NEXTAUTH_URL=http://localhost:4000
# Optional external ML URL:
# STOCK_AI_SERVICE_URL=https://your-space.hf.space
```

## Running Locally
```bash
npm install
npm run dev # Starts API server on port 4000
```

## Deploying
- Can be deployed to **Render** as a Web Service.
- Can be deployed to **Railway** or **VPS / Docker Compose** with high RAM for Python ML execution.
