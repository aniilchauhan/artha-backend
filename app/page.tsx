export default function ApiHome() {
  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: '600px', margin: 'auto' }}>
      <h1>Axion API Engine</h1>
      <p>Status: <strong style={{ color: 'green' }}>Online</strong></p>
      <p>Endpoints available under <code>/api/*</code></p>
      <ul>
        <li><a href="/api/health">/api/health</a></li>
        <li><a href="/api/stock-ai/predictions">/api/stock-ai/predictions</a></li>
        <li><a href="/api/market-session/status">/api/market-session/status</a></li>
      </ul>
    </div>
  );
}
