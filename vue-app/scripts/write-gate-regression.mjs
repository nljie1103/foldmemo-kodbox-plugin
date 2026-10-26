import assert from 'node:assert/strict'
import fs from 'node:fs'
const s=fs.readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
const expected=['newRecord','editItem','saveItem','deleteItem','restoreItem','purgeItem','favorite','categoryNew','categoryEdit','addField','saveCategory','removeCategory','moveItem','changePass']
for(const name of expected){
  const pattern=new RegExp(`(?:async )?function ${name}(?:<[^>]+>)?\\([^\\n]*\\)\\{(?:if\\(!vault\\.value\\|\\|)?(?:(?:if\\(!editable\\(\\)\\)return)|requireEditable\\(\\))`)
  assert(pattern.test(s),`Mutation entry ${name} lacks authorization guard`)
}
assert(s.includes("function editAppearance<")&&s.includes("if(!vault.value||!editable())return;vault.value.appearance"),'Theme mutations must be guarded')
assert(s.includes("location.protocol==='file:'")&&s.includes('window.self===window.top'),'KodBox/remote preview must remain read-only')
assert(s.includes('if(!localFileSupported)throw Error('),'Cloud vault creation needs to be blocked')
assert(s.includes('firstAuthorizationPrompt.value=true;await saveDraft()'),'Fresh vault must prompt authorization immediately')
assert(s.includes('writeReady.value=true;firstAuthorizationPrompt.value=false;'),'Successful disk write must release edit gate')
assert(s.includes("if(permission!=='granted'){writeReady.value=false;"),'Revoked permission must disable further edits')
assert(s.includes("return writeSerial.catch((e)=>{writeReady.value=false"),'Write failure must disable editing')
assert(s.includes('await inspectBinding(activeBinding,vault.value!.id);'),'Reauthorization must check current disk identity')
assert(s.includes('!localFileSupported\"'),'Cloud creation control must be disabled')
assert(s.includes('当前 HTML 尚未获得写入授权'),'Explicit read-only message must be present')
console.log('PASS: 15 mutation guards, initial authorization prompt, readonly cloud, permission recovery, failed-save closure')
