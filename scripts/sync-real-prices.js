const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Keep the legacy command, but refresh the entire catalog through the validated pipeline.
const result = spawnSync(process.execPath, ['--import', 'tsx', path.join(__dirname, 'audit-stock-prices.ts'), '--refresh-snapshots'], {
  cwd: path.resolve(__dirname, '..'), stdio: 'inherit', windowsHide: true,
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
