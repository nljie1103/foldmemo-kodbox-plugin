/* v0.1.1 bridge regression: KodBox API authorization / CAS / plaintext opt-out. */
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/static/main.js','utf8');
const crypto=require('node:crypto').webcrypto;
let value='null',writable=true,listener=null,dialogCloseCount=0;
const answers=[],frame={postMessage:m=>answers.push(m)};
const iframe={contentWindow:frame};
const dialog={$main:{find:()=>({get:()=>iframe})},close(){dialogCloseCount++;return 'closed'},display(){return this},zIndex(){return this}};
const digest=async v=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))).toString('hex');
const $={dialog:{list:{}},ajax:async options=>{
 const {success,error}=options;
 try{
  if(options.url.includes('updateCheck'))return success({code:true,data:{current:'0.1.4',latest:'0.1.5',available:true,installNonce:'test-nonce'}});
  if(options.url.includes('updateInstall'))return success({code:true,data:{installed:'0.1.5',previous:'0.1.4'}});
  if(options.url.includes('access'))return success({code:true,data:{writable}});
  if(!options.url.includes('atomicSave'))throw Error('unexpected endpoint');
  if(!writable)return success({code:false,msg:'permission denied'});
  const {expected,content}=options.data;
  if(expected!==await digest(value))return success({code:false,msg:'VERSION_CONFLICT'});
  const parsed=JSON.parse(content),previous=JSON.parse(value);
  if(parsed.format!=='foldmemo-file-2'||typeof parsed.encrypted!=='boolean')return success({code:false,msg:'bad data'});
  if(previous&&previous.vaultId!==parsed.vaultId)return success({code:false,msg:'wrong vault'});
  value=content;success({code:true,data:{baseline:await digest(value),saved:true}});
 }catch(e){error(null,String(e))}
}};
const env={kodReady:[],kodApp:{pathModel:{fileContent:(_p,cb)=>queueMicrotask(()=>cb(value))}},
 window:{addEventListener:(_t,cb)=>listener=cb,removeEventListener:()=>listener=null},
 Events:{bind:(_n,cb)=>env.setup=cb},core:{openDialog:()=>dialog},$,
 Tips:{tips:()=>{throw Error('unexpected popup')}},location:{origin:'https://kodbox.test'},
 crypto,TextEncoder,Promise,Number,Error,Date,setTimeout,clearTimeout,
 md5:x=>'id'+x};
env.window.kodApp=env.kodApp;
vm.runInNewContext(source,env);
env.kodReady[0]();const apps=[];env.setup(apps);
assert.equal(apps.length,1);
apps[0].callback('{user:1}/test.foldmemo','foldmemo','test.foldmemo');
const session='test-channel';
const send=(type,id,data)=>listener({source:frame,origin:env.location.origin,data:{kind:'foldmemo:client',channel:session,type,requestId:id,data}});
const flush=()=>new Promise(resolve=>setTimeout(resolve,50));
(async()=>{
 send('hello','init');await flush();assert.equal(answers.at(-1).type,'init');
 assert.equal(answers.at(-1).data.writable,true);
 assert.equal(answers.at(-1).data.bridgeVersion,'0.1.4');
 let baseline=answers.at(-1).data.baseline;
 const sealed=JSON.stringify({format:'foldmemo-file-2',vaultId:'unit-test',encrypted:true,content:{iv:'test'},keyWrap:{}});
 send('dirty','', {dirty:true});send('write','encrypted',{expected:baseline,body:sealed});await flush();
 assert.equal(value,sealed);assert.equal(answers.at(-1).type,'written');
 baseline=answers.at(-1).data.baseline;
 const clear=JSON.stringify({format:'foldmemo-file-2',vaultId:'unit-test',encrypted:false,plain:{id:'unit-test'}});
 send('write','plaintext',{expected:baseline,body:clear});await flush();
 assert.equal(value,clear);assert.equal(answers.at(-1).type,'written');
 baseline=answers.at(-1).data.baseline;
 const wrong=JSON.stringify({format:'foldmemo-file-2',vaultId:'foreign-vault',encrypted:false,plain:{id:'foreign-vault'}});
 send('write','other',{expected:baseline,body:wrong});await flush();
 assert.equal(answers.at(-1).type,'error');assert.equal(value,clear);
 writable=false;send('write','denied',{expected:baseline,body:clear});await flush();
 assert.equal(answers.at(-1).type,'error');assert.equal(value,clear);
 writable=true;value='null';send('write','conflict',{expected:baseline,body:clear});await flush();
 assert.equal(answers.at(-1).type,'error');assert.equal(value,'null');
 send('update-check','check',{});await flush();
 assert.equal(answers.at(-1).type,'update-status');
 send('update-install','install',{version:'0.1.5',nonce:'test-nonce'});await flush();
 assert.equal(answers.at(-1).type,'update-done');
 assert.equal(dialog.close(),undefined);
 const request1=answers.at(-1);assert.equal(request1.type,'confirm-close');
 assert.equal(dialogCloseCount,0,'Do not close while confirmation pending');
 send('close-decision',request1.requestId,{approved:false});await flush();
 assert.equal(dialogCloseCount,0,'Cancel must keep window');
 assert.equal(dialog.close(),undefined);
 const request2=answers.at(-1);assert.equal(request2.type,'confirm-close');
 assert.notEqual(request2.requestId,request1.requestId);
 send('close-decision',request2.requestId,{approved:true});await flush();
 assert.equal(dialogCloseCount,1,'Approval closes the window');assert.equal(listener,null);
 console.log('PASS v0.1.3: permissions, CAS, plaintext, vault IDs, handshake and in-app close confirmation');
})().catch(e=>{console.error(e);process.exitCode=1});
