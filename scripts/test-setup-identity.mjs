import ts from 'typescript';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const source = ts.transpileModule(fs.readFileSync(new URL('../src/lib/setupIdentity.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const { hasCurrentSetup } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const signed = 'identifier com.itwelaibomu.mosaic and certificate leaf = persistent-certificate';
const receipt = JSON.stringify({ identity: signed, disposition: 'completed' });
assert.equal(hasCurrentSetup(signed, null), false, 'legacy dismissal must send the new signed identity through setup');
assert.equal(hasCurrentSetup(signed, '1'), false, 'legacy flag is not a grant');
assert.equal(hasCurrentSetup(signed, '{bad json'), false, 'broken receipt must not start terminals');
assert.equal(hasCurrentSetup(signed, receipt), true, 'next launch and signed updates keep the same setup receipt');
assert.equal(hasCurrentSetup('different certificate', receipt), false, 'changed identity requires setup again');
assert.equal(hasCurrentSetup(signed, JSON.stringify({ identity: signed })), false, 'an unfinished receipt must not start terminals');
assert.equal(hasCurrentSetup(signed, JSON.stringify({ identity: signed, disposition: 'skipped' })), true, 'explicit skip is remembered only for that identity');
assert.equal(hasCurrentSetup('', receipt), false, 'missing identity must not pass the startup gate');
console.log('8 setup identity migration checks passed.');
