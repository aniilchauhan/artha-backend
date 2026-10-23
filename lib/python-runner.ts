import { getAxionProjectRoot } from './project-root';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { acquireJobLease, releaseJobLease, type JobLeaseHandle } from './job-lease';

export type PythonStatus =
  | 'SUCCESS'
  | 'MISSING_RUNTIME'
  | 'MISSING_SCRIPT'
  | 'LAUNCH_ERROR'
  | 'TIMEOUT'
  | 'NONZERO_EXIT';

export interface PythonExecutionOptions {
  scriptName: string; // Relative to stock-ai/src or stock-ai/scripts
  args?: string[];
  timeoutMs?: number;
  requiredArtifacts?: string[]; // Relative to stock-ai
  lockKey?: string;
}

export interface PythonExecutionResult {
  success: boolean;
  status: PythonStatus;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  error?: string;
  artifactsFresh?: boolean;
  artifactMetadata?: Record<string, { exists: boolean; mtimeMs?: number; isFresh?: boolean }>;
}

/**
 * Resolves the absolute path to the stock-ai directory.
 */
export function getStockAiDir(): string {
  return path.resolve(getAxionProjectRoot(), 'stock-ai');
}

/**
 * Resolves the appropriate Python executable path across environments.
 */
export function resolvePythonExecutable(): { path: string; exists: boolean } {
  // 1. Explicit environment variable override
  if (process.env.PYTHON_PATH) {
    const custom = path.resolve(process.env.PYTHON_PATH);
    return { path: custom, exists: fs.existsSync(custom) };
  }

  const stockAiDir = getStockAiDir();

  // 2. Windows virtual environment
  const winVenv = path.join(stockAiDir, 'venv', 'Scripts', 'python.exe');
  if (fs.existsSync(winVenv)) {
    return { path: winVenv, exists: true };
  }

  // 3. POSIX virtual environment
  const posixVenv = path.join(stockAiDir, 'venv', 'bin', 'python');
  if (fs.existsSync(posixVenv)) {
    return { path: posixVenv, exists: true };
  }

  // 4. System fallbacks
  const systemBinary = process.platform === 'win32' ? 'python.exe' : 'python3';
  return { path: systemBinary, exists: false }; // Not guaranteed to exist on path
}

/**
 * Resolves script path within stock-ai directory.
 */
export function resolveScriptPath(scriptName: string): { path: string; exists: boolean } {
  const stockAiDir = getStockAiDir();

  // Direct check
  let fullPath = path.isAbsolute(scriptName) ? scriptName : path.join(stockAiDir, scriptName);
  if (fs.existsSync(fullPath)) {
    return { path: fullPath, exists: true };
  }

  // Check in src/
  fullPath = path.join(stockAiDir, 'src', scriptName);
  if (fs.existsSync(fullPath)) {
    return { path: fullPath, exists: true };
  }

  // Check in scripts/
  fullPath = path.join(stockAiDir, 'scripts', scriptName);
  if (fs.existsSync(fullPath)) {
    return { path: fullPath, exists: true };
  }

  return { path: fullPath, exists: false };
}

/**
 * Executes an approved Python script safely without shell interpolation.
 */
export async function executePythonScript(
  options: PythonExecutionOptions
): Promise<PythonExecutionResult> {
  const startTime = Date.now();
  const timeoutMs = options.timeoutMs || 45000;
  const stockAiDir = getStockAiDir();
  let lease: JobLeaseHandle | null = null;

  // Concurrency Lock
  if (options.lockKey) {
    lease = await acquireJobLease(options.lockKey, timeoutMs);
    if (!lease) {
      return {
        success: false,
        status: 'LAUNCH_ERROR',
        exitCode: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
        error: `Another operation (${options.lockKey}) is currently executing. Please try again shortly.`,
      };
    }
  }

  try {
    // 0. Remote ML Service check (Split Cloud / Hugging Face Spaces / Modal / FastAPI)
    const remoteServiceUrl = process.env.STOCK_AI_SERVICE_URL?.replace(/\/+$/, '');
    if (remoteServiceUrl) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(`${remoteServiceUrl}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scriptName: options.scriptName,
            args: options.args || [],
            timeoutMs,
            requiredArtifacts: options.requiredArtifacts || [],
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.ok) {
          const remoteResult = (await res.json()) as PythonExecutionResult;
          return {
            ...remoteResult,
            durationMs: Date.now() - startTime,
          };
        } else {
          const errText = await res.text().catch(() => '');
          return {
            success: false,
            status: 'NONZERO_EXIT',
            exitCode: res.status,
            durationMs: Date.now() - startTime,
            stdout: '',
            stderr: errText,
            error: `Remote ML service returned HTTP ${res.status}: ${errText}`,
          };
        }
      } catch (remoteErr: any) {
        console.warn(`[PythonRunner] Remote ML service call failed: ${remoteErr.message}. Checking local runtime...`);
      }
    }

    // 1. Resolve Python runtime
    const pythonExe = resolvePythonExecutable();
    if (!pythonExe.exists) {
      return {
        success: false,
        status: 'MISSING_RUNTIME',
        exitCode: null,
        durationMs: Date.now() - startTime,
        stdout: '',
        stderr: '',
        error: `Python ML runtime not found locally. Set STOCK_AI_SERVICE_URL to connect to the external ML cloud service.`,
      };
    }

    // 2. Resolve Script
    const script = resolveScriptPath(options.scriptName);
    if (!script.exists) {
      return {
        success: false,
        status: 'MISSING_SCRIPT',
        exitCode: null,
        durationMs: Date.now() - startTime,
        stdout: '',
        stderr: '',
        error: `Target Python script not found: ${options.scriptName}.`,
      };
    }

    // 3. Snapshot existing artifact timestamps before execution
    const beforeMtimes = new Map<string, number>();
    if (options.requiredArtifacts) {
      for (const relPath of options.requiredArtifacts) {
        const artPath = path.join(stockAiDir, relPath);
        if (fs.existsSync(artPath)) {
          beforeMtimes.set(relPath, fs.statSync(artPath).mtimeMs);
        }
      }
    }

    // 4. Spawn process safely with argument arrays and bounded stdout/stderr
    const args = [script.path, ...(options.args || [])];
    const maxOutputBytes = 64 * 1024; // 64 KB cap

    return await new Promise<PythonExecutionResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      let proc: any;
      try {
        proc = spawn(pythonExe.path, args, {
          cwd: stockAiDir,
          shell: false, // Strict: no shell interpolation
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
          },
        });
      } catch (spawnErr: any) {
        return resolve({
          success: false,
          status: 'LAUNCH_ERROR',
          exitCode: null,
          durationMs: Date.now() - startTime,
          stdout: '',
          stderr: '',
          error: `Failed to launch Python process: ${spawnErr?.message || 'Spawn error'}`,
        });
      }

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          proc.kill('SIGTERM');
          // Force kill after 2s if still running
          setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch {}
          }, 2000);
        } catch {}
      }, timeoutMs);

      proc.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length < maxOutputBytes) {
          stdout += chunk.toString('utf-8');
        }
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < maxOutputBytes) {
          stderr += chunk.toString('utf-8');
        }
      });

      proc.on('error', (err: Error) => {
        clearTimeout(timer);
        resolve({
          success: false,
          status: 'LAUNCH_ERROR',
          exitCode: null,
          durationMs: Date.now() - startTime,
          stdout,
          stderr,
          error: `Process error during execution: ${err.message}`,
        });
      });

      proc.on('close', (code: number | null) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;

        if (timedOut) {
          return resolve({
            success: false,
            status: 'TIMEOUT',
            exitCode: code,
            durationMs,
            stdout,
            stderr,
            error: `Execution timed out after ${timeoutMs / 1000} seconds.`,
          });
        }

        if (code !== 0) {
          return resolve({
            success: false,
            status: 'NONZERO_EXIT',
            exitCode: code,
            durationMs,
            stdout,
            stderr,
            error: `Python process exited with error code ${code}. Diagnostics: ${stderr.slice(-500) || stdout.slice(-500)}`,
          });
        }

        // 5. Verify freshness of required artifacts
        let allFresh = true;
        const artifactMetadata: Record<string, { exists: boolean; mtimeMs?: number; isFresh?: boolean }> = {};

        if (options.requiredArtifacts) {
          for (const relPath of options.requiredArtifacts) {
            const artPath = path.join(stockAiDir, relPath);
            const exists = fs.existsSync(artPath);
            if (!exists) {
              allFresh = false;
              artifactMetadata[relPath] = { exists: false, isFresh: false };
            } else {
              const currentMtime = fs.statSync(artPath).mtimeMs;
              const prevMtime = beforeMtimes.get(relPath);
              // Fresh if created or modified after startTime
              const isFresh = prevMtime === undefined ? currentMtime >= startTime - 1000 : currentMtime > prevMtime;
              if (!isFresh) {
                allFresh = false;
              }
              artifactMetadata[relPath] = { exists: true, mtimeMs: currentMtime, isFresh };
            }
          }
        }

        resolve({
          success: true,
          status: 'SUCCESS',
          exitCode: 0,
          durationMs,
          stdout,
          stderr,
          artifactsFresh: options.requiredArtifacts ? allFresh : true,
          artifactMetadata,
        });
      });
    });
  } finally {
    if (options.lockKey) {
      if (lease) await releaseJobLease(lease);
    }
  }
}
