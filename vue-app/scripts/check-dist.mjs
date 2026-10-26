import fs from 'node:fs'
import assert from 'node:assert/strict'
const base=new URL('../dist/',import.meta.url)
const files=fs.readdirSync(base,{recursive:true,withFileTypes:true}).filter(x=>x.isFile())
assert.equal(files.length,1,'单文件构建不得有额外资源')
assert.equal(files[0].name,'index.html')
const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8')
assert(html.length>30000,'构建产物明显不完整')
assert(html.includes('id="foldmemo-embedded"')||html.includes("id='foldmemo-embedded'"),'缺少保险库数据槽')
assert(/<script\b[^>]*>[\s\S]{200,}<\/script>/.test(html),'缺少内联 JavaScript')
assert(!/<script\b[^>]*\bsrc\s*=/.test(html),'发现外部脚本引用')
assert(!/<link\b[^>]*\bhref\s*=\s*["'][^"']+\.css/.test(html),'发现外部 CSS 引用')
console.log('PASS: 单文件构建格式核查')
