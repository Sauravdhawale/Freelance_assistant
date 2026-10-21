import {zipFunctions} from '@netlify/zip-it-and-ship-it';
import {mkdir,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('.netlify/checked-functions',{recursive:true});
const functions=await zipFunctions('netlify/functions','.netlify/checked-functions',{
  basePath:process.cwd(),repositoryRoot:process.cwd(),manifest:'.netlify/checked-functions/manifest.json',
  config:{'*':{nodeBundler:'esbuild',nodeVersion:'24'}}
});
assert.deepEqual(functions.map(f=>f.name).sort(),['api','workflow-worker']);
const manifest=JSON.parse(await readFile('.netlify/checked-functions/manifest.json','utf8'));
const worker=manifest.functions.find(f=>f.name==='workflow-worker');
assert.equal(worker.invocationMode,'background','Worker must retain Netlify background execution.');
console.log('Netlify API and background worker packaged successfully.');
console.log(JSON.stringify(manifest.functions.map(f=>({name:f.name,runtime:f.runtime,invocationMode:f.invocationMode,routes:f.routes})),null,2));
