import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';

// Resolve the existing local data scripts together, then publish one atomic snapshot.
const context = vm.createContext({ window: {} });
for (const name of ['workstreams-data.js', 'my-clients.js']) {
  const source = await readFile(new URL(`../public/fieldnotes/${name}`, import.meta.url), 'utf8');
  vm.runInContext(source, context, { filename: name, timeout: 5000 });
}
const clients = context.window.FIELDNOTES_BASE_CLIENTS;
if (!Array.isArray(clients)) throw new Error('Missing FIELDNOTES_BASE_CLIENTS array');
// Materialize stream references so the running app needs no executable data files.
for (const client of clients) {
  for (const collection of client.collections || []) {
    if (collection.streamSource) {
      const streams = context.window[collection.streamSource];
      if (!Array.isArray(streams)) throw new Error(`Missing ${collection.streamSource}`);
      collection.streams = streams;
      delete collection.streamSource;
    }
    if (collection.itemSource) {
      const items = context.window[collection.itemSource];
      if (!Array.isArray(items)) throw new Error(`Missing ${collection.itemSource}`);
      collection.items = items;
      delete collection.itemSource;
    }
  }
}
const dataRoot = process.platform === 'darwin'
  ? join(homedir(), 'Library', 'Application Support')
  : process.platform === 'win32'
    ? (process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'))
    : (process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'));
const destination = process.argv[2] || join(dataRoot, 'com.cavemancreative.fieldnotes', 'clients.json');
await mkdir(join(destination, '..'), { recursive: true });
const temporary = `${destination}.${process.pid}.tmp`;
await writeFile(temporary, JSON.stringify(clients, null, 2) + '\n');
await rename(temporary, destination);
console.log(`Updated ${clients.length} clients: ${destination}`);
