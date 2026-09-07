import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/static/app-updater.js';

const available={version:'0.3.0',currentVersion:'0.2.0',notes:'Improvements'};
function setup(overrides={}){
  const calls=[],locks=[];
  const u=new AppUpdater({
    native:{enabled:true,invoke:async(command,args)=>{
      calls.push(command);
      if(command==='desktop_update_status')return {supported:true,version:'0.2.0'};
      if(command==='check_desktop_update')return available;
      if(command==='install_desktop_update'){assert.equal(args.expectedVersion,'0.3.0');args.onEvent({phase:'download',downloaded:25,total:100});}
    }},isBusy:()=>false,persist:async()=>{calls.push('persist');},setLocked:lock=>locks.push(lock),onChange:()=>{},channelFactory:cb=>cb,...overrides
  });return {u,calls,locks};
}
test('Windows checks on startup and reports the available version',async()=>{
  const {u,calls}=setup();await u.initialize();assert.equal(u.state,'available');assert.equal(u.version,'0.2.0');assert.equal(u.update.version,'0.3.0');assert.deepEqual(calls,['desktop_update_status','check_desktop_update']);
});
test('web and unsupported platforms do not contact the update feed',async()=>{
  const {u,calls}=setup({native:{enabled:false}});await u.initialize();assert.deepEqual(calls,[]);
  const second=setup({native:{enabled:true,invoke:async()=>({supported:false,version:'0.2.0'})}});await second.u.initialize();assert.equal(second.u.state,'unavailable');
});
test('running or paused video work blocks installation',async()=>{
  const {u,calls,locks}=setup({isBusy:()=>true});await u.initialize();await u.install();assert.match(u.error,/先停止/);assert.ok(!calls.includes('persist'));assert.deepEqual(locks,[]);
});
test('installation locks the workspace and saves before native update',async()=>{
  const {u,calls,locks}=setup();await u.initialize();await u.install();assert.deepEqual(calls.slice(-2),['persist','install_desktop_update']);assert.deepEqual(locks,[true]);assert.equal(u.installing,true);
});
test('save failure prevents installation and unlocks the workspace',async()=>{
  const {u,calls,locks}=setup({persist:async()=>{throw new Error('保存失败');}});await u.initialize();await u.install();assert.ok(!calls.includes('install_desktop_update'));assert.deepEqual(locks,[true,false]);assert.equal(u.state,'available');assert.match(u.error,/保存失败/);
});
test('download or signature failure keeps the offered update retryable',async()=>{
  const {u,locks}=setup();await u.initialize();u.native.invoke=async()=>{throw new Error('签名校验失败');};await u.install();assert.equal(u.state,'available');assert.deepEqual(locks,[true,false]);assert.match(u.error,/签名/);
});
test('duplicate install and check cannot overlap an installation',async()=>{
  let finish;const gate=new Promise(resolve=>{finish=resolve;});
  const {u,calls}=setup({persist:()=>gate});await u.initialize();const first=u.install();await u.install();await u.check();finish();await first;assert.equal(calls.filter(c=>c==='install_desktop_update').length,1);assert.equal(calls.filter(c=>c==='check_desktop_update').length,1);
});
