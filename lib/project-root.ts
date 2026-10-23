import fs from 'node:fs';
import path from 'node:path';

/** Resolve Axion's data directory when the host application has a different cwd. */
export function getAxionProjectRoot(): string {
  if (process.env.AXION_PROJECT_ROOT) return path.resolve(process.env.AXION_PROJECT_ROOT);
  const cwd = process.cwd();
  const candidates = [cwd, path.resolve(cwd, '../../axion'), path.resolve(cwd, '../axion')];
  // Check a file marker, not a data directory: Next's dependency tracer can
  // recursively include every research artifact when existsSync targets a folder.
  return candidates.find(candidate => fs.existsSync(path.join(candidate, 'packages/core/index.mjs'))) ?? cwd;
}
