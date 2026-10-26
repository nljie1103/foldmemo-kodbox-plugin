import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import { initialCategoryId, categoryForSave, matchesItemFilter, UNFILED_FILTER } from '../src/lib/note-classification.ts'
const categories=['category-A','category-B']
assert.equal(initialCategoryId(categories,'all'),'category-A')
assert.equal(initialCategoryId(categories,'category-B'),'category-B')
assert.equal(initialCategoryId(categories,UNFILED_FILTER),'')
assert.equal(initialCategoryId([],'all'),'')
const note={kind:'note',categoryId:categoryForSave('note','category-B',categories),favorite:false}
assert.equal(note.categoryId,'category-B','new note must retain selected category')
assert.equal(matchesItemFilter(note,'category-B'),true,'new note must appear in category filter')
assert.equal(matchesItemFilter(note,'category-A'),false)
assert.equal(matchesItemFilter(note,'all'),true)
note.favorite=true
assert.equal(matchesItemFilter(note,'favorites'),true)
const previousNote={kind:'note',categoryId:'',favorite:false}
assert.equal(matchesItemFilter(previousNote,UNFILED_FILTER),true,'existing uncategorized note remains visible')
assert.equal(categoryForSave('note','',categories),'','notes may remain uncategorized')
previousNote.categoryId=categoryForSave('note','category-A',categories)
assert.equal(matchesItemFilter(previousNote,'category-A'),true,'historical note can be assigned category')
assert.equal(matchesItemFilter(previousNote,UNFILED_FILTER),false)
assert.equal(categoryForSave('record','category-A',categories),'category-A')
assert.throws(()=>categoryForSave('record','',categories))
assert.throws(()=>categoryForSave('note','unknown-category',categories))
const app=readFileSync('src/App.vue','utf8')
const vault=readFileSync('src/lib/vault.ts','utf8')
assert.match(app,/Select v-model="editorCategoryChoice"/,'note category dropdown must be visible in shared editor')
assert.match(app,/categoryId:selectedCategory/,'saveItem must preserve note classification')
assert.match(app,/matchesItemFilter\(i,filter.value\)/,'filter should use shared classification')
assert.match(app,/未分类笔记/,'historical notes must remain available')
assert.match(vault,/i.kind==='note'&&i.categoryId!==''&&!cats.has\(i.categoryId\)/,'vault validator must accept only existing categories for classified notes')
console.log('PASS: note/record creation, category selection, filtering, historical-note migration, category validation')
