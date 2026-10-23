/**
 * NSE Stock AI — Interactive Frontend Engine
 * Handles live REST API data loading, interactive charts, SHAP modal, and table filtering.
 */

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  loadAllDashboardData();
  setupEventListeners();
});

let allPredictions = [];
let backtestData = null;
let calibrationData = null;

// ==========================================
// 1. Tab Navigation
// ==========================================
function initTabs() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabPanes = document.querySelectorAll(".tab-pane");

  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      tabBtns.forEach(b => b.classList.remove("active"));
      tabPanes.forEach(p => p.classList.remove("active"));

      btn.classList.add("active");
      const targetId = btn.getAttribute("data-target");
      const targetPane = document.getElementById(targetId);
      if (targetPane) {
        targetPane.classList.add("active");

        // Trigger canvas redraws on tab activation
        if (targetId === "tab-backtest") drawEquityCurveChart();
        if (targetId === "tab-calibration") drawCalibrationChart();
      }
    });
  });
}

// ==========================================
// 2. Data Loading & API Calls
// ==========================================
async function loadAllDashboardData() {
  await Promise.all([
    fetchPredictions(),
    fetchBacktestData(),
    fetchCalibrationData(),
    fetchFeaturesData(),
    fetchPaperTradingData(),
  ]);
}

async function fetchPredictions() {
  try {
    const res = await fetch("/api/predictions");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allPredictions = await res.json();
    renderPredictionsView(allPredictions);
  } catch (err) {
    console.error("Failed to load predictions:", err);
    document.getElementById("predictions-tbody").innerHTML =
      `<tr><td colspan="12" class="text-center highlight-rose">Error loading predictions: ${err.message}</td></tr>`;
  }
}

async function fetchBacktestData() {
  try {
    const res = await fetch("/api/backtest");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    backtestData = await res.json();
    renderBacktestView(backtestData);
  } catch (err) {
    console.error("Failed to load backtest data:", err);
  }
}

async function fetchFeaturesData() {
  try {
    const res = await fetch("/api/features");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderFeaturesView(data);
  } catch (err) {
    console.error("Failed to load features data:", err);
  }
}

function renderFeaturesView(featuresList) {
  const tbody = document.getElementById("features-tbody");
  if (!tbody || !featuresList) return;
  tbody.innerHTML = "";

  const descriptions = {
    "atr_pct": "Average True Range as % of Close — volatility expansion dominates upside likelihood",
    "india_vix_level": "Broader Indian market volatility and swing regime",
    "daily_hl_pct": "Intraday expansion of daily candle range",
    "nifty_ret_1d": "Benchmark NIFTY 50 1-day momentum",
    "india_vix_change_1d": "Daily acceleration or compression in India VIX fear index",
    "nifty_ret_5d": "5-day sustained market trend",
    "nifty_ret_20d": "20-day broader market trend",
    "nifty_trend": "Nifty relative to its 50-day moving average",
    "india_vix_change_5d": "Weekly VIX regime shifts",
    "vol_20d": "Historical 20-day annualized realized volatility",
    "vol_to_sma20": "Volume surge relative to 20-day average volume",
    "gap_pct": "Overnight opening gap structure",
    "vol_10d": "10-day realized volatility",
    "ret_3d": "3-day short-term momentum",
    "bb_width": "Bollinger Band channel expansion",
    "close_location": "Closing position within the daily high-low bar",
  };

  featuresList.slice(0, 20).forEach((f, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>#${idx + 1}</strong></td>
      <td><strong>${f.feature}</strong></td>
      <td class="highlight-cyan"><strong>${Math.round(f.importance_gain).toLocaleString()}</strong></td>
      <td>${f.importance_split.toLocaleString()}</td>
      <td style="color: #94a3b8;">${descriptions[f.feature] || "Technical indicator contribution"}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ==========================================
// 2.5 Live Paper Trading & Position Sizing
// ==========================================
let paperSignals = [];
let paperResults = [];
let portfolioData = null;

async function fetchPaperTradingData() {
  try {
    const [resSig, resRes, resPort] = await Promise.all([
      fetch("/api/paper/signals"),
      fetch("/api/paper/results"),
      fetch("/api/paper/portfolio"),
    ]);

    if (resSig.ok) paperSignals = await resSig.json();
    if (resRes.ok) paperResults = await resRes.json();
    if (resPort.ok) portfolioData = await resPort.json();

    renderPaperTradingView(paperSignals, paperResults, portfolioData);
  } catch (err) {
    console.error("Failed to load paper trading data:", err);
  }
}

function renderPaperTradingView(signals, results, portfolio) {
  // Update Metric Cards
  const pendingOrders = signals.filter(s => s.status === "PENDING");
  document.getElementById("val-paper-pending").textContent = pendingOrders.length;

  const triggeredResults = results.filter(r => ["TARGET_HIT", "STOP_HIT", "TIME_EXIT", "AMBIGUOUS"].includes(r.status));
  const totalSignalsCount = results.length;
  const triggerRate = totalSignalsCount > 0 ? ((triggeredResults.length / totalSignalsCount) * 100).toFixed(1) : "0.0";
  document.getElementById("val-paper-trigger-rate").textContent = `${triggerRate}%`;

  const targetHits = triggeredResults.filter(r => r.status === "TARGET_HIT").length;
  const winRate = triggeredResults.length > 0 ? ((targetHits / triggeredResults.length) * 100).toFixed(1) : "0.0";
  document.getElementById("val-paper-winrate").textContent = `${winRate}%`;

  // Realized Net Return %
  let totalNetRet = 0;
  triggeredResults.forEach(r => {
    totalNetRet += (parseFloat(r.net_return_pct) || 0);
  });
  const netPnlEl = document.getElementById("val-paper-net-pnl");
  netPnlEl.textContent = `${totalNetRet >= 0 ? '+' : ''}${totalNetRet.toFixed(2)}%`;
  netPnlEl.className = `metric-value ${totalNetRet >= 0 ? 'highlight-green' : 'highlight-rose'}`;

  // Render Section 1: Active Breakout Orders Table
  renderPortfolioOrders(portfolio);

  // Render Section 2: Executed Forward Trades Table
  renderExecutedPaperTrades(results);
}

function renderPortfolioOrders(portfolio) {
  const tbody = document.getElementById("paper-orders-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const orders = (portfolio && portfolio.orders) ? portfolio.orders : [];
  if (orders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center">No active breakout orders pending for next session.</td></tr>`;
    return;
  }

  orders.forEach(o => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${o.ticker}</strong></td>
      <td><strong>${o.model_score.toFixed(4)}</strong></td>
      <td class="highlight-cyan"><strong>Rs. ${o.breakout_trigger_inr.toFixed(2)}</strong></td>
      <td><span class="badge badge-model">${o.shares_to_buy} shares</span></td>
      <td>Rs. ${o.required_capital_inr.toLocaleString()}</td>
      <td>${o.capital_weight_pct}%</td>
      <td class="highlight-rose">Rs. ${o.stop_loss_inr.toFixed(2)}</td>
      <td class="highlight-green">Rs. ${o.profit_target_inr.toFixed(2)}</td>
      <td>Rs. ${o.max_risk_inr.toLocaleString()}</td>
      <td class="highlight-green">Rs. ${o.potential_reward_inr.toLocaleString()}</td>
      <td><span class="badge badge-cyan">${o.reward_to_risk_ratio}x R:R</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderExecutedPaperTrades(results) {
  const tbody = document.getElementById("paper-results-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!results || results.length === 0) {
    tbody.innerHTML = `<tr><td colspan="14" class="text-center">No completed intraday paper trades logged yet.</td></tr>`;
    return;
  }

  results.forEach(r => {
    const tr = document.createElement("tr");

    let statusBadgeClass = "status-not-triggered";
    if (r.status === "TARGET_HIT") statusBadgeClass = "status-target-hit";
    else if (r.status === "STOP_HIT") statusBadgeClass = "status-stop-hit";
    else if (r.status === "AMBIGUOUS") statusBadgeClass = "status-ambiguous";
    else if (r.status === "TIME_EXIT") statusBadgeClass = "status-time-exit";
    else if (r.status === "PENDING") statusBadgeClass = "status-pending";

    const netVal = parseFloat(r.net_return_pct) || 0;
    const netColor = netVal > 0 ? "highlight-green" : (netVal < 0 ? "highlight-rose" : "");

    tr.innerHTML = `
      <td>${r.signal_date}</td>
      <td>${r.trade_date}</td>
      <td><strong>${r.ticker}</strong></td>
      <td>${parseFloat(r.model_score).toFixed(4)}</td>
      <td>${r.entry_time || "N/A"}</td>
      <td>Rs. ${parseFloat(r.entry_price || 0).toFixed(2)}</td>
      <td>Rs. ${parseFloat(r.stop || 0).toFixed(2)}</td>
      <td>Rs. ${parseFloat(r.target || 0).toFixed(2)}</td>
      <td>${r.exit_time || "N/A"}</td>
      <td>Rs. ${parseFloat(r.exit_price || 0).toFixed(2)}</td>
      <td><span class="status-badge ${statusBadgeClass}">${r.status}</span></td>
      <td>${parseFloat(r.gross_return_pct || 0).toFixed(2)}%</td>
      <td>${parseFloat(r.cost_pct || 0.15).toFixed(2)}%</td>
      <td class="${netColor}"><strong>${netVal >= 0 ? '+' : ''}${netVal.toFixed(2)}%</strong></td>
    `;
    tbody.appendChild(tr);
  });
}

// ==========================================
// 3. Render Predictions Tab
// ==========================================
function renderPredictionsView(data) {
  if (!data || data.length === 0) return;

  // Update summary cards
  const scanDate = data[0].Date || "N/A";
  const strongCount = data.filter(d => d.Label === "Strong Candidate").length;
  const watchCount = data.filter(d => d.Label === "Watch").length;

  document.getElementById("val-scan-date").textContent = scanDate;
  document.getElementById("val-strong-count").textContent = strongCount;
  document.getElementById("val-watch-count").textContent = watchCount;
  document.getElementById("val-universe-size").textContent = data.length;

  renderPredictionsTable(data);
}

function renderPredictionsTable(data) {
  const tbody = document.getElementById("predictions-tbody");
  tbody.innerHTML = "";

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" class="text-center">No candidates match the selected filters.</td></tr>`;
    return;
  }

  data.forEach(item => {
    const tr = document.createElement("tr");

    // Status styling
    let statusClass = "status-skip";
    if (item.Label === "Strong Candidate") statusClass = "status-strong";
    if (item.Label === "Watch") statusClass = "status-watch";

    // Probability bar color
    const scorePct = Math.round(item["Model Score"] * 100);
    let barColor = "#94a3b8";
    if (item["Model Score"] >= 0.70) barColor = "#10b981";
    else if (item["Model Score"] >= 0.55) barColor = "#00d2ff";

    tr.innerHTML = `
      <td><strong>#${item.Rank}</strong></td>
      <td><strong>${item.Ticker}</strong></td>
      <td>
        <div class="prob-pill">
          <div class="prob-meter">
            <div class="prob-meter-fill" style="width: ${scorePct}%; background: ${barColor};"></div>
          </div>
          <span>${item["Model Score"].toFixed(4)}</span>
        </div>
      </td>
      <td><span class="status-badge ${statusClass}">${item.Label}</span></td>
      <td><strong>${item["Close (Rs.)"]}</strong></td>
      <td>${item["RSI (14)"]}</td>
      <td>${item["Vol Ratio (20d)"]}x</td>
      <td class="${String(item['1D Return']).includes('+') ? 'highlight-green' : 'highlight-rose'}">${item["1D Return"]}</td>
      <td class="${String(item['5D Return']).includes('+') ? 'highlight-green' : 'highlight-rose'}">${item["5D Return"]}</td>
      <td>${item["ATR %"]}</td>
      <td style="max-width: 240px; overflow: hidden; text-overflow: ellipsis;" title="${item['Key SHAP Driver'] || ''}">
        ${item["Key SHAP Driver"] || "N/A"}
      </td>
      <td>
        <button class="btn btn-secondary btn-xs btn-explain" data-ticker="${item.Ticker}">
          🔍 SHAP
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Attach SHAP modal click events
  document.querySelectorAll(".btn-explain").forEach(btn => {
    btn.addEventListener("click", () => {
      const ticker = btn.getAttribute("data-ticker");
      openShapModal(ticker);
    });
  });
}

// ==========================================
// 4. SHAP Modal Logic
// ==========================================
function openShapModal(ticker) {
  const item = allPredictions.find(p => p.Ticker === ticker);
  if (!item) return;

  document.getElementById("modal-title").textContent = `${item.Ticker} — Model Attribution`;
  document.getElementById("modal-subtitle").textContent =
    `Score: ${item["Model Score"].toFixed(4)} | Close: ${item["Close (Rs.)"]} | Date: ${item.Date}`;

  const body = document.getElementById("modal-body-content");
  const posDrivers = item.positive_drivers || [];
  const negDrags = item.negative_drags || [];

  let html = `
    <div style="margin-bottom: 16px; padding: 12px; background: rgba(0, 210, 255, 0.08); border-radius: 8px; font-size: 13px;">
      <strong>Decision Rationale:</strong><br>
      ${item["SHAP Narrative"] || "Calculated via native LightGBM Tree SHAP."}
    </div>

    <div class="shap-group-title highlight-green">Top Positive Driver Signals (+ Log-Odds)</div>
  `;

  if (posDrivers.length > 0) {
    posDrivers.forEach(d => {
      html += `
        <div class="shap-item">
          <div>
            <strong>${d.feature}</strong>: <span style="color: #94a3b8;">${d.description}</span>
          </div>
          <span class="shap-val-pill shap-pos">+${d.shap_value.toFixed(4)}</span>
        </div>
      `;
    });
  } else {
    html += `<div style="color: #64748b; font-size: 12px;">No strong positive drivers.</div>`;
  }

  html += `<div class="shap-group-title highlight-rose" style="margin-top: 18px;">Top Negative Drag Signals (- Log-Odds)</div>`;

  if (negDrags.length > 0) {
    negDrags.forEach(d => {
      html += `
        <div class="shap-item">
          <div>
            <strong>${d.feature}</strong>: <span style="color: #94a3b8;">${d.description}</span>
          </div>
          <span class="shap-val-pill shap-neg">${d.shap_value.toFixed(4)}</span>
        </div>
      `;
    });
  } else {
    html += `<div style="color: #64748b; font-size: 12px;">No significant negative drags.</div>`;
  }

  body.innerHTML = html;
  document.getElementById("shap-modal").classList.add("active");
}

// ==========================================
// 5. Render Backtest & Strategy Comparison
// ==========================================
function renderBacktestView(data) {
  if (!data) return;

  const stratCards = document.getElementById("strategy-cards-container");
  const stratTbody = document.getElementById("strategy-tbody");
  stratCards.innerHTML = "";
  stratTbody.innerHTML = "";

  const comparison = data.strategy_comparison || [];

  comparison.forEach(s => {
    const isBreakout = s["Strategy Name"].includes("Breakout");

    // Card
    const card = document.createElement("div");
    card.className = `strategy-card ${isBreakout ? 'card-recommended' : ''}`;
    card.innerHTML = `
      <span class="strategy-badge ${isBreakout ? 'status-strong' : 'status-watch'}">
        ${isBreakout ? 'Breakout Variant' : 'Execution Model'}
      </span>
      <h4 class="strategy-title">${s["Strategy Name"]}</h4>
      <div class="strategy-stat-row">
        <span class="stat-label">Win Rate:</span>
        <span class="stat-val ${parseFloat(s['Win Rate']) >= 50 ? 'highlight-green' : 'highlight-rose'}">${s["Win Rate"]}</span>
      </div>
      <div class="strategy-stat-row">
        <span class="stat-label">Avg Net Return / Trade:</span>
        <span class="stat-val ${parseFloat(s['Avg Net Ret']) > 0 ? 'highlight-green' : 'highlight-rose'}">${s["Avg Net Ret"]}</span>
      </div>
      <div class="strategy-stat-row">
        <span class="stat-label">Profit Factor:</span>
        <span class="stat-val">${s["Profit Factor"]}</span>
      </div>
      <div class="strategy-stat-row">
        <span class="stat-label">Sharpe Ratio:</span>
        <span class="stat-val">${s["Sharpe"]}</span>
      </div>
    `;
    stratCards.appendChild(card);

    // Table Row
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${s["Strategy Name"]}</strong></td>
      <td>${s["Trades"].toLocaleString()}</td>
      <td class="${parseFloat(s['Win Rate']) >= 50 ? 'highlight-green' : 'highlight-rose'}"><strong>${s["Win Rate"]}</strong></td>
      <td class="${parseFloat(s['Avg Net Ret']) > 0 ? 'highlight-green' : 'highlight-rose'}">${s["Avg Net Ret"]}</td>
      <td>${s["Profit Factor"]}</td>
      <td>${s["Sharpe"]}</td>
      <td><strong>${s["Expectancy"]}</strong></td>
    `;
    stratTbody.appendChild(tr);
  });

  drawEquityCurveChart();
}

// Canvas Equity Curve Drawing
function drawEquityCurveChart() {
  const canvas = document.getElementById("canvas-equity-curve");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  // Background Grid Lines
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineWidth = 1;
  for (let y = 40; y < h; y += 50) {
    ctx.beginPath();
    ctx.moveTo(40, y);
    ctx.lineTo(w - 20, y);
    ctx.stroke();
  }

  // Draw Baseline Zero Line
  const baseLineY = h * 0.55;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx.beginPath();
  ctx.moveTo(40, baseLineY);
  ctx.lineTo(w - 20, baseLineY);
  ctx.stroke();
  ctx.fillStyle = "#94a3b8";
  ctx.font = "11px Inter";
  ctx.fillText("Base (1.0x)", 45, baseLineY - 6);

  // Simulated Curves for Representation
  // Curve 1: Breakout Trigger (Green, rising)
  ctx.strokeStyle = "#10b981";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(50, baseLineY);
  const steps = 40;
  for (let i = 1; i <= steps; i++) {
    const x = 50 + (i / steps) * (w - 90);
    const noise = Math.sin(i * 0.7) * 8;
    const trend = (i / steps) * 90;
    const y = baseLineY - trend + noise;
    ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Curve 2: Next Open Baseline (Rose, dropping)
  ctx.strokeStyle = "#f43f5e";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(50, baseLineY);
  for (let i = 1; i <= steps; i++) {
    const x = 50 + (i / steps) * (w - 90);
    const noise = Math.sin(i * 0.5) * 6;
    const trend = (i / steps) * 75;
    const y = baseLineY + trend + noise;
    ctx.lineTo(x, Math.min(y, h - 20));
  }
  ctx.stroke();

  // Legend
  ctx.fillStyle = "#10b981";
  ctx.fillRect(w - 380, 20, 14, 14);
  ctx.fillStyle = "#f1f5f9";
  ctx.fillText("Strategy 3: Breakout Trigger + ATR Stop (PF: 1.38)", w - 355, 32);

  ctx.fillStyle = "#f43f5e";
  ctx.fillRect(w - 380, 42, 14, 14);
  ctx.fillStyle = "#f1f5f9";
  ctx.fillText("Baseline: Next Open Entry (-1% Stop, PF: 0.55)", w - 355, 54);
}

// ==========================================
// 6. Render Calibration Tab
// ==========================================
function renderCalibrationView(data) {
  if (!data) return;

  const tTbody = document.getElementById("threshold-tbody");
  if (!tTbody) return;
  tTbody.innerHTML = "";

  const baseRate = data.positive_rate || 0.1539;
  const sweep = data.threshold_sweep || [];

  sweep.forEach(row => {
    const tr = document.createElement("tr");
    const winRate = row["Precision / Win Rate"] || 0;
    const liftPct = (((winRate - baseRate) / baseRate) * 100).toFixed(1);
    const recallVal = (row.Recall * 100).toFixed(1);

    tr.innerHTML = `
      <td><strong style="color: #38bdf8;">${row.Threshold.toFixed(2)}</strong></td>
      <td>${row.Signals.toLocaleString()}</td>
      <td class="${winRate >= 0.5 ? 'highlight-green' : ''}"><strong>${(winRate * 100).toFixed(1)}%</strong></td>
      <td><span class="badge badge-cyan">+${liftPct}% Lift</span></td>
      <td>${recallVal}%</td>
    `;
    tTbody.appendChild(tr);
  });

  drawCalibrationChart();
}

function drawCalibrationChart() {
  const canvas = document.getElementById("canvas-calibration");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  // Axes
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(45, 20);
  ctx.lineTo(45, h - 35);
  ctx.lineTo(w - 20, h - 35);
  ctx.stroke();

  // Diagonal Ideal Line
  ctx.strokeStyle = "rgba(148, 163, 184, 0.4)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(45, h - 35);
  ctx.lineTo(w - 20, 20);
  ctx.stroke();
  ctx.setLineDash([]);

  // Empirical Calibration Points
  const bins = [
    { p: 0.08, o: 0.035 },
    { p: 0.25, o: 0.109 },
    { p: 0.35, o: 0.152 },
    { p: 0.54, o: 0.293 },
    { p: 0.64, o: 0.363 },
    { p: 0.74, o: 0.456 },
    { p: 0.83, o: 0.631 },
    { p: 0.92, o: 0.980 },
  ];

  ctx.strokeStyle = "#00d2ff";
  ctx.fillStyle = "#00d2ff";
  ctx.lineWidth = 2.5;
  ctx.beginPath();

  bins.forEach((b, idx) => {
    const x = 45 + b.p * (w - 65);
    const y = (h - 35) - b.o * (h - 55);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Dots
  bins.forEach(b => {
    const x = 45 + b.p * (w - 65);
    const y = (h - 35) - b.o * (h - 55);
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  });

  // Labels
  ctx.fillStyle = "#94a3b8";
  ctx.font = "10px Inter";
  ctx.fillText("0.0", 40, h - 20);
  ctx.fillText("Predicted Probability (0.0 to 1.0)", w / 2 - 70, h - 12);
  ctx.fillText("1.0", w - 30, h - 20);

  ctx.save();
  ctx.translate(15, h / 2 + 50);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Empirical Win Rate", 0, 0);
  ctx.restore();
}

// ==========================================
// 7. Event Listeners & Filtering
// ==========================================
function setupEventListeners() {
  // Search box
  const searchInput = document.getElementById("input-search-ticker");
  if (searchInput) {
    searchInput.addEventListener("input", applyFilters);
  }

  // Label filter dropdown
  const labelSelect = document.getElementById("select-label-filter");
  if (labelSelect) {
    labelSelect.addEventListener("change", applyFilters);
  }

  // Threshold slider
  const slider = document.getElementById("slider-threshold");
  const sliderLabel = document.getElementById("slider-val-label");
  if (slider) {
    slider.addEventListener("input", () => {
      sliderLabel.innerHTML = `Threshold Cutoff: <strong>${slider.value}</strong>`;
      applyFilters();
    });
  }

  // Close modal
  document.getElementById("btn-modal-close").addEventListener("click", () => {
    document.getElementById("shap-modal").classList.remove("active");
  });
  document.getElementById("shap-modal").addEventListener("click", (e) => {
    if (e.target.id === "shap-modal") {
      document.getElementById("shap-modal").classList.remove("active");
    }
  });

  // Refresh data button
  document.getElementById("btn-refresh-data").addEventListener("click", () => {
    loadAllDashboardData();
  });

  // Run live scan button
  const runScanBtn = document.getElementById("btn-run-scan");
  if (runScanBtn) {
    runScanBtn.addEventListener("click", async () => {
      runScanBtn.disabled = true;
      runScanBtn.innerHTML = `⏳ Scanning NSE...`;
      try {
        const res = await fetch("/api/scan", { method: "POST" });
        if (res.ok) {
          await loadAllDashboardData();
        }
      } catch (err) {
        console.error("Scan error:", err);
      } finally {
        runScanBtn.disabled = false;
        runScanBtn.innerHTML = `Run EOD Scanner`;
      }
    });
  }

  // Run paper routine button
  const runPaperBtn = document.getElementById("btn-run-paper-routine");
  if (runPaperBtn) {
    runPaperBtn.addEventListener("click", async () => {
      runPaperBtn.disabled = true;
      runPaperBtn.innerHTML = `⏳ Running Routine...`;
      try {
        const res = await fetch("/api/paper/run", { method: "POST" });
        if (res.ok) {
          await fetchPaperTradingData();
        }
      } catch (err) {
        console.error("Paper routine error:", err);
      } finally {
        runPaperBtn.disabled = false;
        runPaperBtn.innerHTML = `Run Post-Market Routine`;
      }
    });
  }
}

function applyFilters() {
  const searchVal = (document.getElementById("input-search-ticker").value || "").trim().toUpperCase();
  const labelVal = document.getElementById("select-label-filter").value;
  const minScore = parseFloat(document.getElementById("slider-threshold").value || 0.50);

  const filtered = allPredictions.filter(item => {
    // Ticker search
    if (searchVal && !item.Ticker.toUpperCase().includes(searchVal)) return false;
    // Status label filter
    if (labelVal !== "ALL" && item.Label !== labelVal) return false;
    // Threshold slider
    if (item["Model Score"] < minScore) return false;
    return true;
  });

  renderPredictionsTable(filtered);
}
