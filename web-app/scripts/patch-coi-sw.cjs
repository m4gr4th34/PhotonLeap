#!/usr/bin/env node
/**
 * Patches coi-serviceworker to bypass non-GET and blob/data URLs.
 * Prevents FetchEvent.respondWith errors when file upload triggers fetch
 * (e.g. Add surface from file) — we now parse client-side, but this
 * ensures any stray POST/fetch doesn't hit the SW.
 */
const fs = require('fs')
const path = require('path')

const file = path.join(__dirname, '../public/coi-serviceworker.min.js')
let content = fs.readFileSync(file, 'utf8')

const original = 'self.addEventListener("fetch",(function(e){const r=e.request;if("only-if-cached"===r.cache&&"same-origin"!==r.mode)return;'
const patched = 'self.addEventListener("fetch",(function(e){const r=e.request;if(r.method!=="GET"||r.url.startsWith("blob:")||r.url.startsWith("data:"))return;if("only-if-cached"===r.cache&&"same-origin"!==r.mode)return;'

if (content.includes(patched)) {
  console.log('coi-serviceworker already patched')
  process.exit(0)
}
if (!content.includes(original)) {
  console.error('coi-serviceworker format changed — patch may need update')
  process.exit(1)
}

content = content.replace(original, patched)
fs.writeFileSync(file, content)
console.log('coi-serviceworker patched (bypass non-GET/blob/data)')
