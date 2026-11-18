// Una pestaña con la versión anterior abierta no debe dejar la nueva en blanco. Ejecutar: NODE_PATH=$(npm root -g) node radar-tests/upgrade.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http'; import { readFile } from 'node:fs/promises'; import { extname, join, normalize } from 'node:path';
const ROOT = new URL('../SUBIR-A-HOSTINGER/radar/', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => { let p = normalize(decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html';
  try { const b = await readFile(join(ROOT, p)); res.writeHead(200, { 'content-type': MIME[extname(p)] || 'text/plain' }); res.end(b); } catch { res.writeHead(404); res.end('no'); } }).listen(8766);
const browser = await chromium.launch(); const ctx = await browser.newContext();
// Pestaña con la versión anterior abierta (conexión v1 abierta, sin cerrarla)
const vieja = await ctx.newPage(); await vieja.goto('http://localhost:8766/no');
await vieja.evaluate(() => new Promise((res) => { const r = indexedDB.open('radar-dolores-reels', 1); r.onupgradeneeded = () => { for (const t of ['projects','creators','reels','metric_snapshots','transcripts','annotations','comments','pain_mentions','pain_clusters','outputs','trends','runs']) r.result.createObjectStore(t, { keyPath: 'id' }).createIndex('project_id', 'project_id'); };
  r.onsuccess = () => { const tx = r.result.transaction('projects', 'readwrite'); tx.objectStore('projects').put({ id: 'p1', tema: 'Mi proyecto real', created_at: '2026-11-15' }); tx.oncomplete = () => { window.__db = r.result; res(); }; }; }));
const nueva = await ctx.newPage(); const errs = []; nueva.on('pageerror', (e) => errs.push(e.message));
await nueva.goto('http://localhost:8766/'); await nueva.waitForTimeout(2500);
import assert from 'node:assert/strict';
assert.equal(errs.length, 0, errs.join()); assert.match(await nueva.locator('#view').textContent(), /Actualizando tu almacenamiento/);
await vieja.close(); await nueva.waitForTimeout(2500);
assert.equal(await nueva.locator('#tabs button').count(), 7); assert.ok((await nueva.locator('#projectSel option').allTextContents()).includes('Mi proyecto real'));
console.log('OK actualización con la versión anterior abierta en otra pestaña: avisa, sigue sola al cerrarla y conserva los datos');
await browser.close(); server.close();
