import assert from 'node:assert/strict'
import { newVault, pack, unpack } from '../src/lib/vault.ts'

const wrap = (value) => {
  if (Array.isArray(value)) return new Proxy(value.map(wrap), {})
  if (value && typeof value === 'object')
    return new Proxy(Object.fromEntries(Object.entries(value).map(([k,v]) => [k, wrap(v)])), {})
  return value
}

const original = newVault()
original.categories.push({id:'cat1', name:'测试类别', fields:[]})
original.items.push({id:'record1', title:'测试便笺', kind:'record', categoryId:'cat1', body:'Unicode 🔒', values:{secret:'sample-only-not-real'},favorite:false,order:0,updated:1})
const reactiveLike = wrap(original)
assert.throws(() => structuredClone(reactiveLike), /could not be cloned|DataCloneError/)
const plainPack = await pack(reactiveLike, null)
assert.equal(plainPack.encrypted, false)
assert.deepEqual(plainPack.plain, original)
assert.notEqual(plainPack.plain, reactiveLike)
plainPack.plain.items[0].title = '拷贝独立'
assert.equal(reactiveLike.items[0].title, '测试便笺')
const secured = await pack(reactiveLike, 'temporary-test-password')
assert.equal(secured.encrypted, true)
const back = await unpack(secured, 'temporary-test-password')
assert.deepEqual(back, original)
console.log('PASS: Proxy/nested Proxy plaintext serialization, deep-copy isolation, and AES-GCM compatibility')
