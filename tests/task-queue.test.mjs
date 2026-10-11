import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/static/task-queue.js';
const Queue=globalThis.VideoTaskQueue;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
const task=id=>({id,generationStatus:'pending'});
const abortable=signal=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));

test('publishes each result before the next task completes',async()=>{
  const gate=deferred(), started=deferred(), a=task(1),b=task(2),published=[];
  const queue=new Queue({process:async p=>{if(p===b){started.resolve();await gate.promise;}return {value:p.id};},onComplete:p=>published.push(p.id)});
  const run=queue.start([a,b]);await started.promise;
  assert.equal(a.value,1);assert.equal(a.generationStatus,'complete');assert.equal(queue.active,true);assert.deepEqual(published,[1]);
  gate.resolve();await run;assert.deepEqual(published,[1,2]);
});
test('pause aborts the current operation and resumes that step exactly once',async()=>{
  const started=deferred(),p=task(1);let calls=0,prior=0;
  const queue=new Queue({process:async(p,ctx)=>{
    await ctx.step('first',async()=>prior++);
    return {value:await ctx.step('network',async signal=>{calls++;if(calls===1){started.resolve();return abortable(signal);}return 42;})};
  }});
  const run=queue.start([p]);await started.promise;queue.pause();await tick();
  assert.equal(p.generationStatus,'paused');assert.equal(calls,1);assert.equal(p.value,undefined);
  queue.resume();await run;assert.equal(prior,1);assert.equal(calls,2);assert.equal(p.value,42);
});
test('stop while paused settles without starting the next task and can restart',async()=>{
  const started=deferred(),a=task(1),b=task(2);let calls=0;
  const queue=new Queue({process:async(p,ctx)=>{calls++;return ctx.step('work',signal=>{started.resolve();return abortable(signal);});}});
  queue.start([a,b]);await started.promise;queue.pause();await tick();await queue.stop();
  assert.equal(a.generationStatus,'stopped');assert.equal(b.generationStatus,'stopped');assert.equal(calls,1);assert.equal(queue.active,false);
  queue.process=async()=>({value:2});await queue.start([a,b]);assert.equal(b.value,2);
});
test('deleting the current task cancels it and continues the remaining queue',async()=>{
  const started=deferred(),a=task(1),b=task(2),published=[];
  const queue=new Queue({process:async(p,ctx)=>p===a?ctx.step('extract',signal=>{started.resolve();return abortable(signal);}):{value:2},onComplete:p=>published.push(p.id)});
  const run=queue.start([a,b]);await started.promise;await queue.remove(a);await run;
  assert.equal(a.value,undefined);assert.equal(a.deleted,true);assert.deepEqual(published,[2]);
});
test('deleting a paused task does not resume the rest of the queue',async()=>{
  const started=deferred(),a=task(1),b=task(2);let bCalls=0;
  const queue=new Queue({process:async(p,ctx)=>p===a?ctx.step('extract',signal=>{started.resolve();return abortable(signal);}):(++bCalls,{value:2})});
  const run=queue.start([a,b]);await started.promise;queue.pause();await queue.remove(a);await tick();
  assert.equal(bCalls,0);assert.equal(queue.state,'paused');queue.resume();await run;assert.equal(bCalls,1);
});
test('deleting a pending task skips it without interrupting the active task',async()=>{
  const gate=deferred(),started=deferred(),a=task(1),b=task(2),calls=[];
  const queue=new Queue({process:async p=>{calls.push(p.id);started.resolve();await gate.promise;return {};}});
  const run=queue.start([a,b]);await started.promise;await queue.remove(b);gate.resolve();await run;assert.deepEqual(calls,[1]);
});
test('late completion after stop cannot replace existing results',async()=>{
  const gate=deferred(),started=deferred(),p={...task(1),batches:['old']};
  const queue=new Queue({process:async(p,ctx)=>ctx.step('slow non-abortable',async()=>{started.resolve();await gate.promise;return {batches:['new']};})});
  const run=queue.start([p]);await started.promise;const stopping=queue.stop();
  assert.equal(queue.active,true);gate.resolve();await stopping;await run;assert.deepEqual(p.batches,['old']);
});
test('a failed video keeps prior output and does not block the next video',async()=>{
  const a={...task(1),batches:['old']},b=task(2);
  const queue=new Queue({process:async(p,ctx)=>{if(p===a)return ctx.step('decode',async()=>{throw Error('bad codec');});return {batches:['new']};}});
  await queue.start([a,b]);assert.equal(a.generationStatus,'failed');assert.equal(a.generationError.stage,'decode');assert.deepEqual(a.batches,['old']);assert.equal(b.generationStatus,'complete');
});
test('rapid pause and resume still retries an interrupted step',async()=>{
  const started=deferred(),p=task(1);let calls=0;
  const queue=new Queue({process:async(p,ctx)=>ctx.step('request',async signal=>{if(++calls===1){started.resolve();return abortable(signal);}return {ok:true};})});
  const run=queue.start([p]);await started.promise;queue.pause();queue.resume();await run;assert.equal(p.ok,true);assert.equal(calls,2);
});
test('a second start cannot run another queue concurrently',async()=>{
  const gate=deferred(),started=deferred(),a=task(1),b=task(2);let count=0;
  const queue=new Queue({process:async()=>{count++;started.resolve();await gate.promise;return {};}});
  const first=queue.start([a]);await started.promise;assert.equal(queue.start([b]),first);gate.resolve();await first;assert.equal(count,1);assert.equal(b.generationStatus,'pending');
});
test('operation deadline fails the task with a stage-specific error',async()=>{
  const p=task(1),queue=new Queue({process:async(p,ctx)=>ctx.step('AI 选图',abortable,10)});
  await queue.start([p]);assert.equal(p.generationStatus,'failed');assert.match(p.generationError.message,/AI 选图超时/);
});

test('failed tasks can be retried together or appended while another retry is running without duplicates',async()=>{
  const a=task(1),b=task(2),c=task(3),calls=[];
  const queue=new Queue({process:async p=>{calls.push(p.id);if(p!==c)throw Error('provider unavailable');return {value:'keep'};}});
  await queue.start([a,b,c]);
  const gate=deferred(),started=deferred();
  queue.process=async p=>{calls.push(p.id);if(p===a){started.resolve();await gate.promise;}return {value:'retried'};};
  const retry=queue.enqueue([a]);await started.promise;
  assert.equal(queue.enqueue([a,b,b]),retry);
  assert.deepEqual(queue.pending.map(p=>p.id),[2]);
  gate.resolve();await retry;
  assert.deepEqual(calls,[1,2,3,1,2]);assert.equal(c.value,'keep');
  assert.ok([a,b,c].every(p=>p.generationStatus==='complete'));
  queue.process=async()=>{throw Error('failed again');};await queue.enqueue([a,b]);
  queue.process=async()=>({value:'recovered'});await queue.enqueue([a,b].filter(p=>p.generationStatus==='failed'));
  assert.equal(a.value,'recovered');assert.equal(b.value,'recovered');
});

test('live batch, task and stage clocks exclude pauses and accumulate across attempts',async()=>{
  let now=0,calls=0;
  const started=deferred(),p=task(1);
  const queue=new Queue({now:()=>now,process:async(p,ctx)=>ctx.step('AI scoring',async signal=>{
    if(++calls===1){started.resolve();return abortable(signal);}now+=1000;ctx.progress(70,'AI scoring 8 / 16');return {};
  },20000)});
  const run=queue.start([p]);await started.promise;now=5000;
  assert.equal(queue.elapsed(p),5000);assert.equal(queue.stageElapsed(),5000);
  queue.pause();await tick();now+=60000;
  assert.equal(queue.elapsed(p),5000);assert.equal(queue.batchElapsed(),5000);assert.equal(queue.stageElapsed(),5000);
  queue.resume();await run;
  assert.equal(p.generationTiming.elapsedMs,6000);assert.equal(p.generationTiming.lastAttemptMs,6000);
  assert.equal(queue.batchElapsed(),6000);assert.equal(p.generationTiming.lastStageMs,1000);
  now+=90000;queue.process=async()=>{now+=2000;return {};};await queue.start([p]);
  assert.equal(queue.elapsed(p),8000);assert.equal(queue.batchElapsed(),2000);
  assert.equal(p.generationTiming.lastAttemptMs,2000);assert.equal(p.generationTiming.attempts,2);
});

test('stopping an active queue preserves completed tasks and restarting all unfinished tasks is repeatable',async()=>{
  const a=task(1),b=task(2),c=task(3),started=deferred(),calls=[];
  const queue=new Queue({process:async(p,ctx)=>{calls.push(p.id);if(p===b)return ctx.step('work',signal=>{started.resolve();return abortable(signal);});return {value:p.id};}});
  queue.start([a,b,c]);await started.promise;await queue.stop();
  assert.equal(a.generationStatus,'complete');assert.equal(b.generationStatus,'stopped');assert.equal(c.generationStatus,'stopped');
  queue.process=async p=>{calls.push(p.id);return {value:p.id};};
  await queue.enqueue([a,b,c].filter(p=>p.generationStatus!=='complete'));
  assert.deepEqual(calls,[1,2,2,3]);assert.ok([a,b,c].every(p=>p.generationStatus==='complete'));
});
