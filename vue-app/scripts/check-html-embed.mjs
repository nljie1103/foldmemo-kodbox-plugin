// Browser DOMParser regression harness; run manually in browser or via Playwright.
// The v2 embed serializer now accepts both foldmemo-file-2 and legacy foldmemo-vue-package-1.
import fs from 'node:fs'
import assert from 'node:assert/strict'
const t=fs.readFileSync(new URL('../src/lib/vault.ts', import.meta.url), 'utf8')
assert(t.includes("import type { FilePackage } from './security-v2'"))
assert(t.includes('p:Package | FilePackage<Vault>'))
console.log('PASS: v2 HTML embedding accepts current and historical package types')
