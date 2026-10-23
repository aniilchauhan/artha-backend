import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const envFile = path.resolve('.env.local');
const credentialsFile = path.resolve('.axion-personal-access.txt');
if (process.env.AXION_PERSONAL_PASSWORD_HASH && !process.argv.includes('--rotate')) {
  console.log('Personal access already configured. Use --rotate to replace the password.');
  process.exit(0);
}
const email = (process.env.AXION_PERSONAL_EMAIL || 'admin@axion.local').trim().toLowerCase();
const passwordArgIdx = process.argv.findIndex((arg) => arg === '--password' || arg.startsWith('--password='));
let customPassword = null;
if (passwordArgIdx !== -1) {
  const arg = process.argv[passwordArgIdx];
  if (arg.startsWith('--password=')) {
    customPassword = arg.slice('--password='.length);
  } else if (process.argv[passwordArgIdx + 1]) {
    customPassword = process.argv[passwordArgIdx + 1];
  }
}
const password = customPassword || crypto.randomBytes(24).toString('base64url');
const passwordHash = await bcrypt.hash(password, 12);
let content = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
const settings = {
  AXION_PERSONAL_MODE: 'true', AXION_PERSONAL_EMAIL: email,
  AXION_PERSONAL_PASSWORD_HASH: passwordHash,
  // Rotating the session secret also signs out any legacy demo-admin sessions.
  NEXTAUTH_SECRET: crypto.randomBytes(48).toString('base64url'),
};
for (const [name, value] of Object.entries(settings)) {
  const line = `${name}="${value.replaceAll('$', '\\$')}"`;
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  content = pattern.test(content) ? content.replace(pattern, () => line) : `${content.trimEnd()}\n${line}\n`;
}
fs.writeFileSync(envFile, content, { mode: 0o600 });
fs.writeFileSync(credentialsFile, `Axion personal workspace\n\nEmail: ${email}\nPassword: ${password}\n\nRestart the app after setup. Save this password in your password manager, then delete this file.\nTo rotate access: npm run account:setup -- --rotate\n`, { mode: 0o600 });
console.log(`Personal access configured. Credentials saved to ${credentialsFile}. Restart the app to apply.`);
