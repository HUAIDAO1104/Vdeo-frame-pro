import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/static/ai-transport.js';
const url='https://llm-api.mcisaas.com/v1/chat/completions';
test('desktop AI requests preserve HTTP errors and use native transport without browser fetch',async()=>{
  const calls=[],native={enabled:true,invoke:async(command,args)=>{calls.push({command,args});return {status:401,body:'{"error":{"message":"expired"}}'};}};
  const response=await AITransport.request(url,{method:'POST',headers:{Authorization:'Bearer test-key'},body:'{"model":"test"}'},1000,'评分',native);
  assert.equal(response.status,401);assert.equal(calls[0].command,'ai_http_request');
  assert.equal(calls[0].args.request.operation,'chat');assert.equal(calls[0].args.request.apiKey,'test-key');
  assert.match(AITransport.httpError(response.status,await response.text()).message,/API Key.*401/);
});
test('pause or stop aborts native AI work promptly and does not wait for the provider',async()=>{
  const calls=[],controller=new AbortController();
  const native={enabled:true,invoke:(command,args)=>{calls.push({command,args});return command==='ai_http_request'?new Promise(()=>{}):Promise.resolve();}};
  const pending=AITransport.request(url,{signal:controller.signal},1000,'评分',native);
  await Promise.resolve();controller.abort('pause');
  await assert.rejects(pending,{name:'AbortError'});
  assert.equal(calls[1].command,'cancel_ai_http_request');assert.equal(calls[0].args.request.requestId,calls[1].args.requestId);
});
test('timeout cancels native request and produces an actionable error',async()=>{
  const calls=[],native={enabled:true,invoke:command=>{calls.push(command);return command==='ai_http_request'?new Promise(()=>{}):Promise.resolve();}};
  await assert.rejects(AITransport.request(url,{},20,'评分',native),/未完成.*网络/);
  assert.deepEqual(calls,['ai_http_request','cancel_ai_http_request']);
});
test('already aborted requests never contact AI and unknown native endpoints are rejected',async()=>{
  const controller=new AbortController();controller.abort();let count=0;
  const native={enabled:true,invoke:()=>{count++;return Promise.resolve();}};
  await assert.rejects(AITransport.request(url,{signal:controller.signal},1000,'评分',native),{name:'AbortError'});
  await assert.rejects(AITransport.request('https://other.invalid',{},1000,'评分',native),/接口地址/);assert.equal(count,0);
});
test('native failure strings become Error messages and credentials are redacted from HTTP details',async()=>{
  await assert.rejects(AITransport.request(url,{},1000,'评分',{enabled:true,invoke:()=>Promise.reject('无法连接 AI 服务')}),/无法连接/);
  assert.doesNotMatch(AITransport.httpError(403,'{"message":"secret-key denied"}','secret-key').message,/secret-key/);
});
test('web transport explains generic network failures instead of displaying Failed to fetch',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>{throw new TypeError('Failed to fetch');};
  try{await assert.rejects(AITransport.request(url,{},1000,'评分'),/连接失败.*网络.*本地选图/);}finally{globalThis.fetch=original;}
});
