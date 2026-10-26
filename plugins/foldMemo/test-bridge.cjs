/* Focused source-level regression. Run with Node 20+. */
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/static/main.js','utf8');
let value='null',listener=null;const answers=[],windowRef={postMessage:x=>answers.push(x)};
const iframe={contentWindow:windowRef};
const dialog={$main:{find:()=>({get:()=>iframe})},close(){},display(){return this},zIndex(){return this}};
const env={kodReady:[],kodApp:{pathModel:{
 fileContent:(_p,cb)=>queueMicrotask(()=>cb(value)),
 fileSave:({content},cb)=>{value=content;queueMicrotask(()=>cb({code:true}))}
}},window:{addEventListener:(_t,cb)=>listener=cb,removeEventListener:()=>listener=null},
 Events:{bind:(_n,cb)=>env.setup=cb},core:{openDialog:()=>dialog},
 $:{dialog:{list:{}}},Tips:{tips:()=>{throw Error('unexpected popup')}},
 location:{origin:'https://kodbox.test'},crypto:require('node:crypto').webcrypto,
 TextEncoder,Promise,Number,Error,Date,setTimeout,clearTimeout,md5:x=>'id'+x};
env.window.kodApp=env.kodApp;
vm.runInNewContext(source,env);env.kodReady[0]();const apps=[];env.setup(apps);
assert.equal(apps.length,1);apps[0].callback('{user:1}/test.foldmemo','foldmemo','test.foldmemo');
const cid='session';
function send(type,requestId,data,sourceWindow=windowRef){listener({source:sourceWindow,origin:env.location.origin,data:{kind:'foldmemo:client',type,channel:cid,requestId,data}})}
const flush=()=>new Promise(r=>setTimeout(r,30));
(async()=>{
 send('hello','i');await flush();assert.equal(answers.at(-1).type,'init');
 const baseline=answers.at(-1).data.baseline;
 const sealed=JSON.stringify({format:'foldmemo-file-2',vaultId:'unit-test',encrypted:true,content:{},keyWrap:{}});
 send('write','w',{expected:baseline,body:sealed});await flush();
 assert.equal(value,sealed);assert.equal(answers.at(-1).type,'written');
 let current=answers.at(-1).data.baseline;
 send('write','p',{expected:current,body:JSON.stringify({format:'foldmemo-file-2',encrypted:false})});await flush();
 assert.equal(answers.at(-1).type,'error');assert.equal(value,sealed);
 value='external modification';send('write','c',{expected:current,body:sealed});await flush();
 assert.equal(answers.at(-1).type,'error');assert.equal(value,'external modification');
 dialog.close();assert.equal(listener,null);
 console.log('PASS: trusted plugin bridge, encrypted write, reject plaintext, detect external modification');
})().catch(e=>{console.error(e);process.exitCode=1});
