// Explicit one-time setup, never run by the build hook or the application.
// The key lives in the login keychain with access limited to codesign. Trust
// applies only to the user's code-signing policy, not TLS or system-wide trust.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

if (process.platform !== 'darwin') throw new Error('Local macOS signing setup requires macOS.');
const run = (cmd, args) => {
  try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { throw new Error(`${cmd} failed: ${String(error.stderr ?? '').trim()}`); }
};
const name = 'Mosaic Local Development';
const store = path.join(homedir(), 'Library/Application Support/com.itwelaibomu.mosaic/signing');
const certificate = path.join(store, 'local-signing.crt');
const validIdentity = () => run('security', ['find-identity', '-v', '-p', 'codesigning']).match(/([A-Fa-f0-9]{40}) "Mosaic Local Development"/);
if (validIdentity()) { console.log('Mosaic local signing identity is already ready.'); process.exit(0); }

const existing = run('security', ['find-identity', '-p', 'codesigning']).includes(`"${name}"`);
if (!existing) {
  // Refuse to silently replace the certificate that future privacy grants use.
  if (existsSync(certificate)) throw new Error('A previous Mosaic certificate exists, but its keychain identity is missing. Restore that identity instead of replacing it.');
  const dir = mkdtempSync(path.join(tmpdir(), 'mosaic-signing-'));
  try {
    const key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem'), p12 = path.join(dir, 'identity.p12');
    const config = path.join(dir, 'openssl.cnf');
    writeFileSync(config, `[req]\ndistinguished_name=subject\nx509_extensions=extensions\nprompt=no\n[subject]\nCN=${name}\n[extensions]\nbasicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,codeSigning\n`, { mode: 0o600 });
    run('/usr/bin/openssl', ['req', '-new', '-x509', '-newkey', 'rsa:3072', '-nodes', '-days', '3650', '-config', config, '-keyout', key, '-out', cert]);
    const password = randomBytes(32).toString('hex');
    run('/usr/bin/openssl', ['pkcs12', '-export', '-inkey', key, '-in', cert, '-name', name, '-out', p12, '-passout', `pass:${password}`]);
    run('security', ['import', p12, '-k', path.join(homedir(), 'Library/Keychains/login.keychain-db'), '-P', password, '-T', '/usr/bin/codesign']);
    mkdirSync(store, { recursive: true, mode: 0o700 });
    copyFileSync(cert, certificate);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
if (!existsSync(certificate)) throw new Error('Existing Mosaic identity has no saved public certificate. Resolve it in Keychain Access before continuing.');
run('security', ['add-trusted-cert', '-r', 'trustRoot', '-p', 'codeSign', certificate]);
if (!validIdentity()) throw new Error('Code-signing identity could not be verified in the login keychain.');
console.log('Mosaic local signing identity is ready. Future npm run tauri build commands will reuse it.');
