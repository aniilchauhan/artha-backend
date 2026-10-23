import { spawn } from 'child_process';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const mobileDir = path.resolve(rootDir, 'mobile');

async function isPortInUse(port) {
  const check = (host) =>
    new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(800);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('error', () => {
        resolve(false);
      });
      socket.connect(port, host);
    });
  return (await check('127.0.0.1')) || (await check('::1'));
}

const processes = [];

function log(tag, message) {
  const time = new Date().toLocaleTimeString('en-IN', { hour12: false });
  const lines = String(message).split('\n');
  for (const line of lines) {
    if (line.trim()) {
      console.log(`[${time}] ${tag} ${line}`);
    }
  }
}

function startProcess(name, command, args, cwd) {
  const tag = `[${name}]`.padEnd(10);
  log(tag, `Starting: ${command} ${args.join(' ')}`);

  const child = spawn(command, args, {
    cwd,
    shell: true,
    env: { ...process.env, FORCE_COLOR: '1', CI: '1', EXPO_NO_INTERACTIVE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (data) => log(tag, data.toString()));
  child.stderr.on('data', (data) => log(tag, data.toString()));

  child.on('exit', (code, signal) => {
    log(tag, `Exited with code ${code ?? signal}`);
  });

  child.on('error', (err) => {
    log(tag, `Failed to start: ${err.message}`);
  });

  processes.push({ name, child });
  return child;
}

function cleanup() {
  console.log('\nShutting down all Axion services...');
  for (const { name, child } of processes) {
    try {
      if (child && !child.killed) {
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
        } else {
          child.kill('SIGTERM');
        }
      }
    } catch (e) {
      // Ignore cleanup error
    }
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', () => {
  for (const { child } of processes) {
    try {
      if (child && !child.killed && child.pid) {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
        } else {
          child.kill('SIGTERM');
        }
      }
    } catch {}
  }
});

async function main() {
  console.log('========================================================');
  console.log('⚡ Axion Unified Launcher — Starting all services');
  console.log('========================================================\n');

  // 0. Headroom Context Optimization Proxy
  const headroomPortInUse = await isPortInUse(8787);
  if (headroomPortInUse) {
    log('[HEADROOM]', 'Headroom proxy is active on http://127.0.0.1:8787 (Dashboard: /dashboard)');
  } else {
    startProcess('HEADROOM', 'headroom', ['proxy', '--port', '8787'], rootDir);
  }

  // 1. Next.js Web Dev Server
  const webPortInUse = await isPortInUse(3000);
  if (webPortInUse) {
    log('[WEB]     ', 'Next.js dev server is already active on http://127.0.0.1:3000');
  } else {
    startProcess('WEB', 'npx', ['next', 'dev'], rootDir);
  }

  // 2. Market Session Automation Daemon
  startProcess('DAEMON', 'node', ['scripts/market-session-daemon.mjs', '--daemon'], rootDir);

  startProcess('RESEARCH', 'node', ['--import', 'tsx', 'scripts/backend-research-worker.ts'], rootDir);
  startProcess('OLLAMA', 'node', ['--env-file-if-exists=.env.local', '--import', 'tsx', 'scripts/ollama-evidence-worker.ts'], rootDir);
  startProcess('ALERTS', 'node', ['--env-file-if-exists=.env.local', '--import', 'tsx', 'scripts/alerts-worker.mjs'], rootDir);
  startProcess('RADAR', 'node', ['--env-file-if-exists=.env.local', '--import', 'tsx', 'scripts/momentum-radar-worker.ts'], rootDir);

  // 4. Mobile Expo Development Server
  const skipMobile = process.argv.includes('--no-mobile') || process.env.NO_MOBILE === '1';
  if (skipMobile) {
    log('[MOBILE]  ', 'Skipping Mobile Expo server (--no-mobile requested)');
  } else {
    const mobilePortInUse = await isPortInUse(8081);
    if (mobilePortInUse) {
      log('[MOBILE]  ', 'Mobile Expo server is already active on http://localhost:8081');
    } else {
      startProcess('MOBILE', 'npx', ['expo', 'start', '--localhost'], mobileDir);
    }
  }

  console.log('\nAll Axion services have been launched. Press Ctrl+C to terminate all services.\n');
}

main().catch((err) => {
  console.error('Unified launcher error:', err);
  cleanup();
});
