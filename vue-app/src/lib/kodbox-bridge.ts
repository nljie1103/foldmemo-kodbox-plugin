/** KodBox trusted opener bridge. The data file contains only encrypted v2 JSON. */
import type {FilePackage} from './security-v2'
import type {Vault} from './vault'
export const kodboxRequested=new URLSearchParams(location.search).get('kodbox')==='1'
export interface CloudStore {
 filename:string;fileId:string;initial:FilePackage<Vault>|null;baseline:string;writable:boolean;
 write(pack:FilePackage<Vault>):Promise<void>;setDirty(value:boolean):void
}
let cloud:CloudStore|null=null
export function getCloudStore(){return cloud}
export async function initCloudStore(){
 if(!kodboxRequested)return
 if(!/^https?:$/.test(location.protocol)||parent===window||!crypto.subtle)throw Error('请从已登录 KodBox 文件管理器打开保险库')
 const channel=crypto.randomUUID(),origin=location.origin
 const pending=new Map<string,{resolve:(v:any)=>void,reject:(e:Error)=>void,timer:ReturnType<typeof setTimeout>}>()
 const listener=(event:MessageEvent)=>{
  if(event.source!==parent||event.origin!==origin)return
  const m=event.data;if(m?.kind!=='foldmemo:host'||m.channel!==channel||!m.requestId)return
  const task=pending.get(m.requestId);if(!task)return
  clearTimeout(task.timer);pending.delete(m.requestId)
  if(m.type==='error')task.reject(Error(String(m.data?.message||'KodBox 操作失败')))
  else task.resolve({type:m.type,data:m.data})
 }
 window.addEventListener('message',listener)
 const call=(type:string,data:any):Promise<any>=>new Promise((resolve,reject)=>{
  const requestId=crypto.randomUUID()
  const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('KodBox 请求超时，请检查登录状态'))},18000)
  pending.set(requestId,{resolve,reject,timer})
  parent.postMessage({kind:'foldmemo:client',channel,type,requestId,data},origin)
 })
 const initial=await call('hello',null)
 if(initial.type!=='init'||typeof initial.data?.body!=='string' )throw Error('KodBox 没有返回可读写的数据文件')
 const raw=initial.data.body.trim()
 let pack:FilePackage<Vault>|null=null
 if(raw&&raw!=='null'){
  let value:unknown
  try{value=JSON.parse(raw)}catch{throw Error('文件不是合法 JSON；为防止误覆盖已停止加载')}
  if(!value||(value as any).format!=='foldmemo-file-2')throw Error('非 FoldMemo v2 数据包；请新建空白 .foldmemo 然后导入旧 HTML')
  pack=value as FilePackage<Vault>
  // Plaintext vaults are supported only after explicit user choice in the UI.
 }
 const store:CloudStore={
  filename:String(initial.data.filename||'vault.foldmemo'),
  fileId:String(initial.data.fileId||'unknown'),
  initial:pack,baseline:String(initial.data.baseline||''),writable:!!initial.data.writable,
  setDirty(value){parent.postMessage({kind:'foldmemo:client',channel,type:'dirty',data:{dirty:!!value}},origin)},
  async write(next){
   if(!store.writable)throw Error('KodBox 当前账号没有写入权限，请重新打开文件检查权限')
   const result=await call('write',{expected:store.baseline,body:JSON.stringify(next)})
   if(result.type!=='written'||!result.data?.baseline)throw Error('KodBox 未确认写入')
   store.baseline=String(result.data.baseline)
  }
 }
 cloud=store
}
