/* FoldMemo KodBox trusted file opener. v0.1.3 */
kodReady.push(function(){
 Events.bind('explorer.kodApp.before',function(appList){
  if(!window.kodApp||!kodApp.pathModel||typeof kodApp.pathModel.fileContent!=='function')return;
  appList.push({
   name:'foldMemo',title:'FoldMemo 编辑保险库',ext:'{{config.fileExt}}',
   sort:Number('{{config.fileSort}}')||1,icon:'x-item-icon x-txt',
   callback:function(filePath,ext,name){
    if(!/\.foldmemo$/i.test(name||filePath))return Tips.tips('仅支持 .foldmemo 文件','warning');
    if(/^https?:\/\//i.test(filePath))return Tips.tips('分享外链不能作为可写保险库','warning');
    var uuid='foldmemo-'+(typeof md5==='function'?md5(filePath):Date.now());
    var existing=$.dialog.list[uuid];if(existing){existing.display(true).zIndex();return;}
    var dialog=core.openDialog('{{pluginHost}}static/app/index.html?kodbox=1&v={{package.version}}','x-item-icon x-txt',name||'FoldMemo',uuid,{width:'92%',height:'90%',lock:false});
    if(!dialog||!dialog.$main)return;
    var iframe=dialog.$main.find('iframe').get(0);
    if(!iframe){dialog.close();return Tips.tips('FoldMemo 编辑窗口打开失败','warning');}
    var model=kodApp.pathModel,channel=null,baseline=null,writing=false,closed=false,dirty=false,closeRequestId=null,closeApproved=false;
    var MAX=26*1024*1024,TIMEOUT=24000;
    function digest(s){return crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)).then(function(b){return Array.from(new Uint8Array(b),function(v){return v.toString(16).padStart(2,'0')}).join('')})}
    function read(){
     return new Promise(function(resolve,reject){
      var done=false,timer=setTimeout(function(){if(!done){done=true;reject(Error('KodBox 读取超时'))}},TIMEOUT);
      try{model.fileContent({path:filePath,pageNum:MAX},function(data){
       if(done)return;done=true;clearTimeout(timer);
       if(typeof data!=='string')reject(Error('服务器未返回有效文本或无读取权限'));
       else if(data.length>MAX)reject(Error('保险库数据超过大小限制'));
       else resolve(data);
      })}catch(e){if(!done){done=true;clearTimeout(timer);reject(e)}}
     })
    }
    function request(action,data){
      return new Promise(function(resolve,reject){
        $.ajax({url:'{{pluginApi}}'+action,type:'POST',data:data,dataType:'json',timeout:TIMEOUT,
          success:function(result){
            if(!result||!result.code)return reject(Error(result&&result.msg||'KodBox 拒绝操作'));
            resolve(result.data)
          },
          error:function(_xhr,status){reject(Error('KodBox 服务端请求失败：'+status))}
        });
      });
    }
    function send(type,requestId,data){if(!closed&&iframe.contentWindow)iframe.contentWindow.postMessage({kind:'foldmemo:host',channel:channel,type:type,requestId:requestId,data:data},location.origin)}
    async function onMessage(ev){
     if(closed||ev.source!==iframe.contentWindow||ev.origin!==location.origin)return;
     var m=ev.data;if(!m||m.kind!=='foldmemo:client'||typeof m.channel!=='string'||m.channel.length>100)return;
     if(m.type==='hello'&&!channel){
      channel=m.channel;
      try{
        var content=await read(),permission=false;
        try{var check=await request('access',{path:filePath});permission=!!check.writable}catch(_e){permission=false}
        baseline=await digest(content);
        send('init',m.requestId,{body:content,baseline:baseline,filename:name||'vault.foldmemo',fileId:String(typeof md5==='function'?md5(filePath):filePath),writable:permission,bridgeVersion:'0.1.3'});
      }catch(e){send('error',m.requestId,{message:String(e.message||e)})}
      return;
     }
     if(m.channel!==channel)return;
     if(m.type==='close-decision'){
      if(!closeRequestId||m.requestId!==closeRequestId)return;
      closeRequestId=null;
      if(m.data&&m.data.approved===true){closeApproved=true;dialog.close()}
      return;
     }
     if(m.type==='dirty'){dirty=!!m.data?.dirty;return}
     if(m.type!=='write')return;
     if(writing){send('error',m.requestId,{message:'正在保存，请稍后重试'});return}
     writing=true;
     try{
      if(!m.data||typeof m.data.body!=='string'||m.data.body.length>MAX||m.data.expected!==baseline)throw Error('保存基线不一致或文件过大');
      var pkg=JSON.parse(m.data.body);
      if(!pkg||pkg.format!=='foldmemo-file-2'||typeof pkg.encrypted!=='boolean'||typeof pkg.vaultId!=='string')throw Error('只能保存 FoldMemo v2 保险库');
      var result=await request('atomicSave',{path:filePath,expected:baseline,content:m.data.body});
      if(!result||typeof result.baseline!=='string')throw Error('服务器未确认保存结果');
      baseline=result.baseline;send('written',m.requestId,{baseline:baseline});
     }catch(e){send('error',m.requestId,{message:String(e.message||e)})}
     finally{writing=false}
    }
    window.addEventListener('message',onMessage);
    var priorClose=dialog.close;
    dialog.close=function(){
      if(dirty&&!closeApproved){
        if(closeRequestId)return;
        if(!channel){Tips.tips('FoldMemo 正在初始化，无法确认关闭','warning');return}
        closeRequestId=(crypto.randomUUID?crypto.randomUUID():('close-'+Date.now()));
        send('confirm-close',closeRequestId,{dirty:true});
        return;
      }
      closed=true;window.removeEventListener('message',onMessage);return priorClose.apply(this,arguments);
    }
   }
  })
 })
});
