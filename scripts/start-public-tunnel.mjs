#!/usr/bin/env node
/**
 * Axion Public Tunnel Launcher
 * Creates a free, secure Cloudflare tunnel to expose local Axion without cloud hosting costs.
 */

import { spawn } from 'child_process';
import http from 'http';

const PORT = process.env.PORT || 3000;

function checkLocalServer(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/health`, (res) => {
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function main() {
  console.log('🌐 [Axion Tunnel] Checking local server status...');
  const isRunning = await checkLocalServer(PORT);

  if (!isRunning) {
    console.log(`⚠️ Local server not detected on port ${PORT}.`);
    console.log(`🚀 Tip: Start your server first in another terminal with: npm run dev`);
    console.log(`Starting tunnel anyway to http://localhost:${PORT}...`);
  } else {
    console.log(`✅ Axion server is online on http://localhost:${PORT}`);
  }

  console.log('📡 Requesting instant public HTTPS URL from Cloudflare (100% Free)...');

  // Use npx to execute cloudflared without requiring global install
  const tunnel = spawn('npx', ['-y', 'cloudflared', 'tunnel', '--url', `http://localhost:${PORT}`], {
    shell: true,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  const urlRegex = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

  tunnel.stderr.on('data', (data) => {
    const text = data.toString();
    const match = text.match(urlRegex);
    if (match) {
      console.log('\n======================================================');
      console.log('🎉 YOUR AXION APP IS LIVE ON THE INTERNET:');
      console.log(`👉 ${match[0]}`);
      console.log('======================================================');
      console.log('• 100% Free');
      console.log('• Direct access to your local machine & Python ML');
      console.log('• Keep this terminal open to keep the tunnel online.\n');
    }
  });

  tunnel.stdout.on('data', (data) => {
    const text = data.toString();
    const match = text.match(urlRegex);
    if (match) {
      console.log(`\n🎉 Public URL: ${match[0]}\n`);
    }
  });

  tunnel.on('close', (code) => {
    console.log(`Tunnel closed with exit code ${code}`);
  });
}

main().catch(console.error);
