/* AI HTTP transport: desktop requests use the native network stack. */
(function(root){
  const BASE='https://llm-api.mcisaas.com/v1/';
  function aborted(){return new DOMException('请求已取消','AbortError');}
  function nativeFetch(native,url,options,signal,timeoutMs){
    const operation=url===BASE+'models'?'models':url===BASE+'chat/completions'?'chat':null;
    if(!operation)throw new Error('不支持的 AI 接口地址');
    if(signal.aborted)return Promise.reject(aborted());
    const requestId='ai-'+crypto.randomUUID();
    const headers=new Headers(options.headers);
    return new Promise((resolve,reject)=>{
      const cancel=()=>{native.invoke('cancel_ai_http_request',{requestId}).catch(()=>{});reject(aborted());};
      signal.addEventListener('abort',cancel,{once:true});
      Promise.resolve().then(()=>native.invoke('ai_http_request',{request:{requestId,operation,
        apiKey:(headers.get('Authorization')||'').replace(/^Bearer\s+/i,''),
        body:options.body||null,timeoutMs}})).then(result=>
          new Response([204,205,304].includes(result.status)?null:result.body,{status:result.status,headers:{'Content-Type':'application/json'}})
        ).then(resolve,error=>reject(error instanceof Error?error:new Error(String(error))))
        .finally(()=>signal.removeEventListener('abort',cancel));
    });
  }
  async function request(url,options={},timeoutMs=75000,label='AI 请求',native={enabled:false}){
    const controller=new AbortController(),parent=options.signal;
    let timedOut=false;
    const cancel=()=>controller.abort();
    if(parent?.aborted)cancel();else parent?.addEventListener('abort',cancel,{once:true});
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
    try{
      if(controller.signal.aborted)throw aborted();
      if(native.enabled)return await nativeFetch(native,url,options,controller.signal,timeoutMs);
      const response=await fetch(url,{...options,signal:controller.signal});
      const body=await response.arrayBuffer(),headers=new Headers(response.headers);
      headers.delete('content-encoding');headers.delete('content-length');
      return new Response([204,205,304].includes(response.status)?null:body,{status:response.status,statusText:response.statusText,headers});
    }catch(error){
      if(timedOut)throw new Error(label+'超过 '+Math.ceil(timeoutMs/1000)+' 秒未完成，请检查网络、代理或模型服务后重试');
      if(parent?.aborted||error?.name==='AbortError')throw aborted();
      if(/Failed to fetch|NetworkError|Load failed/i.test(error?.message||String(error)))
        throw new Error(label+'连接失败，未收到接口响应。请检查网络、代理和接口服务；也可切换本地选图继续制作');
      throw error;
    }finally{clearTimeout(timer);parent?.removeEventListener('abort',cancel);}
  }
  function httpError(status,body,key=''){
    const hint=status===401?'API Key 无效或已过期，请检查密钥':status===403?'接口拒绝访问，请检查账号权限或额度':
      status===429?'接口限流或额度不足，请稍后重试或检查账号':status===413?'图片请求过大':
      status>=500?'模型服务暂时不可用，请稍后重试':status===400?'模型或请求参数不被支持，请确认所选模型支持图片':'接口请求失败';
    let detail='';try{const data=JSON.parse(body);detail=String(data.error?.message||data.message||'');}catch{}
    if(key)detail=detail.split(key).join('[已隐藏]');
    return new Error(hint+'（HTTP '+status+'）'+(detail?'：'+detail.slice(0,160):''));
  }
  root.AITransport={request,httpError};
})(globalThis);
