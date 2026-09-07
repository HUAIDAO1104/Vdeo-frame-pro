import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';

// Pass explicit filenames; Windows shells do not expand tests/*.test.mjs.
const root=resolve(import.meta.dirname,'..');
const files=readdirSync(join(root,'tests')).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>join(root,'tests',name));
if(!files.length)throw new Error('No unit tests found');
const result=spawnSync(process.execPath,['--test',...files],{cwd:root,stdio:'inherit'});
if(result.error)throw result.error;
process.exit(result.status??1);
