import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const env = { ...process.env };
if (process.platform === 'darwin' && args[0] === 'build') {
  // Ad-hoc signing binds privacy grants to a single binary hash. Installed
  // updates must use a certificate, even when they are only distributed locally.
  const identities = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
  const local = identities.match(/([A-Fa-f0-9]{40}) "Mosaic Local Development"/);
  env.APPLE_SIGNING_IDENTITY ||= local?.[1];
  if (!env.APPLE_SIGNING_IDENTITY || env.APPLE_SIGNING_IDENTITY === '-') {
    console.error('A stable signing certificate is required for installed Mosaic builds. Run npm run signing:setup once, or set APPLE_SIGNING_IDENTITY to an existing code-signing identity.');
    process.exit(1);
  }
}
const result = spawnSync(path.join(root, 'node_modules/.bin/tauri'), args, { cwd: root, env, stdio: 'inherit' });
if (result.error) throw result.error;
if (process.platform === 'darwin' && args[0] === 'build' && result.status === 0) {
  const builtApp = path.join(root, 'src-tauri/target/release/bundle/macos/mosaic.app');
  const installedApp = '/Applications/mosaic.app';
  const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
  if (fs.existsSync(builtApp) && fs.existsSync(installedApp)) {
    spawnSync('ditto', [builtApp, installedApp], { stdio: 'inherit' });
    spawnSync(lsregister, ['-u', builtApp], { stdio: 'ignore' });
    fs.rmSync(builtApp, { recursive: true, force: true });
    spawnSync(lsregister, ['-f', installedApp], { stdio: 'ignore' });
  }
}
process.exit(result.status ?? 1);
