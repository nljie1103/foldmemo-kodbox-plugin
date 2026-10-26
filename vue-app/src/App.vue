<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Home, NotebookTabs, Tags, Settings2, PanelLeftClose, Plus, Search, Star, Eye, EyeOff, Copy, ExternalLink, Trash2, Lock, Unlock, FileDown, Upload, Download, ShieldCheck, Save, GripVertical, Pencil, ArrowLeft, Check, BookOpen, Menu, Moon, Sun } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { isLegacy, decodeLegacy } from '@/lib/legacy'
import {createSession,openPackage,sealPackage,resetOpenPassword,digestPackage,type FilePackage,type CryptoSession} from '@/lib/security-v2'
import {readEmbedded,sourceShape,loadBinding,saveBinding,forgetBinding,inspectBinding,type FileBinding} from '@/lib/file-binding'
import { id, newVault, validate, unpack, verifier, filename, htmlWithVault, download, normalizedUrl, initialPackage, type Vault, type Item, type Field, type Category, type FieldType, type Package } from '@/lib/vault'
import { UNFILED_CHOICE, initialCategoryId, categoryForSave, matchesItemFilter } from '@/lib/note-classification'
import {getCloudStore} from '@/lib/kodbox-bridge'

const cloud=getCloudStore()
const cloudMode=!!cloud
type Page='home'|'notes'|'categories'|'trash'|'settings'|'theme'
const tx=(zh:string,en:string)=>vault.value?.appearance.language==='en'?en:zh
const vault=ref<Vault|null>(null)
const page=ref<Page>('home'), sidebarOpen=ref(window.innerWidth>=1000), filter=ref('all'), search=ref('')
const themeTab=ref<'style'|'brightness'|'palette'|'layout'>('style')
const status=ref(''), saveState=ref<'unsaved'|'draft'|'saving'|'saved'|'failed'>('unsaved'), dirty=ref(false), busy=ref(false), lockMode=ref<'create'|'unlock'|'none'|'damaged'>('create')
let embeddedError=''
function initialV2():FilePackage<Vault>|null {
  if(cloudMode)return cloud!.initial
  const el=document.getElementById('foldmemo-embedded')
  const raw=el?.textContent?.trim()
  if(!raw||raw==='null')return null
  try {const p=JSON.parse(raw);if(p?.format!=='foldmemo-file-2')throw Error('当前 HTML 数据不是 v2 格式；请使用「手动导入」');return p}
  catch(e) {embeddedError=e instanceof Error?e.message:String(e);return null}
}
const firstPack=ref<FilePackage<Vault>|null>(initialV2()),passphrase=ref(''),openPassword=ref('')
let cryptoSession:CryptoSession|null=null
const recoverySelected=ref(false)
const importedVaultPending=ref(false)
const recoveryAvailable=ref(false)
const freshOpenEnabled=ref(true), freshStorageEnabled=ref(true), newOpeningPass=ref(''), newStoragePass=ref('')
const editorOpen=ref(false), editKind=ref<'record'|'note'>('record'), editorId=ref<string|null>(null)
const draft=reactive({title:'',categoryId:'',body:'',values:{} as Record<string,string>,favorite:false})
const categoryDialog=ref(false),categoryId=ref<string|null>(null),categoryName=ref(''),categoryFields=ref<Field[]>([])
const fieldName=ref(''),fieldType=ref<FieldType>('text')
const noteOpen=ref<Item|null>(null), visible=reactive<Record<string,boolean>>({})
const modalPassword=ref<'open'|'storage'|null>(null),oldPass=ref(''),nextPass=ref('')
const importInput=ref<HTMLInputElement|null>(null), embeddedImportInput=ref<HTMLInputElement|null>(null)
const importPackage=ref<any>(null),importPass=ref(''),importOpenPass=ref(''),importPrompt=ref(false)
const exportPrompt=ref(false),exportEncrypt=ref(true),exportPass=ref(''),includeMdPasswords=ref(false)
const uiError=ref(''),savedFile=ref(''),boundHandle=ref<FileSystemFileHandle|null>(null)
/** Writable local file is mandatory for edits. KodBox's sandboxed/cloud preview is read-only. */
const localFileSupported=location.protocol==='file:' && window.self===window.top && typeof window.showOpenFilePicker==='function'
const writeReady=ref(false),firstAuthorizationPrompt=ref(false)
const editBlockMessage='尚未获得可验证的写入权限。为防止刷新后丢失数据，已暂时禁止编辑。'
const lastCloudSave=ref<number|null>(null)
function editable(){if(writeReady.value && (cloudMode ? cloud!.writable : !!activeBinding && localFileSupported) && !importedVaultPending.value)return true;info(editBlockMessage);firstAuthorizationPrompt.value=localFileSupported;return false}
function requireEditable(){if(!editable())throw Error(editBlockMessage)}

let activeBinding:FileBinding|null=null
let lastSealed:{rev:number;pack:FilePackage<Vault>}|null=null
let saveTimer:ReturnType<typeof setTimeout>|undefined
let draftTimer:ReturnType<typeof setTimeout>|undefined
let writeSerial=Promise.resolve()
let changes=0
async function checkPermissionOnFocus(){if(!vault.value||!activeBinding||!writeReady.value)return;try{const p=await activeBinding.handle.queryPermission({mode:'readwrite'});if(p!=='granted'){writeReady.value=false;firstAuthorizationPrompt.value=localFileSupported;info('浏览器写入授权已失效，请重新授权后继续编辑')}}catch{writeReady.value=false;firstAuthorizationPrompt.value=localFileSupported;info('无法校验 HTML 写入权限，已切换为只读')}}
const draftKey=()=>`foldmemo-v2:draft:${location.origin}:${cloudMode?cloud!.fileId:location.href}`
function getCachedPackage():FilePackage<Vault>|null{try{const val=localStorage.getItem(draftKey());const p=val?JSON.parse(val)?.pack:null;return p?.format==='foldmemo-file-2'?p:null}catch{return null}}
async function snapshot(){if(!vault.value||!cryptoSession)throw Error('保险库尚未解锁');const rev=changes;if(lastSealed?.rev===rev)return lastSealed;const plain=JSON.parse(JSON.stringify(vault.value)) as Vault;const pack=await sealPackage(plain,cryptoSession);const result={rev,pack};if(rev===changes)lastSealed=result;return result}
async function currentDraft(){const p=getCachedPackage();if(!p)throw Error('没有可恢复草稿');if(firstPack.value?.vaultId && firstPack.value.vaultId!==p.vaultId && !confirm('恢复草稿属于另一份保险库，当前文件数据不会被覆盖。确定恢复以便另存为新 HTML 吗？'))throw Error('用户取消恢复其他保险库草稿');return p}
function info(s:string){status.value=s}
function fail(e:unknown){if(activeBinding&&(!localFileSupported||!writeReady.value))firstAuthorizationPrompt.value=localFileSupported;saveState.value='failed';uiError.value=e instanceof Error?e.message:String(e);info('操作失败：'+uiError.value)}
const allItems=computed(()=>[...(vault.value?.items||[])].sort((a,b)=>a.order-b.order))
const boardColumns=ref(3)
function updateBoardColumns(){boardColumns.value=window.innerWidth<=680?1:window.innerWidth<=1050?2:3}
const groups=computed(()=>vault.value?.categories||[])
const deletedItems=computed(()=>vault.value?.trash||[])
const activeCategory=computed(()=>groups.value.find(c=>c.id===filter.value))
const unfiledNotes=computed(()=>allItems.value.filter(i=>i.kind==='note'&&!i.categoryId).length)
const editorCategoryChoice=computed({get:()=>draft.categoryId||UNFILED_CHOICE,set:(value:string)=>{draft.categoryId=value===UNFILED_CHOICE?'':value}})
function categoryLabel(it:Item|null|undefined){if(!it)return '未分类';return groups.value.find(c=>c.id===it.categoryId)?.name||(it.kind==='note'?'未分类':'记录')}
const counts=computed(()=>({records:allItems.value.filter(i=>i.kind==='record').length,notes:allItems.value.filter(i=>i.kind==='note').length,favorites:allItems.value.filter(i=>i.favorite).length}))
const displayed=computed(()=>allItems.value.filter(i=>matchesItemFilter(i,filter.value)&&(!search.value||`${i.title} ${i.body}`.toLowerCase().includes(search.value.toLowerCase()))))
const board=computed(()=>{const n=boardColumns.value;const arr=Array.from({length:n},()=>[] as Item[]);displayed.value.forEach((it,i)=>arr[i%n].push(it));return arr})
const appearance=computed(()=>vault.value?.appearance||newVault().appearance)
const hasOpenPassword=computed(()=>vault.value?.security.openEnabled??false)
const pendingDraft=computed(()=>recoveryAvailable.value)
const saveStateLabel=computed(()=>({unsaved:'未保存',draft:'本机草稿已保存',saving:'正在写入',saved:cloudMode?'KodBox 云端已保存':'HTML 已写入',failed:'保存出错'}[saveState.value]))
const template=(window as Window & {__FOLDMEMO_TEMPLATE__?:string}).__FOLDMEMO_TEMPLATE__||''
function applyLook(){document.documentElement.dataset.accent=appearance.value.accent;document.documentElement.dataset.style=appearance.value.style;const dark=appearance.value.mode==='dark'||(appearance.value.mode==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',dark)}
watch(appearance,applyLook,{deep:true,immediate:true})
watch([page,filter],()=>{search.value='';noteOpen.value=null})
function mark(){if(!vault.value)return;changes++;lastSealed=null;dirty.value=true;saveState.value='unsaved';info(cloudMode?'修改待同步至 KodBox':'仅本地恢复草稿，尚未写入当前 HTML');if(cloudMode)cloud?.setDirty(true);clearTimeout(draftTimer);draftTimer=setTimeout(()=>saveDraft().catch(fail),280);if(activeBinding||cloudMode){clearTimeout(saveTimer);saveTimer=setTimeout(()=>writeBoundFile().catch(fail),1300)}}
function editAppearance<K extends keyof Vault['appearance']>(name:K,value:Vault['appearance'][K]){if(!vault.value||!editable())return;vault.value.appearance[name]=value;mark()}
async function saveDraft(){if(!vault.value)return;const snap=await snapshot();if(snap.rev!==changes){clearTimeout(draftTimer);draftTimer=setTimeout(()=>saveDraft().catch(fail),200);return}localStorage.setItem(draftKey(),JSON.stringify({pack:snap.pack,time:Date.now(),vaultId:vault.value.id}));recoveryAvailable.value=true;if(dirty.value)saveState.value='draft'}
async function setup(){if(vault.value)return;if(cloudMode&&!cloud!.writable)throw Error('KodBox 未授予当前文件写入权限，不能创建保险库');if(!localFileSupported&&!cloudMode)throw Error('请通过本地 Chrome/Edge 或 KodBox 插件打开保险库');if(embeddedError)throw Error('当前文件可能损坏，不能创建新库覆盖');if(firstPack.value)throw Error('当前文件已包含保险库，请先解锁');if(cloudMode&&!freshOpenEnabled.value&&!confirm('关闭打开密码后，云端 .foldmemo 与浏览器恢复草稿都可能保存明文。仅 KodBox 与浏览器权限提供保护。确定继续吗？'))return;if(freshOpenEnabled.value&&newOpeningPass.value.length<8)throw Error('打开密码至少 8 位');if(freshStorageEnabled.value&&newStoragePass.value.length<8)throw Error('存储密码至少 8 位');const v=newVault();v.security.openEnabled=freshOpenEnabled.value;v.security.storageEnabled=freshStorageEnabled.value;if(freshStorageEnabled.value){const proof=await verifier(newStoragePass.value);v.security.exportSalt=proof.salt;v.security.exportVerifier=proof.hash}cryptoSession=await createSession(v.id,freshOpenEnabled.value?newOpeningPass.value:null);vault.value=v;openPassword.value=freshOpenEnabled.value?newOpeningPass.value:'';newOpeningPass.value='';newStoragePass.value='';lockMode.value='none';mark();firstAuthorizationPrompt.value=!cloudMode;await saveDraft();if(cloudMode){await writeBoundFile();info('已创建并写入 KodBox '+(vault.value?.security.openEnabled?'加密':'明文')+'保险库')}else info('保险库已在内存创建，请立即授权当前 HTML 写入；授权成功前禁止创建分类、记录或笔记。')}
async function unlock(){const p=recoverySelected.value?await currentDraft():firstPack.value;if(!p)throw Error('当前 HTML 无保险库数据，请新建或手动恢复');const result=await openPackage(p,p.encrypted?passphrase.value:null,validate);vault.value=result.vault;cryptoSession=result.session;openPassword.value=result.vault.security.openEnabled?passphrase.value:'';passphrase.value='';lockMode.value='none';applyLook();if(recoverySelected.value){importedVaultPending.value=!!firstPack.value&&firstPack.value.vaultId!==p.vaultId;changes++;lastSealed=null;dirty.value=true;info('已从浏览器恢复草稿；尚未写入当前 HTML')}else{dirty.value=false;saveState.value='saved';info('已从当前 HTML 读取保险库')}recoverySelected.value=false;await restoreHandle();if(cloudMode)cloud?.setDirty(dirty.value);if(!writeReady.value&&localFileSupported)info('已解锁，当前是只读状态。请先授权写入当前 HTML，再添加或修改内容。');if(cloudMode&&!writeReady.value)info('KodBox 未获得可验证写入权限，当前为只读')}
async function attempt(action:()=>Promise<unknown>){uiError.value='';busy.value=true;try{await action()}catch(e){fail(e)}finally{busy.value=false}}
async function lock(){if(!vault.value)return;try{clearTimeout(draftTimer);clearTimeout(saveTimer);await writeSerial;if(cloudMode&&dirty.value&&writeReady.value)await writeBoundFile();await saveDraft()}catch(e){fail(e);return}if(dirty.value&&!confirm('当前 HTML 尚未写入最新修改，但浏览器恢复草稿已经保存。仍要锁定吗？'))return;vault.value=null;cryptoSession=null;openPassword.value='';passphrase.value='';boundHandle.value=null;activeBinding=null;writeReady.value=false;firstAuthorizationPrompt.value=false;lockMode.value='unlock';recoverySelected.value=dirty.value;page.value='home';editorOpen.value=false;info('已锁定；如有未写入 HTML 的修改，请选择恢复浏览器草稿')}
function newRecord(kind:'record'|'note'='record'){if(!editable())return;editorId.value=null;editKind.value=kind;draft.title='';draft.body='';draft.values={};draft.favorite=false;draft.categoryId=initialCategoryId(groups.value.map(c=>c.id),filter.value);editorOpen.value=true;noteOpen.value=null}
function editItem(it:Item){if(!editable())return;editorId.value=it.id;editKind.value=it.kind;draft.title=it.title;draft.body=it.body;draft.categoryId=it.categoryId;draft.values={...it.values};draft.favorite=it.favorite;editorOpen.value=true;noteOpen.value=null}
function saveItem(){requireEditable();if(!vault.value||!draft.title.trim())throw Error('请输入标题');const selectedCategory=categoryForSave(editKind.value,draft.categoryId,groups.value.map(c=>c.id));const old=vault.value.items.find(i=>i.id===editorId.value),newIt:Item={id:old?.id||id(),title:draft.title.trim(),kind:editKind.value,categoryId:selectedCategory,body:draft.body,values:{...draft.values},favorite:draft.favorite,updated:Date.now(),order:old?.order??(Math.max(0,...allItems.value.map(i=>i.order))+1)};if(old)Object.assign(old,newIt);else vault.value.items.push(newIt);editorOpen.value=false;mark()}
function deleteItem(it:Item){if(!editable())return;if(!vault.value||!confirm('将「'+it.title+'」移至回收站？'))return;vault.value.trash??=[];vault.value.trash.push({item:JSON.parse(JSON.stringify(it)),deletedAt:Date.now()});vault.value.items=vault.value.items.filter(i=>i.id!==it.id);noteOpen.value=null;mark()}
function restoreItem(itemId:string){if(!editable())return;if(!vault.value)return;const entry=vault.value.trash?.find(x=>x.item.id===itemId);if(!entry)return;vault.value.items.push(entry.item);vault.value.trash=vault.value.trash?.filter(x=>x.item.id!==itemId);mark()}
function purgeItem(itemId:string){if(!editable())return;if(!vault.value||!confirm('永久删除后无法恢复，确认吗？'))return;vault.value.trash=vault.value.trash?.filter(x=>x.item.id!==itemId);mark()}
function favorite(it:Item){if(!editable())return;it.favorite=!it.favorite;mark()}
function categoryNew(){if(!editable())return;categoryId.value=null;categoryName.value='';categoryFields.value=[];fieldName.value='';categoryDialog.value=true}
function categoryEdit(c:Category){if(!editable())return;categoryId.value=c.id;categoryName.value=c.name;categoryFields.value=c.fields.map(f=>({...f}));categoryDialog.value=true}
function addField(){if(!editable())return;if(!fieldName.value.trim())return;categoryFields.value.push({id:id(),name:fieldName.value.trim(),type:fieldType.value});fieldName.value=''}
function saveCategory(){requireEditable();if(!vault.value||!categoryName.value.trim())throw Error('请输入分类名称');const c={id:categoryId.value||id(),name:categoryName.value.trim(),fields:categoryFields.value.map(f=>({...f}))};const old=vault.value.categories.find(x=>x.id===c.id);if(old)Object.assign(old,c);else vault.value.categories.push(c);categoryDialog.value=false;mark()}
function removeCategory(c:Category){if(!editable())return;if(!vault.value||vault.value.items.some(i=>i.categoryId===c.id)){info('请先移动或删除此分类下的记录');return}if(confirm('删除分类 '+c.name+'？')){vault.value.categories=vault.value.categories.filter(x=>x.id!==c.id);mark()}}
const activeEditorCategory=computed(()=>groups.value.find(c=>c.id===draft.categoryId))
function copy(s:string){navigator.clipboard.writeText(s).then(()=>info('已复制')).catch(()=>info('复制失败：请检查剪贴板权限'))}
function goUrl(s:string){const url=normalizedUrl(s);if(!url){info('无效网址：仅允许 HTTP/HTTPS');return}window.open(url,'_blank','noopener,noreferrer')}
function toggleVisible(it:Item,f:Field){const k=it.id+':'+f.id;visible[k]=!visible[k]}
function isVisible(it:Item,f:Field){return !!visible[it.id+':'+f.id]}
function fieldValue(it:Item,f:Field){return it.values[f.id]||''}
function moveItem(a:string,b:string){if(!editable())return;if(!vault.value||a===b)return;const order=allItems.value.map(x=>x.id);const x=order.indexOf(a),y=order.indexOf(b);if(x<0||y<0)return;order.splice(y,0,order.splice(x,1)[0]);for(const i of vault.value.items)i.order=order.indexOf(i.id);mark()}
let dragTimer:ReturnType<typeof setTimeout>|undefined,draggedId='',dragReady=false,downX=0,downY=0
function dragStart(ev:PointerEvent,item:Item,fromHandle=false){if(!fromHandle && (ev.target as HTMLElement)?.closest('button,input,a,textarea'))return;dragReady=false;draggedId=item.id;downX=ev.clientX;downY=ev.clientY;clearTimeout(dragTimer);dragTimer=setTimeout(()=>{dragReady=true;document.body.style.cursor='grabbing'},380)}
function moveByKeyboard(item:Item,step:number){const seq=displayed.value;const pos=seq.findIndex(x=>x.id===item.id),target=seq[pos+step];if(target)moveItem(item.id,target.id)}
function dragMove(ev:PointerEvent){if(!draggedId)return;if(!dragReady){if(Math.hypot(ev.clientX-downX,ev.clientY-downY)>10){clearTimeout(dragTimer);draggedId=''}return}ev.preventDefault()}
function dragEnd(ev:PointerEvent){clearTimeout(dragTimer);document.body.style.cursor='';if(dragReady){const target=document.elementFromPoint(ev.clientX,ev.clientY)?.closest('[data-item-id]');const b=target?.getAttribute('data-item-id');if(b)moveItem(draggedId,b)}draggedId='';dragReady=false}
const mediaQuery=window.matchMedia('(prefers-color-scheme: dark)')
function beforeUnload(e:BeforeUnloadEvent){if(dirty.value){e.preventDefault();e.returnValue=''}}
onMounted(()=>{window.addEventListener('beforeunload',beforeUnload);window.addEventListener('focus',checkPermissionOnFocus);mediaQuery.addEventListener('change',applyLook);recoveryAvailable.value=!!getCachedPackage();updateBoardColumns();window.addEventListener('resize',updateBoardColumns);window.addEventListener('pointermove',dragMove,{passive:false});window.addEventListener('pointerup',dragEnd);window.addEventListener('pointercancel',dragEnd);lockMode.value=embeddedError?'damaged':firstPack.value?'unlock':'create';applyLook();})
onBeforeUnmount(()=>{window.removeEventListener('beforeunload',beforeUnload);window.removeEventListener('focus',checkPermissionOnFocus);mediaQuery.removeEventListener('change',applyLook);window.removeEventListener('resize',updateBoardColumns);window.removeEventListener('pointermove',dragMove);window.removeEventListener('pointerup',dragEnd);window.removeEventListener('pointercancel',dragEnd);clearTimeout(saveTimer);clearTimeout(draftTimer)})
function parseRaw(text:string):unknown{let obj:any;if(/^\s*<(!doctype|html)/i.test(text)){const doc=new DOMParser().parseFromString(text,'text/html');const script=doc.getElementById('foldmemo-embedded')||doc.getElementById('embeddedVault');if(!script)throw Error('不是 FoldMemo 数据文件');obj=JSON.parse(script.textContent||'null')}else obj=JSON.parse(text);if(!obj||!(obj.format==='foldmemo-file-2'||obj.format==='foldmemo-vue-package-1'||isLegacy(obj)))throw Error('无法识别文件格式；导入不会修改当前保险库');return obj}
async function selectedImport(ev:Event){const f=(ev.target as HTMLInputElement).files?.[0];if(!f)return;importPackage.value=parseRaw(await f.text());importPass.value='';importOpenPass.value='';importPrompt.value=true;(ev.target as HTMLInputElement).value=''}
async function finishImport(){if(!localFileSupported&&!cloudMode)throw Error('云端预览为只读，请下载到本机导入');if(vault.value)requireEditable();if(!importPackage.value)throw Error('未选择导入文件');let v:Vault;const input=importPackage.value; if(input.format==='foldmemo-file-2'){v=(await openPackage(input,input.encrypted?importPass.value:null,validate)).vault}else if(isLegacy(input)){v=await decodeLegacy(input,importPass.value)}else{v=await unpack(input,input.encrypted?importPass.value:null)}
if(!confirm(`将导入 ${v.items.length} 条记录。${cloudMode?'只写入当前空白 .foldmemo；原 HTML 不会修改':'不会自动覆盖磁盘上的原文件'}。请确认已保留旧保险库备份。`))return;
if(cloudMode&&firstPack.value&&firstPack.value.vaultId!==v.id)throw Error('已有云端保险库，禁止用其他保险库覆盖。请在 KodBox 新建空白 .foldmemo 文件后导入');if(cloudMode){v.security.openEnabled=importOpenPass.value.length>0;if(!v.security.openEnabled&&!confirm('导入后云端文件与本机恢复草稿可能包含明文，确定吗？'))return}if(v.security.openEnabled&&importOpenPass.value.length<8)throw Error('请提供至少 8 位的打开密码');
// Never inherit a bound disk target from the previous vault. Persist that revocation first.
clearTimeout(saveTimer);clearTimeout(draftTimer);await writeSerial.catch(()=>{});if(!cloudMode){await forgetBinding(location.href);activeBinding=null;boundHandle.value=null;savedFile.value='';writeReady.value=false;}
const freshSession=await createSession(v.id,v.security.openEnabled?importOpenPass.value:null)
cryptoSession=freshSession;importedVaultPending.value=!cloudMode&&!!firstPack.value&&firstPack.value.vaultId!==v.id;vault.value=v;openPassword.value=v.security.openEnabled?importOpenPass.value:'';lockMode.value='none';importPrompt.value=false;recoverySelected.value=false;changes++;lastSealed=null;dirty.value=true;saveState.value='unsaved';await saveDraft();if(cloudMode){cloud?.setDirty(true);await writeBoundFile();info('旧保险库已导入 .foldmemo 文件，原 HTML 未修改')}else info('导入成功；原 HTML 未被覆盖。需要授权当前文件写入以正式保存。')}
function jsonDownload(obj:unknown,name:string){download(JSON.stringify(obj,null,2),name,'application/json;charset=utf-8')}
async function doExport(){if(!vault.value)return;let pass:string|null=null;if(exportEncrypt.value){pass=exportPass.value;if(!pass||pass.length<8)throw Error('请提供至少 8 位的备份加密密码');if(vault.value.security.exportVerifier&&vault.value.security.exportSalt){const chk=await verifier(pass,vault.value.security.exportSalt);if(chk.hash!==vault.value.security.exportVerifier)throw Error('存储加密密码不正确')}}else if(!confirm('明文导出会暴露全部账号和密码。仍要导出吗？'))return;const exportSession=await createSession(vault.value.id,pass);const p=await sealPackage(vault.value,exportSession);jsonDownload(p,`FoldMemo-${vault.value.id.slice(0,8)}.vault.json`);exportPass.value='';exportPrompt.value=false}
function exportMarkdown(){if(!vault.value)return;let s='# FoldMemo 记录\n\n';for(const it of allItems.value){const c=groups.value.find(g=>g.id===it.categoryId);s+=`<details>\n<summary>${it.title.replaceAll('<','&lt;')}</summary>\n\n`;if(it.kind==='note')s+=`${it.body}\n\n`;else for(const f of c?.fields||[]){if(f.type==='password'&&!includeMdPasswords.value)continue;s+=`- **${f.name}**：${it.values[f.id]||''}\n`}s+='\n</details>\n\n'}if(includeMdPasswords.value&&!confirm('此 Markdown 包含明文密码，确定导出吗？'))return;download(s,'FoldMemo-notes.md','text/markdown;charset=utf-8')}
async function changePass(){requireEditable();if(!vault.value||!modalPassword.value)return;if(modalPassword.value==='open'){
  if(vault.value.security.openEnabled&&oldPass.value!==openPassword.value)throw Error('原打开密码不正确');if(cloudMode&&!nextPass.value&&!confirm('关闭打开密码将把云端保险库转换成明文 JSON，具有文件读取权限的人可以查看内容。确定吗？'))return;if(nextPass.value&&nextPass.value.length<8)throw Error('新密码至少 8 位');cryptoSession=await resetOpenPassword(vault.value.id,cryptoSession!,nextPass.value||null);vault.value.security.openEnabled=!!nextPass.value;openPassword.value=nextPass.value
}else{
  if(vault.value.security.exportVerifier&&vault.value.security.exportSalt){const p=await verifier(oldPass.value,vault.value.security.exportSalt);if(p.hash!==vault.value.security.exportVerifier)throw Error('原存储加密密码不正确')}
  if(nextPass.value&&nextPass.value.length<8)throw Error('新密码至少 8 位');vault.value.security.storageEnabled=!!nextPass.value;if(nextPass.value){const p=await verifier(nextPass.value);vault.value.security.exportSalt=p.salt;vault.value.security.exportVerifier=p.hash}else{delete vault.value.security.exportSalt;delete vault.value.security.exportVerifier}
}modalPassword.value=null;oldPass.value='';nextPass.value='';mark()}
async function restoreHandle(){
  writeReady.value=false;
  if(cloudMode){writeReady.value=!!cloud!.writable;return}
  if(!localFileSupported||!vault.value||!firstPack.value||firstPack.value.vaultId!==vault.value.id)return;
  try{
    const b=await loadBinding(location.href);if(!b)return;
    activeBinding=b;boundHandle.value=b.handle;savedFile.value=b.handle.name;
    const permission=await b.handle.queryPermission({mode:'readwrite'});
    if(permission!=='granted'){info('找到了以前授权的 HTML，但浏览器需要你再次确认写入权限');return}
    await inspectBinding(b,vault.value.id);
    writeReady.value=true;info('已恢复当前 HTML 写入权限，可以编辑并自动保存');
  }catch(e){activeBinding=null;boundHandle.value=null;savedFile.value='';writeReady.value=false;info('文件绑定未通过身份或权限检查：'+String(e))}
}
async function authorizeCurrent(){if(!vault.value)throw Error('请先创建保险库');if(!localFileSupported)throw Error('可道云云端 HTML 预览无法写回服务器原文件；请下载到电脑，用 Chrome/Edge 本地打开后授权');const [h]=await window.showOpenFilePicker({types:[{description:'FoldMemo HTML',accept:{'text/html':['.html']}}]});if(h.name!==filename())throw Error('目标文件名与当前 HTML 不同，已拒绝写入');const original=await(await h.getFile()).text();if(sourceShape(original)!==sourceShape(template))throw Error('所选文件与当前程序源代码不一致，拒绝绑定同名的其他版本');const disk=readEmbedded(original) as FilePackage<Vault>|null;
if(disk&&disk.format!=='foldmemo-file-2')throw Error('所选文件含旧版或未知数据，拒绝覆盖');
if(disk?.vaultId!==firstPack.value?.vaultId || (!!disk!==!!firstPack.value))throw Error('所选文件不是当前页面加载的数据版本，禁止覆盖');
const baseline=await digestPackage(disk);if(baseline!==await digestPackage(firstPack.value))throw Error('文件内容已经改变，拒绝绑定');
if((await h.requestPermission({mode:'readwrite'}))!=='granted')throw Error('没有文件写入权限');
const binding:FileBinding={handle:h,vaultId:vault.value.id,baseline,sourceUrl:location.href};activeBinding=binding;boundHandle.value=h;savedFile.value=h.name;writeReady.value=false;try{await writeBoundFile();if(!writeReady.value)throw Error('尚未确认磁盘成功写入，保持只读')}catch(e){activeBinding=null;boundHandle.value=null;savedFile.value='';writeReady.value=false;throw e}}
async function writeBoundFile(){if(cloudMode)return writeCloudFile();if(!vault.value || !activeBinding)return;const binding=activeBinding;const snap=await snapshot();saveState.value='saving';writeSerial=writeSerial.catch(()=>{}).then(async()=>{if(!vault.value||activeBinding!==binding)return;await inspectBinding(binding,vault.value.id);const permission=await binding.handle.queryPermission({mode:'readwrite'});if(permission!=='granted'){writeReady.value=false;firstAuthorizationPrompt.value=true;info('浏览器已撤销写入权限，现已切换为只读，请重新授权');return}
const html=htmlWithVault(template,snap.pack);const writer=await binding.handle.createWritable();try{await writer.write(html);await writer.close()}catch(e){await writer.abort().catch(()=>{});throw e}
binding.baseline=await digestPackage(snap.pack);firstPack.value=snap.pack;await saveBinding(binding);writeReady.value=true;firstAuthorizationPrompt.value=false;
if(snap.rev===changes){dirty.value=false;saveState.value='saved';info('已写入并校验：'+binding.handle.name)}else{saveState.value='unsaved';info('写入期间有新的修改，正在保存新版本');setTimeout(()=>writeBoundFile().catch(fail),250)}});return writeSerial.catch((e)=>{writeReady.value=false;firstAuthorizationPrompt.value=localFileSupported;throw e})}
async function writeCloudFile(){
  if(!cloud || !vault.value || !cryptoSession)return
  const snap=await snapshot()
  saveState.value='saving'
  writeSerial=writeSerial.catch(()=>{}).then(async()=>{
    if(!vault.value)return
    await cloud.write(snap.pack)
    firstPack.value=snap.pack
    writeReady.value=true
    if(snap.rev===changes){dirty.value=false;saveState.value='saved';lastCloudSave.value=Date.now();cloud.setDirty(false);try{localStorage.removeItem(draftKey());recoveryAvailable.value=false}catch{};info('KodBox 保险库已写入并校验：'+cloud.filename)}
    else{saveState.value='unsaved';info('写入期间又有新修改，继续保存');setTimeout(()=>writeBoundFile().catch(fail),250)}
  })
  return writeSerial.catch(e=>{writeReady.value=false;cloud.setDirty(true);throw e})
}
async function manualSync(){
  if(cloudMode){await writeCloudFile();return}
  if(!localFileSupported)throw Error('云端预览不能直接写回可道云服务器；请下载 HTML 后本地打开');
  if(importedVaultPending.value)throw Error('导入了不同的保险库，禁止覆盖原 HTML。请先下载独立 HTML 并重新打开');
  try{
    if(!activeBinding)return await authorizeCurrent();
    const p=await activeBinding.handle.requestPermission({mode:'readwrite'});
    if(p!=='granted')throw Error('浏览器拒绝写入权限');
    await inspectBinding(activeBinding,vault.value!.id);
    await writeBoundFile();
    if(!writeReady.value)throw Error('写入仍未完成，禁止编辑');
  }catch(e){writeReady.value=false;firstAuthorizationPrompt.value=localFileSupported;throw e}
}
async function downloadImportedHtml(){if(!vault.value)throw Error('请先打开保险库');const snap=await snapshot();const name=`FoldMemo-${vault.value.id.slice(0,8)}.html`;download(htmlWithVault(template,snap.pack),name,'text/html;charset=utf-8');info('已触发下载 '+name+'。请打开新文件确认记录存在；当前打开的 HTML 不会被修改。')}
const categoryView=ref<string|null>(null)
function changePage(p:Page){page.value=p;editorOpen.value=false;noteOpen.value=null}
</script>

<template>
<div v-if="lockMode!=='none'" class="overlay">
  <Card class="gate shadow-xl">
    <CardHeader><CardTitle class="text-2xl flex items-center gap-2"><Lock :size="21"/> {{lockMode==='damaged'?'保险库文件需要修复':lockMode==='create'?'创建 FoldMemo 保险库':'解锁 FoldMemo'}}</CardTitle><CardDescription>Vue 3 + shadcn-vue 工作台 · 数据存储与访问密码独立</CardDescription></CardHeader>
    <CardContent class="grid gap-4">
      <template v-if="lockMode==='damaged'"><p class="text-destructive">检测到当前 HTML 存在数据，但无法正确读取：{{embeddedError}}。为防止覆盖，已禁止创建新库。可手动导入备份。</p></template>
      <template v-else-if="lockMode==='create'">
        <div class="flex justify-between items-center"><Label>打开时需要密码</Label><Switch v-model="freshOpenEnabled" /></div>
        <div v-if="freshOpenEnabled" class="grid gap-1"><Label>打开密码（至少 8 位）</Label><Input v-model="newOpeningPass" type="password" autocomplete="new-password" /></div>
        <Separator/>
        <div class="flex justify-between items-center"><Label>启用存储备份密码</Label><Switch v-model="freshStorageEnabled" /></div>
        <div v-if="freshStorageEnabled" class="grid gap-1"><Label>存储备份密码（可与打开密码不同）</Label><Input v-model="newStoragePass" type="password" autocomplete="new-password" /></div>
        <p class="small-note">打开密码独立于 KodBox 登录密码；存储密码用于加密导出备份。</p>
        <p v-if="cloudMode" class="text-xs">KodBox 模式可选择不设置打开密码；关闭后云端文件及本机恢复草稿可能为明文，建议仅用于非敏感笔记。</p><p v-else-if="!localFileSupported" class="text-xs text-destructive">普通 HTML 云端预览只读，请使用 KodBox FoldMemo 插件打开 .foldmemo 文件。</p><Button :disabled="busy || (!localFileSupported&&!cloudMode) || (cloudMode&&!cloud!.writable)" @click="attempt(setup)">创建保险库</Button>
      </template>
      <template v-else>
        <div v-if="(recoverySelected ? getCachedPackage()?.encrypted : firstPack?.encrypted)" class="grid gap-1"><Label>打开密码</Label><Input v-model="passphrase" type="password" autocomplete="current-password" @keydown.enter="attempt(unlock)" /></div>
        <Button :disabled="busy" @click="attempt(unlock)">解锁</Button>
      </template>
      <div class="flex justify-between gap-2"><Button variant="outline" @click="embeddedImportInput?.click()"><Upload class="mr-2" :size="15"/>手动导入保险库</Button><Badge variant="outline">{{cloudMode?'KodBox v0.1.1':'v2.0.3'}}</Badge></div>
      <div v-if="pendingDraft" class="grid gap-2"><p class="small-note">发现本机恢复草稿。默认以当前 HTML 为准，只有你明确点击才使用草稿。</p><Button variant="outline" @click="recoverySelected=!recoverySelected;lockMode='unlock'">{{recoverySelected?'取消草稿恢复':'恢复本机未同步草稿'}}</Button></div>
      <p v-if="uiError" class="text-destructive text-xs">{{uiError}}</p>
    </CardContent>
  </Card>
</div>

<div v-else-if="vault" class="app-shell" :class="{'nd-shell':appearance.style==='minimal'}">
  <aside class="sidebar" :class="{collapsed:!sidebarOpen,expanded:sidebarOpen}">
    <div class="brand"><button class="brandmark" aria-label="展开或收起侧边栏" :aria-expanded="sidebarOpen" @click="sidebarOpen=!sidebarOpen">F</button><div v-if="sidebarOpen" class="side-label min-w-0"><strong>FoldMemo</strong><div class="text-xs text-muted-foreground">{{appearance.style==='minimal'?'MY NOTE DESK':'VUE WORKSPACE'}}</div></div></div>
    <div v-if="appearance.style==='modern' && sidebarOpen" class="modern-workspace-switcher"><span class="modern-avatar">F</span><span class="modern-workspace-copy"><strong>私人保险库</strong><small>FoldMemo · Local workspace</small></span><span class="modern-chevron">⌄</span></div>
    <label v-if="appearance.style==='minimal' && sidebarOpen" class="nd-sidebar-search"><Search :size="15"/><input v-model="search" type="search" aria-label="搜索笔记" placeholder="搜索笔记和记录" @focus="page='notes'"/><span class="nd-search-hint">Ctrl K</span></label>
    <div v-if="appearance.style==='minimal' && sidebarOpen" class="nd-quick-grid" aria-label="快捷入口">
      <button @click="filter='all';changePage('notes')" :class="{active:page==='notes'&&filter==='all'}"><NotebookTabs :size="18"/><span>全部笔记</span></button>
      <button @click="filter='favorites';changePage('notes')" :class="{active:page==='notes'&&filter==='favorites'}"><Star :size="18"/><span>收藏</span></button>
      <button @click="changePage('categories')" :class="{active:page==='categories'}"><Tags :size="18"/><span>分类</span></button>
      <button @click="changePage('trash')" :class="{active:page==='trash'}"><Trash2 :size="18"/><span>回收站</span></button>
    </div>
    <nav class="sidebar-nav grid content-start gap-1">
      <div v-if="appearance.style==='minimal' && sidebarOpen" class="nd-side-section">▴ 快捷访问</div><div v-if="appearance.style==='modern' && sidebarOpen" class="modern-group-label">工作空间 / WORKSPACE</div>
      <button v-for="x in [{key:'home',label:'首页',icon:Home},{key:'notes',label:'笔记与记录',icon:NotebookTabs},{key:'categories',label:'分类管理',icon:Tags},{key:'trash',label:'回收站',icon:Trash2},{key:'settings',label:'设置',icon:Settings2}]" :key="x.key" class="side-link" :class="{active:page===x.key}" :title="x.label" @click="changePage(x.key as Page)"><component :is="x.icon" :size="18"/><span class="side-label">{{x.label}}</span></button>
    </nav>
    <div class="sidebar-theme-group"><div v-if="sidebarOpen" class="sidebar-section-label">外观</div><button class="side-link sidebar-theme-link" :class="{active:page==='theme'}" title="系统主题" @click="changePage('theme')"><Sun :size="18"/><span class="side-label">系统主题</span></button></div>
    <div class="nd-sidebar-bottom"><button class="side-link" title="锁定" @click="lock"><Lock :size="18"/><span class="side-label">锁定保险库</span></button><div v-if="appearance.style==='minimal' && sidebarOpen" class="nd-profile"><div class="nd-avatar">F</div><div class="nd-profile-copy"><strong>私人保险库</strong><span>{{allItems.length}} 条记录 · 本地</span></div></div></div>
  </aside>
  <section class="work">
    <header v-if="appearance.style==='modern'" class="modern-topbar"><div class="modern-breadcrumb"><span>FoldMemo</span><span class="modern-slash">/</span><strong>{{({home:'仪表盘',notes:'笔记与记录',categories:'分类管理',trash:'回收站',settings:'设置',theme:'系统主题'} as Record<Page,string>)[page]}}</strong></div><div class="modern-top-actions"><span class="modern-top-status">{{saveStateLabel}}</span><button class="modern-top-icon" title="切换日间/夜间" @click="editAppearance('mode',appearance.mode==='dark'?'light':'dark')"><Sun v-if="appearance.mode==='dark'" :size="16"/><Moon v-else :size="16"/></button><button class="modern-top-icon" title="系统主题" @click="changePage('theme')"><Settings2 :size="16"/></button><span class="modern-top-avatar">F</span></div></header>
    <!-- 简洁风：只在编辑记录时显示 Chrome 式工作标签，分类筛选永远在下方内容区。 -->
    <div v-if="appearance.style==='minimal' && editorOpen" class="toolbar-tab"><button class="editor-tab" @click="editorOpen=false">{{editorId?'编辑':'新建'}} · {{draft.title||'未命名'}} <span class="ml-3">×</span></button></div>
    <div class="content" :class="{'nd-content':appearance.style==='minimal'}">
    <div v-if="!writeReady" class="mb-5 rounded-xl border-2 border-amber-400/60 bg-amber-50 p-4 text-slate-900 shadow-sm dark:bg-amber-950/60 dark:text-amber-50" role="alert" aria-live="polite">
      <div class="flex flex-wrap justify-between items-center gap-3"><div><strong>{{cloudMode?'KodBox 写入尚未确认':localFileSupported?'只读保护：先授权当前 HTML 才能编辑':'可道云 / 在线预览：只读模式'}}</strong><p class="text-sm mt-1">{{cloudMode?'云端保存或权限校验未成功，暂时禁止修改。请先导出备份，再检查网络、权限或其他设备修改情况。':localFileSupported?'尚未获得可验证的本地写入权限，已禁止新增和修改分类、记录、笔记、主题和密码。授权一次后自动写回 HTML。':'普通云端 HTML 预览只读。请使用 KodBox FoldMemo 插件打开 .foldmemo 文件。'}}</p></div><div class="flex flex-wrap gap-2"><Button v-if="(localFileSupported||cloudMode)&&!importedVaultPending" @click="attempt(manualSync)"><Save class="mr-2" :size="16"/>授权 / 恢复写入</Button><span v-if="!localFileSupported&&!cloudMode" class="text-xs">请通过 KodBox 插件打开加密 .foldmemo 文件。</span><Button v-if="importedVaultPending" variant="outline" @click="attempt(downloadImportedHtml)">下载独立 HTML</Button></div></div>
    </div>
      <div v-if="editorOpen" class="editor-grid">
        <div class="content-top"><div><h1 class="page-title">{{editorId?'编辑':'新建'}}{{editKind==='note'?'笔记':'记录'}}</h1><p class="subhead">{{editKind==='note'?'选择分类整理笔记，也可暂时保留未分类':'字段来源于分类模板，不在记录中任意添加'}}</p></div><Button variant="outline" @click="editorOpen=false"><ArrowLeft :size="15" class="mr-2"/>返回</Button></div>
        <Card><CardContent class="grid gap-5 pt-6">
          <div class="grid gap-2"><Label>标题</Label><Input v-model="draft.title" placeholder="请输入标题" /></div>
          <div class="grid gap-2"><Label>所属分类</Label><Select v-model="editorCategoryChoice"><SelectTrigger><SelectValue placeholder="选择分类"/></SelectTrigger><SelectContent><SelectItem v-if="editKind==='note'" :value="UNFILED_CHOICE">未分类（稍后整理）</SelectItem><SelectItem v-for="c in groups" :key="c.id" :value="c.id">{{c.name}}</SelectItem></SelectContent></Select><p v-if="editKind==='note'" class="small-note">笔记和记录共用分类；选择分类后可通过分类筛选找到笔记。已有未分类笔记也可以编辑归类。</p></div>
          <div v-if="editKind==='record'" class="formgrid"><div v-for="f in activeEditorCategory?.fields||[]" :key="f.id" :class="{'full':f.type==='textarea'}" class="grid gap-2"><Label>{{f.name}}</Label><Textarea v-if="f.type==='textarea'" v-model="draft.values[f.id]"/><Input v-else v-model="draft.values[f.id]" :type="f.type==='password'?'password':'text'" :placeholder="f.type==='url'?'https://example.com':''" /></div></div>
          <div v-else class="grid gap-2"><Label>正文</Label><Textarea v-model="draft.body" class="min-h-70 leading-7" placeholder="记录你的想法……" /></div>
          <div class="flex items-center justify-between gap-3"><div class="flex gap-2 items-center"><Switch v-model="draft.favorite"/><Label>收藏</Label></div><div class="flex gap-2"><Button variant="outline" @click="editorOpen=false">取消</Button><Button @click="attempt(async()=>saveItem())"><Check :size="16" class="mr-2"/>保存</Button></div></div>
        </CardContent></Card>
      </div>
      <template v-else>
      <div v-if="page==='home'" class="section">
        <div class="content-top"><div><h1 class="page-title">工作台</h1><p class="subhead">分类、记录和笔记统计</p></div><Badge variant="secondary">{{allItems.length}} 条内容</Badge></div>
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3"><Card v-for="x in [{name:'账号记录',n:counts.records},{name:'长文本笔记',n:counts.notes},{name:'收藏内容',n:counts.favorites},{name:'自定义分类',n:groups.length}]" :key="x.name" class="work-card"><CardHeader class="pb-2"><CardDescription>{{x.name}}</CardDescription><CardTitle class="text-3xl">{{x.n}}</CardTitle></CardHeader></Card></div>
        <Card class="work-card"><CardHeader><CardTitle>分类分布</CardTitle><CardDescription>点击分类跳转查看对应记录</CardDescription></CardHeader><CardContent class="grid gap-3"><div v-if="!groups.length" class="small-note">尚未添加分类。请先在「分类管理」创建字段模板。</div><button v-for="c in groups" :key="c.id" class="text-left grid gap-1" @click="filter=c.id;changePage('notes')"><div class="flex justify-between text-sm"><strong>{{c.name}}</strong><span>{{allItems.filter(i=>i.categoryId===c.id).length}}</span></div><div class="bg-muted rounded-full h-2 overflow-hidden"><div class="bg-primary h-full rounded-full" :style="{width:(100*allItems.filter(i=>i.categoryId===c.id).length/Math.max(1,allItems.length))+'%'}"></div></div></button></CardContent></Card>
      </div>
      <div v-else-if="page==='notes'" class="section">
        <div class="content-top"><div><h1 class="page-title">笔记与记录</h1><p class="subhead">收藏筛选、分类查看、点击展开、长按拖动排序</p></div><div class="toolbar"><Button v-if="groups.length" :disabled="!writeReady" variant="outline" @click="newRecord('record')"><Plus :size="15" class="mr-1"/>记录</Button><Button :disabled="!writeReady" @click="newRecord('note')"><Plus :size="15" class="mr-1"/>笔记</Button></div></div>
        <div class="filterbar"><Button v-for="x in [{id:'favorites',name:'★ 收藏'},{id:'all',name:'全部'},...(unfiledNotes?[{id:'uncategorized',name:'未分类笔记'}]:[]),...groups.map(c=>({id:c.id,name:c.name}))]" :key="x.id" size="sm" :variant="filter===x.id?'default':'outline'" @click="filter=x.id">{{x.name}} <span class="ml-1 opacity-70">{{x.id==='all'?allItems.length:x.id==='favorites'?counts.favorites:x.id==='uncategorized'?unfiledNotes:allItems.filter(i=>i.categoryId===x.id).length}}</span></Button></div>
        <div v-if="appearance.style==='minimal'" class="nd-content-tools"><span>按分类整理的笔记与记录</span><div class="nd-view-picker"><button :class="{active:appearance.cards==='cards'}" @click="editAppearance('cards','cards')" aria-label="卡片视图">卡片</button><button :class="{active:appearance.cards==='list'}" @click="editAppearance('cards','list')" aria-label="列表视图">列表</button></div></div>
        <div v-else class="toolbar mb-3"><Input v-model="search" class="max-w-70" placeholder="搜索笔记和记录"/><Button size="sm" variant="ghost" @click="editAppearance('cards',appearance.cards==='cards'?'list':'cards')">{{appearance.cards==='cards'?'列表':'卡片'}}</Button></div>
        <div v-if="!displayed.length" class="p-10 border border-dashed rounded-lg text-center text-muted-foreground text-sm">当前筛选暂无记录</div>
        <div v-else-if="appearance.style==='minimal'&&appearance.cards==='cards'" class="memo-board">
          <div v-for="(column,j) in board" :key="j" class="memo-column"><div v-for="it in column" :key="it.id" class="note-drag-wrap" :data-item-id="it.id" @pointerdown="dragStart($event,it)"><button type="button" class="note-sort-handle" aria-label="长按拖动或用上下箭头排序" @pointerdown.stop="dragStart($event,it,true)" @click.stop @keydown.up.prevent="moveByKeyboard(it,-1)" @keydown.down.prevent="moveByKeyboard(it,1)"><GripVertical :size="15"/></button><button type="button" class="nd-note" :aria-label="`打开 ${it.title}`" @click="noteOpen=it"><span class="nd-note-top"><strong>{{it.title}}</strong><span class="nd-ellipsis" aria-hidden="true">···</span></span><span v-if="it.kind==='note' && it.body" class="nd-note-preview">{{it.body}}</span><span class="nd-note-bottom"><span>{{it.kind==='note'?'笔记 · '+categoryLabel(it):categoryLabel(it)}}</span><span class="nd-note-icons"><Star v-if="it.favorite" :size="12" fill="currentColor"/><NotebookTabs v-else :size="12"/></span></span></button></div></div>
        </div>
        <div v-else :class="appearance.cards==='cards'?'cards':'listview'">
          <div v-for="it in displayed" :key="it.id" :data-item-id="it.id" @pointerdown="dragStart($event,it)">
            <Card class="record-card overflow-hidden"><CardContent class="p-0"><details :open="false"><summary class="flex items-center gap-2 p-4"><span class="drag-keyboard-handle" tabindex="0" role="button" aria-label="上下箭头调整记录位置" @pointerdown.stop="dragStart($event,it,true)" @keydown.up.prevent="moveByKeyboard(it,-1)" @keydown.down.prevent="moveByKeyboard(it,1)" @click.stop><GripVertical :size="16" class="text-muted-foreground"/></span><div class="flex-1 min-w-0"><strong class="text-sm break-words">{{it.title}}</strong><div class="small-note">{{it.kind==='note'?'笔记 · '+categoryLabel(it):categoryLabel(it)}}</div></div><Badge variant="outline">{{it.kind==='note'?'笔记':'记录'}}</Badge></summary><div class="p-4 border-t grid gap-2">
              <div v-if="it.kind==='note'" class="whitespace-pre-wrap break-words text-sm leading-7">{{it.body}}</div>
              <template v-else><div v-for="f in groups.find(c=>c.id===it.categoryId)?.fields||[]" :key="f.id" class="fieldline"><span class="small-note">{{f.name}}</span><div class="field-text"><template v-if="f.type==='password'">{{isVisible(it,f)?fieldValue(it,f):'••••••••'}}</template><a v-else-if="f.type==='url'&&normalizedUrl(fieldValue(it,f))" class="field-url" :href="normalizedUrl(fieldValue(it,f))||undefined" target="_blank" rel="noopener noreferrer" @click.stop>{{fieldValue(it,f)}}</a><span v-else>{{fieldValue(it,f)}}</span></div><div class="field-actions"><Button v-if="f.type==='password'" size="icon" variant="ghost" :aria-label="isVisible(it,f)?'隐藏':'显示'" @click="toggleVisible(it,f)"><EyeOff v-if="isVisible(it,f)" :size="16"/><Eye v-else :size="16"/></Button><Button v-if="f.type==='url'" size="icon" variant="ghost" title="打开网页" @click="goUrl(fieldValue(it,f))"><ExternalLink :size="16"/></Button><Button size="icon" variant="ghost" title="复制" @click="copy(fieldValue(it,f))"><Copy :size="16"/></Button></div></div></template>
              <div class="flex flex-wrap gap-2 pt-3"><Button size="sm" variant="outline" @click="editItem(it)"><Pencil :size="14" class="mr-1"/>编辑</Button><Button size="sm" variant="outline" @click="favorite(it)"><Star :size="14" class="mr-1"/>{{it.favorite?'取消收藏':'收藏'}}</Button><Button size="sm" variant="destructive" @click="deleteItem(it)"><Trash2 :size="14" class="mr-1"/>删除</Button></div>
            </div></details></CardContent></Card>
          </div>
        </div>
      </div>
      <div v-else-if="page==='categories'" class="section">
        <div class="content-top"><div><h1 class="page-title">分类管理</h1><p class="subhead">先创建字段模板，再录入账号与记录</p></div><Button @click="categoryNew"><Plus :size="15" class="mr-2"/>新建分类</Button></div>
        <div class="filterbar"><Button v-for="c in groups" :key="c.id" size="sm" :variant="categoryView===c.id?'default':'outline'" @click="categoryView=c.id">{{c.name}}</Button></div>
        <Card v-if="groups.find(c=>c.id===categoryView)||groups[0]" class="work-card"><CardHeader><CardTitle>{{(groups.find(c=>c.id===categoryView)||groups[0]).name}}</CardTitle><CardDescription>每条记录都使用该分类统一的字段模板</CardDescription></CardHeader><CardContent><div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3"><Card v-for="f in (groups.find(c=>c.id===categoryView)||groups[0]).fields" :key="f.id"><CardContent class="p-4"><strong class="text-sm">{{f.name}}</strong><p class="small-note">{{f.type}}</p></CardContent></Card></div><div class="flex gap-2 mt-5"><Button variant="outline" @click="categoryEdit(groups.find(c=>c.id===categoryView)||groups[0])">编辑模板</Button><Button variant="destructive" @click="removeCategory(groups.find(c=>c.id===categoryView)||groups[0])">删除</Button></div></CardContent></Card>
        <div v-else class="text-muted-foreground text-sm">尚无分类</div>
      </div>
      <div v-else-if="page==='trash'" class="section">
        <div class="content-top"><div><h1 class="page-title">回收站</h1><p class="subhead">误删内容可在此恢复，清空后不可撤销</p></div></div>
        <div v-if="!deletedItems.length" class="small-note">回收站为空</div>
        <Card v-for="entry in deletedItems" :key="entry.item.id" class="work-card"><CardContent class="flex justify-between items-center gap-3 py-4"><div class="min-w-0"><strong>{{entry.item.title}}</strong><p class="small-note">{{new Date(entry.deletedAt).toLocaleString()}}</p></div><div class="flex gap-2"><Button variant="outline" @click="restoreItem(entry.item.id)">恢复</Button><Button variant="destructive" @click="purgeItem(entry.item.id)">永久删除</Button></div></CardContent></Card>
      </div>
      <div v-else-if="page==='theme'" class="section theme-page">
        <div class="content-top"><div><h1 class="page-title">系统主题</h1><p class="subhead">为整个工作台选择独立设计语言、配色、明暗与排版</p></div><Badge variant="secondary">外观设置独立侧栏</Badge></div>
        <div class="theme-workspace">
          <aside class="theme-detail-sidebar" aria-label="主题设置分类">
            <button :class="{active:themeTab==='style'}" @click="themeTab='style'"><NotebookTabs :size="16"/>三套界面风格</button>
            <button :class="{active:themeTab==='brightness'}" @click="themeTab='brightness'"><Moon :size="16"/>日间与夜间</button>
            <button :class="{active:themeTab==='palette'}" @click="themeTab='palette'"><Star :size="16"/>全局主题配色</button>
            <button :class="{active:themeTab==='layout'}" @click="themeTab='layout'"><PanelLeftClose :size="16"/>布局与语言</button>
          </aside>
          <div class="theme-detail-body">
            <section v-if="themeTab==='style'" class="theme-setting-panel"><h2>界面风格</h2><p class="theme-panel-hint">三个主题是完整的布局与组件体系，不只是改变颜色。</p>
              <div class="theme-style-grid">
                <button v-for="opt in [{id:'default',title:'默认风格',desc:'v1.0.4 经典 iOS 玻璃工作台',cls:'theme-prev-glass'},{id:'minimal',title:'简洁风',desc:'Note Desk 平面便签工作台',cls:'theme-prev-minimal'},{id:'modern',title:'现代风',desc:'AppDown · shadcn New York + Linear',cls:'theme-prev-modern'}]" :key="opt.id" type="button" class="theme-style-option" :class="{selected:appearance.style===opt.id}" :aria-pressed="appearance.style===opt.id" @click="editAppearance('style',opt.id as Vault['appearance']['style'])"><span class="theme-miniature" :class="opt.cls"><i/><b/><em/><em/><em/></span><strong>{{opt.title}}</strong><small>{{opt.desc}}</small><span class="theme-choice-indicator">{{appearance.style===opt.id?'✓ 已启用':'选择主题'}}</span></button>
              </div></section>
            <section v-else-if="themeTab==='brightness'" class="theme-setting-panel"><h2>日间与夜间</h2><p class="theme-panel-hint">控制整套工作台的背景、文字、表面、侧栏与弹窗。</p><div class="theme-mode-list"><button v-for="opt in [{id:'light',label:'浅色',desc:'明亮清晰的工作台'},{id:'dark',label:'深色',desc:'低亮度深色表面'},{id:'system',label:'跟随系统',desc:'自动响应 Windows / 浏览器系统设置'}]" :key="opt.id" :class="{active:appearance.mode===opt.id}" @click="editAppearance('mode',opt.id as Vault['appearance']['mode'])"><Sun v-if="opt.id==='light'" :size="17"/><Moon v-else :size="17"/><span><strong>{{opt.label}}</strong><small>{{opt.desc}}</small></span><Check v-if="appearance.mode===opt.id" :size="17"/></button></div></section>
            <section v-else-if="themeTab==='palette'" class="theme-setting-panel"><h2>全局主题颜色</h2><p class="theme-panel-hint">同步作用于页面背景、导航、卡片、弹窗、按钮、焦点与提示。色板随三种设计语言分别调整。</p><div class="theme-accent-options"><button v-for="x in [{id:'violet',name:'紫罗兰',color:'#5d57fc'},{id:'blue',name:'海洋蓝',color:'#277cdc'},{id:'green',name:'翡翠绿',color:'#159f74'},{id:'rose',name:'玫瑰红',color:'#dc5387'}]" :key="x.id" :class="{active:appearance.accent===x.id}" @click="editAppearance('accent',x.id as Vault['appearance']['accent'])"><span :style="{background:x.color}"/><strong>{{x.name}}</strong><Check v-if="appearance.accent===x.id" :size="15"/></button></div></section>
            <section v-else class="theme-setting-panel"><h2>显示与语言</h2><p class="theme-panel-hint">卡片视图与列表视图对所有风格生效。</p><div class="setting-line"><div><strong>内容布局</strong><p class="small-note">卡片 / 列表</p></div><Select :model-value="appearance.cards" @update:model-value="v=>editAppearance('cards',v as Vault['appearance']['cards'])"><SelectTrigger class="w-44"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="cards">卡片</SelectItem><SelectItem value="list">列表</SelectItem></SelectContent></Select></div><div class="setting-line"><div><strong>界面语言</strong><p class="small-note">保留当前语言设置</p></div><Select :model-value="appearance.language" @update:model-value="v=>editAppearance('language',v as 'zh'|'en')"><SelectTrigger class="w-44"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="zh">中文</SelectItem><SelectItem value="en">English</SelectItem></SelectContent></Select></div></section>
          </div>
        </div>
      </div>
      <div v-else-if="page==='settings'" class="section">
        <div class="content-top"><div><h1 class="page-title">设置</h1><p class="subhead">独立密码、当前文件管理、保险库导入与导出</p></div></div>
        <Card class="work-card"><CardHeader><CardTitle>独立密码管理</CardTitle><CardDescription>两套密码互不依赖。修改其中一个无需修改另一个。</CardDescription></CardHeader><CardContent class="grid gap-3"><div class="setting-line"><div><strong>打开密码</strong><p class="small-note">用于解密保险库数据；云端模式不可关闭打开密码</p></div><Button variant="outline" @click="modalPassword='open'">{{hasOpenPassword?'修改 / 关闭':'设置打开密码'}}</Button></div><div class="setting-line"><div><strong>存储加密密码</strong><p class="small-note">用于导出加密备份，不会在每次打开时索取</p></div><Button variant="outline" @click="modalPassword='storage'">修改 / 关闭</Button></div></CardContent></Card>
        <Card class="work-card"><CardHeader><CardTitle>{{cloudMode?'KodBox 云端保险库':'当前 HTML 文件'}}</CardTitle><CardDescription>{{cloudMode?'资源与加密数据独立存储':'不会悄悄创建第二份数据文件'}}</CardDescription></CardHeader><CardContent class="grid gap-3"><p class="small-note">{{cloudMode?'云端文件：'+cloud!.filename+'；'+(firstPack?.encrypted?'加密 JSON':'明文 JSON')+'（无脚本）':'当前文件：'+filename()+'。浏览器仅能验证文件名与保险库身份。'}}</p><p class="small-note">{{cloudMode?(writeReady?'KodBox 自动保存已启用'+(lastCloudSave?'，最近成功：'+new Date(lastCloudSave).toLocaleTimeString():''):'云端写入或权限未确认；当前只读'):writeReady?'写入权限有效，自动保存到：'+savedFile:savedFile?'已找到文件 '+savedFile+'，但尚未恢复写入权限':'当前处于只读状态，浏览器草稿不是 HTML 文件本身。'}}</p><p v-if="importedVaultPending" class="text-sm text-destructive">当前是导入的另一份保险库，禁止覆盖原 HTML。请下载独立 HTML 副本并重新打开。</p><Button v-if="importedVaultPending" variant="outline" @click="attempt(downloadImportedHtml)">下载独立保险库 HTML</Button><Button v-else-if="localFileSupported||cloudMode" class="w-fit" variant="outline" @click="attempt(manualSync)"><Save class="mr-2" :size="16"/>{{cloudMode?'立即保存 / 重试同步':writeReady?'立即同步当前 HTML':savedFile?'恢复文件写入授权':'首次授权当前 HTML 写入'}}</Button><p v-else class="text-xs">普通云端预览为只读，请使用 KodBox FoldMemo 插件打开 .foldmemo 文件。</p><p class="text-xs text-destructive">{{cloudMode?'遇到写入冲突或断网时会停止编辑，恢复前请先导出保险库备份。':'如果没有授权写入，请勿直接复制旧 HTML 作为最新备份。'}}</p></CardContent></Card>
        <Card class="work-card"><CardHeader><CardTitle>导出保险库</CardTitle><CardDescription>点击后选择加密或明文；加密时默认验证存储密码</CardDescription></CardHeader><CardContent><Button variant="outline" @click="exportPrompt=true"><FileDown :size="16" class="mr-2"/>导出保险库 JSON</Button></CardContent></Card>
        <Card class="work-card"><CardHeader><CardTitle>导出折叠 Markdown</CardTitle><CardDescription>Markdown 是可读取的明文格式，请谨慎包含密码</CardDescription></CardHeader><CardContent class="flex flex-wrap gap-3 items-center"><div class="flex gap-2 items-center"><Switch v-model="includeMdPasswords"/><Label>包含密码字段</Label></div><Button variant="outline" @click="exportMarkdown"><Download :size="16" class="mr-2"/>导出 MD</Button></CardContent></Card>
        <div class="flex gap-2"><Button variant="outline" @click="importInput?.click()"><Upload :size="16" class="mr-2"/>手动导入</Button><Button variant="destructive" @click="lock"><Lock :size="16" class="mr-2"/>锁定</Button></div>
      </div>
      </template>
    </div>
  </section>
  <div class="status" role="status"><strong>{{saveStateLabel}}</strong> · {{status||'FoldMemo · 本地 HTML 或 KodBox 云端独立加密数据自动保存'}}</div>
</div>

<!-- 新建保险库后立即引导授权：不再允许先编辑后丢数据。 -->
<Dialog :open="firstAuthorizationPrompt&&!writeReady&&localFileSupported" @update:open="()=>{}"><DialogContent class="max-w-lg"><DialogHeader><DialogTitle>先授权当前 HTML 写入</DialogTitle><DialogDescription>你的保险库已经创建，但还没有写入原文件。为防止刷新后丢失笔记，必须先授权，才可新增、编辑分类、记录和笔记。</DialogDescription></DialogHeader><p class="text-sm">点击下面的按钮，在文件选择窗口选择你当前打开的 <strong>{{filename()}}</strong>，允许浏览器修改它。成功后会自动保存，通常不需要再手动操作。</p><DialogFooter><Button @click="attempt(manualSync)"><Save :size="16" class="mr-2"/>授权并开始使用</Button></DialogFooter></DialogContent></Dialog>

<!-- 笔记完整阅读页 -->
<Dialog :open="!!noteOpen" @update:open="v=>{if(!v)noteOpen=null}"><DialogContent class="nd-dialog max-w-3xl max-h-[88dvh] overflow-auto"><DialogHeader><DialogTitle>{{noteOpen?.title}}</DialogTitle><DialogDescription>{{noteOpen?.kind==='note'?'长文本笔记 · '+categoryLabel(noteOpen):'账号记录'}}</DialogDescription></DialogHeader><div v-if="noteOpen" class="grid gap-4"><div v-if="noteOpen.kind==='note'" class="whitespace-pre-wrap leading-8 break-words">{{noteOpen.body}}</div><div v-else v-for="f in groups.find(c=>c.id===noteOpen?.categoryId)?.fields||[]" :key="f.id" class="fieldline"><span>{{f.name}}</span><div class="field-text">{{f.type==='password'&&!isVisible(noteOpen,f)?'••••••••':fieldValue(noteOpen,f)}}</div><div class="field-actions"><Button v-if="f.type==='password'" variant="ghost" size="icon" @click="toggleVisible(noteOpen,f)"><Eye :size="16"/></Button><Button v-if="f.type==='url'" variant="ghost" size="icon" @click="goUrl(fieldValue(noteOpen,f))"><ExternalLink :size="16"/></Button><Button variant="ghost" size="icon" @click="copy(fieldValue(noteOpen,f))"><Copy :size="16"/></Button></div></div><DialogFooter><Button variant="outline" @click="noteOpen=null">关闭</Button><Button @click="noteOpen&&editItem(noteOpen)">编辑</Button></DialogFooter></div></DialogContent></Dialog>

<!-- 编辑分类的弹窗使用真实 shadcn-vue Dialog -->
<Dialog v-model:open="categoryDialog"><DialogContent class="nd-dialog max-w-xl max-h-[88dvh] overflow-auto"><DialogHeader><DialogTitle>{{categoryId?'编辑分类':'新建分类'}}</DialogTitle><DialogDescription>模板字段在记录中只允许填写，不允许增加</DialogDescription></DialogHeader><div class="grid gap-4 py-2"><div class="grid gap-2"><Label>分类名称</Label><Input v-model="categoryName"/></div><div class="grid gap-2"><Label>已有字段</Label><div v-for="(f,i) in categoryFields" :key="f.id" class="flex gap-2 items-center"><Input v-model="f.name" class="flex-1"/><Badge variant="secondary">{{f.type}}</Badge><Button size="icon" variant="outline" @click="categoryFields.splice(i,1)"><Trash2 :size="15"/></Button></div></div><Separator/><div class="grid sm:grid-cols-[1fr_150px_auto] gap-2"><Input v-model="fieldName" placeholder="字段名称"/><Select v-model="fieldType"><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="text">普通文本</SelectItem><SelectItem value="password">密码</SelectItem><SelectItem value="url">网址</SelectItem><SelectItem value="textarea">长文本</SelectItem></SelectContent></Select><Button variant="outline" @click="addField">添加字段</Button></div></div><DialogFooter><Button variant="outline" @click="categoryDialog=false">取消</Button><Button @click="attempt(async()=>saveCategory())">保存分类</Button></DialogFooter></DialogContent></Dialog>

<Dialog :open="modalPassword!==null" @update:open="v=>{if(!v)modalPassword=null}"><DialogContent class="nd-dialog"><DialogHeader><DialogTitle>{{modalPassword==='open'?'修改打开密码':'修改存储加密密码'}}</DialogTitle><DialogDescription>清空新密码表示关闭这一密码要求，不影响另一项</DialogDescription></DialogHeader><div class="grid gap-3"><Label>原密码（首次设置留空）</Label><Input v-model="oldPass" type="password"/><Label>新密码（至少 8 位；留空关闭）</Label><Input v-model="nextPass" type="password"/></div><DialogFooter><Button variant="outline" @click="modalPassword=null">取消</Button><Button @click="attempt(changePass)">确认更改</Button></DialogFooter></DialogContent></Dialog>

<Dialog v-model:open="importPrompt"><DialogContent class="nd-dialog z-[130]"><DialogHeader><DialogTitle>导入保险库</DialogTitle><DialogDescription>手动导入并确认后才会替换当前内容</DialogDescription></DialogHeader><div v-if="importPackage?.encrypted || isLegacy(importPackage) || (importPackage?.security?.openEnabled)" class="grid gap-2"><Label>文件解密密码</Label><Input v-model="importPass" type="password"/></div><div class="grid gap-2"><Label>导入后使用的打开密码（若保险库启用了打开密码）</Label><Input v-model="importOpenPass" type="password" autocomplete="new-password"/></div><DialogFooter><Button variant="outline" @click="importPrompt=false">取消</Button><Button @click="attempt(finishImport)">验证并导入</Button></DialogFooter></DialogContent></Dialog>
<Dialog v-model:open="exportPrompt"><DialogContent class="nd-dialog"><DialogHeader><DialogTitle>导出保险库</DialogTitle><DialogDescription>加密导出默认使用存储密码，明文导出前需要二次确认</DialogDescription></DialogHeader><div class="grid gap-3"><div class="flex justify-between items-center"><Label>启用 AES-256-GCM 加密</Label><Switch v-model="exportEncrypt"/></div><div v-if="exportEncrypt" class="grid gap-2"><Label>存储密码 / 临时备份密码</Label><Input v-model="exportPass" type="password"/></div></div><DialogFooter><Button variant="outline" @click="exportPrompt=false">取消</Button><Button @click="attempt(doExport)">导出</Button></DialogFooter></DialogContent></Dialog>
<input ref="importInput" type="file" hidden accept=".json,.html" @change="selectedImport"/>
<input ref="embeddedImportInput" type="file" hidden accept=".json,.html" @change="selectedImport"/>
<div v-if="uiError && lockMode==='none'" class="fixed bottom-12 right-4 z-[110] max-w-sm rounded-lg bg-destructive text-white p-3 shadow-lg text-xs"><button class="mr-2" @click="uiError=''">×</button>{{uiError}}</div>
</template>
