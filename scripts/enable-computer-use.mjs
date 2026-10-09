/** Enable native macOS Computer Use using the repository's existing controller .env.
 * Read/update only the dedicated COMPUTER_USE_* keys, never print tokens. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const envPath = path.resolve(process.cwd(), '.env');
let input = await fs.readFile(envPath, 'utf8');
const fallbackOrigins = [
  'https://admin.microsoft.com',
  'https://admin.cloud.microsoft',
  'https://dash.cloudflare.com',
  'https://dcc.godaddy.com',
  'https://account.godaddy.com'
].join(',');
function setIfMissing(name, value) {
  const re = new RegExp('^' + name + '=', 'm');
  if (!re.test(input)) input += (input.endsWith('\n') ? '' : '\n') + name + '=' + value + '\n';
}
function setValue(name, value) {
  const re = new RegExp('^' + name + '=.*$', 'm');
  if (re.test(input)) input = input.replace(re, name + '=' + value);
  else input += (input.endsWith('\n') ? '' : '\n') + name + '=' + value + '\n';
}
setValue('COMPUTER_USE_ENABLED', 'true');
setIfMissing('COMPUTER_USE_BRIDGE_TOKEN', crypto.randomBytes(48).toString('hex'));
setIfMissing('COMPUTER_USE_BRIDGE_URL', 'http://host.docker.internal:9764');
setIfMissing('COMPUTER_USE_ALLOWED_ORIGINS', fallbackOrigins);
const tempPath = envPath + '.computer-use-' + process.pid + '.tmp';
await fs.writeFile(tempPath, input, {mode:0o600, flag:'wx'});
await fs.rename(tempPath, envPath);
await fs.chmod(envPath,0o600);
console.log('Computer Use enabled in .env. Bridge token was not printed.');
