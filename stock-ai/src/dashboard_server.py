"""
Local Web Dashboard Server for Indian NSE Stock AI System.
Lightweight, multi-threaded HTTP server providing static dashboard hosting
and JSON REST APIs for predictions, backtest results, calibration curves, and live scanning.
"""

import sys
import os
import json
import logging
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import urllib.parse

# Add project root to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config
from src import daily_pipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

DASHBOARD_DIR = config.BASE_DIR / "dashboard"


class DashboardHandler(SimpleHTTPRequestHandler):
    """
    HTTP Request Handler serving dashboard static assets and REST API endpoints.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DASHBOARD_DIR), **kwargs)

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        if path == "/api/predictions":
            self.serve_json_file(config.OUTPUTS_DIR / "latest_predictions.json")
        elif path == "/api/backtest":
            self.serve_backtest_data()
        elif path == "/api/calibration":
            self.serve_json_file(config.OUTPUTS_DIR / "evaluation_report.json")
        elif path == "/api/features":
            self.serve_feature_importance()
        elif path == "/api/paper/signals":
            self.serve_csv_as_json(config.OUTPUTS_DIR / "paper_trading" / "all_signals.csv")
        elif path == "/api/paper/results":
            self.serve_csv_as_json(config.OUTPUTS_DIR / "paper_trading" / "all_results.csv")
        elif path == "/api/paper/portfolio":
            self.serve_json_file(config.OUTPUTS_DIR / "paper_trading" / "portfolio_allocation.json")
        else:
            # Fallback to serving static frontend files from dashboard/
            if path == "/" or not path:
                self.path = "/index.html"
            super().do_GET()

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        if path == "/api/scan":
            try:
                logger.info("Triggering on-demand EOD market scan...")
                daily_pipeline.run_pipeline(force_download=False, retrain_model=False)
                self.serve_json_file(config.OUTPUTS_DIR / "latest_predictions.json")
            except Exception as e:
                logger.error(f"Error executing scan: {e}")
                self.send_error(500, f"Scan failed: {e}")
        elif path == "/api/paper/run":
            try:
                logger.info("Running on-demand forward paper trading routine...")
                from src import daily_paper_signal, intraday_evaluator, portfolio_allocator
                daily_paper_signal.evaluate_past_signals()
                daily_paper_signal.generate_daily_paper_signals()
                portfolio_allocator.generate_portfolio_allocation_sample()
                self.serve_csv_as_json(config.OUTPUTS_DIR / "paper_trading" / "all_signals.csv")
            except Exception as e:
                logger.error(f"Error executing paper routine: {e}")
                self.send_error(500, f"Paper routine failed: {e}")
        else:
            self.send_error(404, "Endpoint not found")

    def serve_csv_as_json(self, csv_path: Path):
        """Converts CSV file rows to JSON array response."""
        if not csv_path.exists() or os.path.getsize(csv_path) == 0:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b"[]")
            return

        import pandas as pd
        try:
            df = pd.read_csv(csv_path)
            # Fill NaN for clean JSON serialization
            df = df.fillna("")
            payload = df.to_json(orient="records")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(payload.encode("utf-8"))
        except Exception as e:
            self.send_error(500, f"Error processing CSV: {e}")

    def serve_json_file(self, file_path: Path):
        """Helper to send JSON file responses."""
        if not file_path.exists():
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": f"File {file_path.name} not found"}).encode("utf-8"))
            return

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(content.encode("utf-8"))
        except Exception as e:
            self.send_error(500, f"Error reading file: {e}")

    def serve_backtest_data(self):
        """Merges backtest summary and strategy comparisons into one response."""
        summary_path = config.OUTPUTS_DIR / "backtest_summary.json"
        strat_path = config.OUTPUTS_DIR / "strategy_comparison.json"

        response_data = {}
        if summary_path.exists():
            with open(summary_path, "r", encoding="utf-8") as f:
                response_data = json.load(f)

        if strat_path.exists():
            with open(strat_path, "r", encoding="utf-8") as f:
                comparisons = json.load(f)
            summary_evaluation_id = response_data.get("evaluation_id")
            matching = (
                isinstance(comparisons, list)
                and bool(comparisons)
                and bool(summary_evaluation_id)
                and all(isinstance(item, dict) for item in comparisons)
                and all(item.get("evaluation_id") == summary_evaluation_id for item in comparisons)
            )
            if matching:
                response_data["strategy_comparison"] = comparisons
            elif not isinstance(response_data.get("strategy_comparison"), list):
                response_data["strategy_comparison"] = []

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(response_data).encode("utf-8"))

    def serve_feature_importance(self):
        """Sends top feature importances from models/."""
        feat_csv = config.MODELS_DIR / "feature_importance.csv"
        if not feat_csv.exists():
            self.send_error(404, "Feature importance file not found")
            return

        import pandas as pd
        df = pd.read_csv(feat_csv).head(25)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(df.to_json(orient="records").encode("utf-8"))


def start_server(port: int = 8050):
    server_address = ("", port)
    try:
        httpd = ThreadingHTTPServer(server_address, DashboardHandler)
    except OSError:
        port = port + 1
        server_address = ("", port)
        httpd = ThreadingHTTPServer(server_address, DashboardHandler)

    url = f"http://localhost:{port}"
    print("\n" + "=" * 75)
    print(f"NSE STOCK AI — INTERACTIVE RESEARCH DASHBOARD")
    print(f"Local Server URL : {url}")
    print(f"Static Directory : {DASHBOARD_DIR}")
    print(f"Press Ctrl+C to terminate.")
    print("=" * 75 + "\n")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping dashboard server...")
        httpd.server_close()


if __name__ == "__main__":
    start_server(port=8050)
