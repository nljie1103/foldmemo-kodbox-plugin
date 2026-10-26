/* FoldMemo KodBox entry: only app assets are executable; user *.foldmemo is JSON. */
kodReady.push(function(){
 Events.bind('explorer.kodApp.before',function(appList){
  if(!window.kodApp||!kodApp.pathModel||typeof kodApp.pathModel.fileContent!=='function')return;
  appList.push({
   name:'foldMemo',title:'FoldMemo 编辑保险库',ext:'{{config.fileExt}}',
   sort:Number('{{config.fileSort}}')||1,icon:'x-item-icon x-txt',
   callback:function(filePath,ext,name){
    if(!/\.foldmemo$/i.test(name||filePath))return Tips.tips('仅支持 .foldmemo 文件','warning');
    if(/^https?:\/\//i.test(filePath))return Tips.tips('分享外链不能作为可写保险库','warning');
    if(typeof kodApp.pathModel.fileSave!=='function')return Tips.tips('KodBox 没有文件写入权限','warning');
    var uuid='foldmemo-'+(typeof md5==='function'?md5(filePath):Date.now());
    var existing=$.dialog.list[uuid];if(existing){existing.display(true).zIndex();return;}
    var dialog=core.openDialog('{{pluginHost}}static/app/index.html?kodbox=1','x-item-icon x-txt',name||'FoldMemo',uuid,{width:'92%',height:'90%',lock:false});
    if(!dialog||!dialog.$main)return;
    var iframe=dialog.$main.find('iframe').get(0);
    if(!iframe){dialog.close();return Tips.tips('FoldMemo 编辑窗口打开失败','warning');}
    var model=kodApp.pathModel,channel=null,baseline=null,writing=false,closed=false;
    var MAX=26*1024*1024,TIMEOUT=15000;
    function digest(s){return crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)).then(function(b){return Array.from(new Uint8Array(b),function(v){return v.toString(16).padStart(2,'0')}).join('')})}
    function read(){
     return new Promise(function(resolve,reject){
      var done=false, timer=setTimeout(function(){if(!done){done=true;reject(Error('KodBox 读取超时'))}},TIMEOUT);
      try{model.fileContent({path:filePath,pageNum:MAX},function(data){
       if(done)return;done=true;clearTimeout(timer);
       if(typeof data!=='string')reject(Error('服务器未返回有效文本或无读取权限'));
       else if(data.length>MAX)reject(Error('保险库数据超过大小限制'));
       else resolve(data);
      })}catch(e){if(!done){done=true;clearTimeout(timer);reject(e)}}
     })
    }
    function write(text){
     return new Promise(function(resolve,reject){
      var done=false,timer=setTimeout(function(){if(!done){done=true;reject(Error('KodBox 保存超时'))}},TIMEOUT);
      try{model.fileSave({path:filePath,content:text},function(result){
       if(done)return;done=true;clearTimeout(timer);
       if(result&&(result.code===false||result.code===0||result.code==='0'))reject(Error(result.msg||'KodBox 拒绝写入'));
       else resolve();
      })}catch(e){if(!done){done=true;clearTimeout(timer);reject(e)}}
     })
    }
    function send(type,requestId,data){if(!closed&&iframe.contentWindow)iframe.contentWindow.postMessage({kind:'foldmemo:host',channel:channel,type:type,requestId:requestId,data:data},location.origin)}
    async function onMessage(ev){
     if(closed||ev.source!==iframe.contentWindow||ev.origin!==location.origin)return;
     var m=ev.data;if(!m||m.kind!=='foldmemo:client'||typeof m.channel!=='string'||m.channel.length>100)return;
     if(m.type==='hello'&&!channel){
      channel=m.channel;
      try{var content=await read();baseline=await digest(content);send('init',m.requestId,{body:content,baseline:baseline,filename:name||'vault.foldmemo',fileId:String(typeof md5==='function'?md5(filePath):filePath),writable:true})}
      catch(e){send('error',m.requestId,{message:String(e.message||e)})}
      return;
     }
     if(m.channel!==channel)return;
     if(m.type!=='write')return;
     if(writing){send('error',m.requestId,{message:'正在保存，请稍后重试'});return}
     writing=true;
     try{
      if(!m.data||typeof m.data.body!=='string'||m.data.body.length>MAX||m.data.expected!==baseline)throw Error('内容过大或保存基线不同');
      var pkg=JSON.parse(m.data.body);
      if(!pkg||pkg.format!=='foldmemo-file-2'||pkg.encrypted!==true||typeof pkg.vaultId!=='string')throw Error('只能保存加密的 FoldMemo v2 保险库');
      var now=await read();
      if(await digest(now)!==baseline)throw Error('云端文件已由其他设备修改，已阻止覆盖；请先备份并重新打开');
      await write(m.data.body);
      var verified=await read(),next=await digest(m.data.body);
      if(await digest(verified)!==next)throw Error('KodBox 文件保存后读回校验失败');
      baseline=next;send('written',m.requestId,{baseline:next});
     }catch(e){send('error',m.requestId,{message:String(e.message||e)})}
     finally{writing=false}
    }
    window.addEventListener('message',onMessage);
    var priorClose=dialog.close;
    dialog.close=function(){closed=true;window.removeEventListener('message',onMessage);return priorClose.apply(this,arguments)}
   }
  })
 })
});
