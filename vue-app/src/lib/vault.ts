import type { FilePackage } from './security-v2'

export type FieldType = 'text' | 'password' | 'url' | 'textarea'
export interface Field { id: string; name: string; type: FieldType }
export interface Category { id: string; name: string; fields: Field[] }
export interface DeletedItem { item: Item; deletedAt: number }
export interface Item {
  id: string; title: string; kind: 'note' | 'record'; categoryId: string;
  body: string; values: Record<string,string>; favorite: boolean; order: number; updated: number
}
export interface Appearance { style: 'default'|'minimal'|'modern'; mode: 'light'|'dark'|'system'; accent: 'violet'|'blue'|'green'|'rose'; cards: 'cards'|'list'; language: 'zh'|'en' }
export interface Security { openEnabled: boolean; storageEnabled: boolean; exportVerifier?: string; exportSalt?: string }
export interface Vault { format:'foldmemo-vue-1'; id: string; categories: Category[]; items: Item[]; trash?: DeletedItem[]; appearance:Appearance; security:Security }
export type Package = {format:'foldmemo-vue-package-1'; encrypted:true; salt:string; iv:string; rounds:number; payload:string; bits:number } | {format:'foldmemo-vue-package-1'; encrypted:false; plain:Vault}

export function id() { return crypto.randomUUID() }
export function newVault(): Vault { return {format:'foldmemo-vue-1',id:id(),categories:[],items:[],trash:[],appearance:{style:'default',mode:'light',accent:'violet',cards:'cards',language:'zh'},security:{openEnabled:true,storageEnabled:true}} }
export function validate(input: unknown): Vault {
  const v=input as Vault
  if(!v || v.format!=='foldmemo-vue-1' || typeof v.id!=='string' || !v.id || !Array.isArray(v.categories) || !Array.isArray(v.items) || !v.appearance || !v.security || v.items.length>50000 || v.categories.length>2000) throw Error('保险库结构或格式无效')
  if(v.trash!==undefined && (!Array.isArray(v.trash)||v.trash.length>50000))throw Error('回收站数据无效')
  if(!['default','minimal','modern'].includes(v.appearance.style)||!['light','dark','system'].includes(v.appearance.mode)||!['cards','list'].includes(v.appearance.cards))throw Error('外观配置无效')
  const cats=new Set<string>(),itemIds=new Set<string>()
  for(const c of v.categories){if(!c||typeof c.id!=='string'||!c.id||typeof c.name!=='string'||!Array.isArray(c.fields)||c.fields.length>100||cats.has(c.id))throw Error('分类模板重复或损坏');cats.add(c.id);const fields=new Set<string>();for(const f of c.fields){if(!f||!['text','password','url','textarea'].includes(f.type)||typeof f.name!=='string'||typeof f.id!=='string'||!f.id||fields.has(f.id))throw Error('字段模板重复或损坏');fields.add(f.id)}}
  function checkItem(i:Item){if(!i||typeof i.id!=='string'||!i.id||itemIds.has(i.id)||typeof i.title!=='string'||!['record','note'].includes(i.kind)||typeof i.body!=='string'||!i.values||typeof i.values!=='object'||Array.isArray(i.values)||typeof i.favorite!=='boolean'||!Number.isFinite(i.order)||!Number.isFinite(i.updated))throw Error('记录字段损坏或 ID 重复');if(typeof i.categoryId!=='string'||(i.kind==='record'&&!cats.has(i.categoryId))||(i.kind==='note'&&i.categoryId!==''&&!cats.has(i.categoryId)))throw Error('内容引用了不存在的分类');itemIds.add(i.id);for(const [k,val] of Object.entries(i.values)){if(typeof val!=='string'||k==='__proto__'||k==='constructor')throw Error('记录字段值不合法')}}
  for(const it of v.items)checkItem(it)
  for(const entry of v.trash||[]){if(!entry||!Number.isFinite(entry.deletedAt))throw Error('回收站时间格式无效');checkItem(entry.item)}
  if(JSON.stringify(v).length>20_000_000)throw Error('保险库大小超过 20 MB 限额')
  if(!v.trash)v.trash=[]
  return v
}
const enc=new TextEncoder(), dec=new TextDecoder()
function b64(bytes: Uint8Array): string { let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s) }
function unb64(s:string):Uint8Array{const d=atob(s);const r=new Uint8Array(d.length);for(let i=0;i<d.length;i++)r[i]=d.charCodeAt(i);return r}
const random=(n:number)=>crypto.getRandomValues(new Uint8Array(n))
async function derive(pass:string,salt:Uint8Array,bits:128|256,rounds:number,usage:KeyUsage[]){const key=await crypto.subtle.importKey('raw',enc.encode(pass),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:new Uint8Array(salt),iterations:rounds},key,{name:'AES-GCM',length:bits},false,usage)}
export async function pack(v:Vault, pass:string|null, rounds=310000, bits:128|256=256):Promise<Package>{validate(v);if(pass===null)return{format:'foldmemo-vue-package-1',encrypted:false,plain:JSON.parse(JSON.stringify(v))};if(!pass)throw Error('加密密码不能为空');const salt=random(16),iv=random(12),key=await derive(pass,salt,bits,rounds,['encrypt']);const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv:new Uint8Array(iv)},key,enc.encode(JSON.stringify(v)));return{format:'foldmemo-vue-package-1',encrypted:true,salt:b64(salt),iv:b64(iv),rounds,payload:b64(new Uint8Array(ct)),bits}}
export async function unpack(p:unknown,pass:string|null):Promise<Vault>{const x=p as Package;if(!x || x.format!=='foldmemo-vue-package-1')throw Error('不是本程序保险库文件');if(!x.encrypted)return validate(x.plain);if(pass===null || !pass)throw Error('需要正确的解锁密码');if(x.rounds<100000||x.rounds>2500000||![128,256].includes(x.bits)||x.payload.length>40_000_000)throw Error('加密参数不合法');const key=await derive(pass,unb64(x.salt),x.bits as 128|256,x.rounds,['decrypt']);const buf=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(unb64(x.iv))},key,new Uint8Array(unb64(x.payload)));return validate(JSON.parse(dec.decode(buf)))}
export async function verifier(pass:string,salt?:string){if(!pass)throw Error('密码不能为空');const s=salt?unb64(salt):random(16);const key=await crypto.subtle.importKey('raw',enc.encode(pass),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new Uint8Array(s),iterations:280000},key,256);return{salt:b64(s),hash:b64(new Uint8Array(bits))}}
export function filename(fallback='FoldMemo.html'){try{return decodeURIComponent(location.pathname.split('/').pop()||fallback)}catch{return fallback}}
export function initialPackage(): Package|null {
  const el=document.getElementById('foldmemo-embedded');if(!el?.textContent?.trim() || el.textContent.trim()==='null')return null
  try{return JSON.parse(el.textContent) as Package}catch{throw Error('保险库文件非空但无法解析，禁止初始化覆盖')}
}
export function htmlWithVault(source:string, p:Package | FilePackage<Vault>):string {
  const doc=new DOMParser().parseFromString(source,'text/html'),el=doc.getElementById('foldmemo-embedded');if(!el)throw Error('HTML 模板缺少内嵌保险库标识');
  el.textContent=JSON.stringify(p).replace(/</g,'\\u003c');
  return '<!doctype html>\n'+doc.documentElement.outerHTML
}
export function download(data:BlobPart,name:string,type:string){const u=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000)}
export function normalizedUrl(raw:string):string|null{const s=raw.trim();if(!s)return null;try{const p=new URL(/^https?:\/\//i.test(s)?s:'https://'+s);if(!['http:','https:'].includes(p.protocol))return null;return p.href}catch{return null}}
