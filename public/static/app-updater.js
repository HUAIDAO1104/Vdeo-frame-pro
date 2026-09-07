/* Signed Windows updates. This controller never interrupts the video queue. */
(function(root) {
  class AppUpdater {
    constructor({native,isBusy,persist,setLocked,onChange,channelFactory}) {
      Object.assign(this,{native,isBusy,persist,setLocked,onChange,channelFactory});
      this.state='unavailable';this.version='';this.update=null;this.error='';this.progress='';
    }
    get installing(){return this.state==='installing';}
    emit(){this.onChange(this);}
    async initialize(){
      if(!this.native.enabled)return;
      const status=await this.native.invoke('desktop_update_status');
      this.version=status.version;
      if(!status.supported)return;
      await this.check();
    }
    async check(){
      if(this.installing||this.state==='checking')return;
      this.state='checking';this.error='';this.emit();
      try{
        this.update=await this.native.invoke('check_desktop_update');
        this.state=this.update?'available':'current';
      }catch(error){this.state='error';this.error=String(error?.message||error);}
      this.emit();
    }
    async install(){
      if(!this.update||this.installing||this.state==='checking')return;
      if(this.isBusy()){this.error='请先停止视频处理并等待图片编辑完成，再安装更新。';this.emit();return;}
      this.state='installing';this.error='';this.progress='正在保存当前任务…';
      this.setLocked(true);this.emit();
      try{
        await this.persist();
        const channel=this.channelFactory(event=>{
          this.progress=event.phase==='install'?'签名已验证，正在启动安装程序…':
            '正在下载更新 · '+(event.total?Math.min(100,Math.round(event.downloaded/event.total*100))+'%':(event.downloaded/1048576).toFixed(1)+' MB');
          this.emit();
        });
        this.progress='正在连接下载服务…';this.emit();
        await this.native.invoke('install_desktop_update',{expectedVersion:this.update.version,onEvent:channel});
        // Windows normally exits inside the native install command.
        this.progress='安装程序已启动，请按提示完成更新。';
      }catch(error){this.state='available';this.error=String(error?.message||error);this.setLocked(false);}
      this.emit();
    }
  }
  root.AppUpdater=AppUpdater;
})(globalThis);

let desktopUpdater=null;
let appUpdateInstalling=false;
function initializeAppUpdater(){
  if(!DESKTOP_NATIVE.enabled)return;
  let dismissed='';
  const card=document.createElement('section');card.id='desktopUpdateCard';card.className='desktop-update-card';card.hidden=true;
  card.innerHTML='<div><strong>版本与更新</strong><span id="desktopCurrentVersion"></span></div><p id="desktopUpdateStatus"></p><button type="button" class="btn-sm" id="desktopUpdateCheck">检查更新</button><button type="button" class="btn-sm" id="desktopUpdateInstall" hidden>保存并安装</button>';
  document.getElementById('settingsLegacySlot').prepend(card);
  const banner=document.createElement('section');banner.className='desktop-update-banner';banner.hidden=true;banner.setAttribute('role','status');
  banner.innerHTML='<strong id="desktopUpdateHeading"></strong><p id="desktopUpdateMessage"></p><details id="desktopUpdateNotesWrap"><summary>本次更新</summary><p id="desktopUpdateNotes"></p></details><div><button type="button" id="desktopUpdateLater">稍后</button><button type="button" id="desktopUpdateNow">保存并安装</button></div>';
  document.body.appendChild(banner);
  const text=(id,value)=>{document.getElementById(id).textContent=value;};
  const render=u=>{
    card.hidden=u.state==='unavailable';
    text('desktopCurrentVersion','v'+u.version);
    const description=u.installing?u.progress:u.error||({checking:'正在检查更新…',current:'当前已是最新版本',available:'发现新版本 v'+u.update?.version,error:'暂时无法检查更新'}[u.state]||'');
    text('desktopUpdateStatus',description);
    document.getElementById('desktopUpdateCheck').disabled=u.installing||u.state==='checking';
    document.getElementById('desktopUpdateInstall').hidden=!u.update||u.installing;
    banner.hidden=!(u.installing||(u.update&&dismissed!==u.update.version));
    text('desktopUpdateHeading',u.installing?'正在更新帧选':'帧选 v'+u.update?.version+' 已可更新');
    text('desktopUpdateMessage',u.installing?u.progress:u.error||'安装前会保存任务，随后应用将关闭并自动重新打开。');
    text('desktopUpdateNotes',u.update?.notes||'');
    document.getElementById('desktopUpdateNotesWrap').hidden=!u.update?.notes||u.installing;
    document.getElementById('desktopUpdateNow').disabled=u.installing;
    document.getElementById('desktopUpdateLater').disabled=u.installing;
  };
  desktopUpdater=new AppUpdater({native:DESKTOP_NATIVE,
    isBusy:()=>!!taskQueue?.active||generationStarting||S.batches.some(b=>b.rendering),
    persist:async()=>{flushUserDefaultsAutoSave();await saveWorkspaceNow();if(S.dirty)throw new Error('任务保存失败，已取消更新。请先保存后重试。');},
    setLocked:locked=>{
      appUpdateInstalling=locked;
      document.querySelector('.wrap').inert=locked;
      if(locked){closePreviewModal();closeFramePicker();closeSettingsDrawer();}
    },
    channelFactory:handler=>{const channel=new window.__TAURI__.core.Channel();channel.onmessage=handler;return channel;},
    onChange:render
  });
  const install=()=>{dismissed='';desktopUpdater.install();};
  document.getElementById('desktopUpdateCheck').onclick=()=>{dismissed='';desktopUpdater.check();};
  document.getElementById('desktopUpdateInstall').onclick=install;
  document.getElementById('desktopUpdateNow').onclick=install;
  document.getElementById('desktopUpdateLater').onclick=()=>{dismissed=desktopUpdater.update?.version;render(desktopUpdater);};
  desktopUpdater.initialize().catch(console.warn);
  setInterval(()=>{if(desktopUpdater.state!=='unavailable')desktopUpdater.check();},6*60*60*1000);
}
