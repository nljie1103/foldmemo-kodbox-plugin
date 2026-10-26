// Regression: KodBox mobile iframe must use Vue dialogs, never native confirm().
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
const source=fs.readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
const match=source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)
assert.ok(match,'script setup must be present')
const tree=ts.createSourceFile('App.ts',match[1],ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
const diagnostics=tree.parseDiagnostics
assert.equal(diagnostics.length,0,'script setup TypeScript syntax must parse')
const calls=[]
const functions=new Map()
function visit(node){
 if(ts.isCallExpression(node)){
  const expression=node.expression
  if(ts.isIdentifier(expression)&&expression.text==='confirm')throw Error('Native confirm() remains in App.vue')
  if(ts.isPropertyAccessExpression(expression)&&expression.expression.getText(tree)==='window'&&expression.name.text==='confirm')throw Error('window.confirm() remains in App.vue')
  if(ts.isIdentifier(expression)&&expression.text==='requestConfirm'){
    assert.ok(ts.isAwaitExpression(node.parent),'Every requestConfirm() call must be awaited')
    calls.push(node)
  }
 }
 if(ts.isFunctionDeclaration(node)&&node.name)functions.set(node.name.text,node)
 ts.forEachChild(node,visit)
}
visit(tree)
assert.equal(calls.length,12,'All 11 original confirmations and KodBox host-close must use Vue UI')
for(const name of ['deleteItem','purgeItem','removeCategory','exportMarkdown']){
 const fn=functions.get(name)
 assert.ok(fn,'Missing function '+name)
 assert.ok(fn.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword),name+' must be async')
}
for(const name of ['deleteItem','purgeItem','removeCategory']){
 const fn=functions.get(name)
 const body=fn.body.getText(tree)
 const confirmAt=body.indexOf('requestConfirm(')
 const markAt=body.lastIndexOf('mark()')
 assert.ok(confirmAt>0&&markAt>confirmAt,name+' must confirm before mutating saved state')
}
assert.ok(source.includes('<Dialog :open="confirmationOpen"'),'Confirmation modal must use native Vue Dialog')
assert.ok(source.includes('finishConfirm(false)')&&source.includes('finishConfirm(true)'),'Dialog must support cancel and acceptance')
assert.ok(source.includes("onBeforeUnmount(()=>finishConfirm(false))"),'Unmount must cancel unresolved confirmations')
assert.ok(source.includes('sm:flex-row')&&source.includes('w-full sm:w-auto'),'Actions must fit phone widths')
function scan(runtimeRoot){
  for(const entry of fs.readdirSync(runtimeRoot,{withFileTypes:true})){
    const full=runtimeRoot+'/'+entry.name
    if(entry.isDirectory()){scan(full);continue}
    if(!/\.(ts|vue|js|html)$/i.test(entry.name))continue
    const body=fs.readFileSync(full,'utf8')
    assert.doesNotMatch(body,/\b(?:window\.|globalThis\.)?(?:confirm|alert|prompt)\s*\(/, 'Native browser dialog found in '+full)
  }
}
scan(fileURLToPath(new URL('../src/',import.meta.url)))
const outer=fs.readFileSync(new URL('../../plugins/foldMemo/static/main.js',import.meta.url),'utf8')
assert.doesNotMatch(outer,/\b(?:window\.|globalThis\.)?(?:confirm|alert|prompt)\s*\(/,'Native browser dialog in KodBox parent opener')
assert.match(outer,/type==='close-decision'/,'Parent must process in-app close decision')
assert.match(outer,/bridgeVersion:'0\.1\.3'/,'Parent must advertise bridge compatibility')
const bridge=fs.readFileSync(new URL('../src/lib/kodbox-bridge.ts',import.meta.url),'utf8')
assert.match(bridge,/confirm-close/,'Iframe must handle host close requests')
assert.match(bridge,/bridgeVersion!=='0\.1\.3'/,'Iframe must reject stale bridge')
console.log('PASS: 12 mobile-safe Vue confirmations, full source scan, host close guard and bridge version handshake')
