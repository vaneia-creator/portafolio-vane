// Prueba de extremo a extremo en Chromium. Ejecutar: node radar-tests/e2e.mjs
// Parte A: llamadas REALES a Groq y Apify con una clave falsa (comprueba conexión, CORS y manejo de errores).
// Parte B: flujo completo con respuestas simuladas que siguen los esquemas publicados por cada API
//          (solo para probar la app; estos datos de prueba no forman parte de la app).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // usa el Playwright global (NODE_PATH)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = new URL('../SUBIR-A-HOSTINGER/', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(req.url.split('?')[0]));
  if (p.endsWith('/')) p += 'index.html';
  try { const b = await readFile(join(ROOT, p)); res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end('no'); }
}).listen(8765);

const SHOTS = process.env.SHOTS || '/tmp';
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
const browser = await chromium.launch({ proxy });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errores = [];
page.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`); });
page.on('dialog', (d) => d.accept());

const tab = (t) => page.click(`#tabs button:has-text("${t}")`);
const idle = () => page.waitForFunction(() => !document.body.classList.contains('busy'), null, { timeout: 60000 });
const run = async (texto) => { await page.click(`button.btn:has-text("${texto}")`); await page.waitForTimeout(150); await idle(); };
const lastLog = () => page.$$eval('#activityLog li', (l) => l.slice(-6).map((x) => x.textContent).join('\n'));

await page.goto('http://localhost:8765/radar/');
await page.waitForSelector('h2:has-text("Claves de acceso")');
console.log('OK arranca en Configuración cuando faltan claves');

// ---------- Parte A: red real ----------
const keyInput = (n) => page.locator(`input[aria-label="Clave de ${n}"]`);
for (const [nombre, patron] of [['Groq', /401|Invalid API Key/i], ['Apify', /401|token|authentication/i]]) {
  await keyInput(nombre).fill('clave-falsa-de-prueba');
  await keyInput(nombre).blur();
  const card = page.locator('section.card', { hasText: 'Claves de acceso' });
  const idx = nombre === 'Apify' ? 0 : 1;
  await card.locator('button:has-text("Probar")').nth(idx).click();
  const bad = card.locator('.note.bad', { hasText: nombre }).first();
  await bad.waitFor({ timeout: 30000 });
  const txt = await bad.textContent();
  assert.match(txt, patron, `${nombre}: ${txt}`);
  console.log(`OK red real · ${nombre} rechaza la clave falsa → "${txt.slice(0, 90)}"`);
  await keyInput(nombre).fill(''); await keyInput(nombre).blur();
}

// ---------- Parte B: flujo completo con respuestas simuladas ----------
const NOW = Date.now(), DAY = 86400000;
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
const igReels = (user, base) => Array.from({ length: 36 }, (_, i) => ({
  shortCode: `${user}${i}`, ownerUsername: user, timestamp: new Date(NOW - (i * 3 + 1) * DAY).toISOString(),
  videoPlayCount: i === 9 ? base * 22 : i === 14 ? base * 4 : base + ((i * 7919) % base), likesCount: i === 5 ? -1 : 300 + i, commentsCount: 20 + i,
  videoDuration: 31.5, caption: `Caption ${i} de ${user}`, videoUrl: `https://cdn.example/${user}${i}.mp4`, isPinned: false,
}));
let lastRunInput = null; const runs = {}; let videoDescargas = 0, geminiCalls = 0;
await page.route('https://api.apify.com/**', async (route) => {
  const req = route.request(); const u = new URL(req.url());
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  assert.equal(req.headers().authorization, 'Bearer apify_test');
  let m;
  if ((m = u.pathname.match(/\/acts\/([^/]+)\/runs$/))) {
    lastRunInput = req.postDataJSON(); const id = `run${Object.keys(runs).length}`; runs[id] = { actor: m[1], input: lastRunInput };
    assert.ok(Number(u.searchParams.get('maxTotalChargeUsd')) > 0, 'tope de gasto');
    return json(route, { data: { id, status: 'RUNNING', defaultDatasetId: `ds_${id}` } }, 201);
  }
  if ((m = u.pathname.match(/\/actor-runs\/(\w+)$/))) return json(route, { data: { id: m[1], status: 'SUCCEEDED', defaultDatasetId: `ds_${m[1]}`, finishedAt: new Date().toISOString(), usageTotalUsd: 0.12 } });
  if (u.pathname.startsWith('/v2/key-value-stores/kv1/records/')) return route.fulfill({ status: 200, contentType: 'video/mp4', headers: { 'access-control-allow-origin': '*' }, body: Buffer.alloc(300000, 7) });
  if ((m = u.pathname.match(/\/datasets\/ds_(\w+)\/items$/))) {
    const { actor, input } = runs[m[1]];
    if (actor === 'apify~instagram-profile-scraper' && input.usernames.includes('pegado.uno')) return json(route, [{ username: 'pegado.uno', followersCount: 50000 }, { username: 'pegado.dos', followersCount: 10000 }]);
    if (actor === 'apify~instagram-profile-scraper') return json(route, [{ username: 'ana.coach', followersCount: 8000, private: false }, { username: 'grande', followersCount: 2000000 }, { error: 'not_found', errorDescription: 'Profile does not exist' }]);
    if (actor === 'apify~instagram-reel-scraper') {
      if (input.includeDownloadedVideo) { // "Crear mi versión": descarga el video del reel elegido
        assert.equal(input.username.length, 1); const code = input.username[0].match(/reel\/([^/]+)/)[1]; videoDescargas++;
        return json(route, [{ shortCode: code, ownerUsername: 'pegado.uno', timestamp: new Date(NOW - 40 * DAY).toISOString(), videoPlayCount: 1500000, likesCount: 90000, commentsCount: 800, videoDuration: 31.5, caption: 'Caption del pegado', downloadedVideo: `https://api.apify.com/v2/key-value-stores/kv1/records/video-${code}` }]);
      }
      if (input.username.every((x) => /instagram\.com\/reel\//.test(x))) { // reels pegados por enlace
        assert.deepEqual(input.username, ['https://www.instagram.com/reel/PEG1/', 'https://www.instagram.com/reel/PEG2/']);
        return json(route, [
          { shortCode: 'PEG1', ownerUsername: 'pegado.uno', timestamp: new Date(NOW - 400 * DAY).toISOString(), videoPlayCount: 1200000, likesCount: 80000, commentsCount: 700, videoDuration: 31.5, caption: 'Caption del pegado', videoUrl: 'https://cdn.example/peg1.mp4' },
          { shortCode: 'PEG2', ownerUsername: 'pegado.dos', timestamp: new Date(NOW - 2 * DAY).toISOString(), videoPlayCount: 300000, likesCount: -1, commentsCount: 90, videoDuration: 20, caption: 'Otro', videoUrl: 'https://cdn.example/peg2.mp4' },
        ]);
      }
      assert.deepEqual(input.username, ['ana.coach', 'grande']); assert.equal(input.resultsLimit, 36); return json(route, [...igReels('ana.coach', 9000), ...igReels('grande', 400000).slice(0, 10), { error: 'not_found' }]);
    }
    if (actor === 'apify~instagram-comment-scraper') return json(route, Array.from({ length: 18 }, (_, i) => ({ id: `ig${i}`, text: `Me pasa igual, llevo meses sin conseguir clientes y ya pagué ${100 + i} euros por un curso que no sirvió`, ownerUsername: `iguser${i}`, timestamp: new Date(NOW - 20 * DAY).toISOString(), postUrl: input.directUrls[0] })));
  }
  return json(route, { error: { message: `ruta no simulada ${u.pathname}` } }, 500);
});
const palabras = 'Si eres coach y publicas cada día pero nadie te escribe, mira esto. El error es hablar de ti y no de su problema. Cambia la primera frase por su dolor exacto. Sígueme para ver el ejemplo.'.split(' ');
await page.route('https://api.groq.com/openai/v1/audio/transcriptions', (route) => {
  const body = route.request().postData() || '';
  assert.ok(/name="url"\s+https:\/\/cdn\.example\//.test(body) || /name="file"; filename="reel\.mp4"/.test(body), 'URL o archivo de video'); assert.match(body, /verbose_json/); assert.match(body, /timestamp_granularities\[\]"\s+word/);
  return json(route, { text: palabras.join(' '), language: 'spanish', duration: 31.5, words: palabras.map((w, i) => ({ word: w, start: i * 0.45, end: i * 0.45 + 0.4 })) });
});
let llmCalls = 0;
await page.route('https://api.groq.com/openai/v1/chat/completions', (route) => {
  const b = route.request().postDataJSON(); const u = b.messages[1].content; llmCalls++;
  assert.equal(b.temperature, 0); assert.equal(b.response_format.type, 'json_object');
  let out;
  if (u.includes('cada palabra numerada')) out = { segmentos: [
    { w_inicio: 0, w_fin: 2, seccion: 'gancho', funcion: 'IDE', palabras_gatillo: ['Si eres coach'], mecanismo: 'Nombra a la audiencia', por_que_engancha: 'El coach se reconoce en "Si eres coach"', patron_reutilizable: 'Si eres [audiencia]', confianza: 0.9 },
    { w_inicio: 3, w_fin: 12, seccion: 'gancho', funcion: 'DOL', palabras_gatillo: ['nadie te escribe', 'palabra inventada'], mecanismo: 'Agita el dolor', por_que_engancha: 'Describe publicar sin respuesta', patron_reutilizable: 'y [acción diaria] pero [resultado ausente], mira esto', confianza: 0.85 },
    { w_inicio: 13, w_fin: 23, seccion: 'desarrollo', funcion: 'NEG', palabras_gatillo: ['El error'], mecanismo: 'Señala un error', por_que_engancha: 'Nombra el fallo', patron_reutilizable: 'El error es hablar de ti y no de su problema', confianza: 0.8 },
    { w_inicio: 24, w_fin: 31, seccion: 'resolucion', funcion: 'ESP', palabras_gatillo: ['primera frase'], mecanismo: 'Da un paso concreto', por_que_engancha: 'Es accionable', patron_reutilizable: 'Cambia [elemento] por [dolor exacto de la audiencia]', confianza: 0.8 },
    { w_inicio: 32, w_fin: 36, seccion: 'cta', funcion: 'CTA', palabras_gatillo: ['Sígueme'], mecanismo: 'Pide seguir', por_que_engancha: 'Promete el ejemplo', patron_reutilizable: 'Sígueme para ver [recurso prometido]', confianza: 0.9 },
    { w_inicio: 50, w_fin: 60, funcion: 'CUR' },
  ] };
  else if (u.includes('consultas de búsqueda')) out = { consultas: ['no consigo clientes por instagram', 'como vender coaching online'] };
  else if (u.includes('Comentarios reales')) {
    const lines = [...u.matchAll(/^\[(\d+)\] (.*)$/gm)];
    out = { dolores: lines.map(([, i, t]) => /sin conseguir clientes|no consigo clientes/.test(t)
      ? { i: Number(i), cita: (t.match(/llevo meses sin conseguir clientes|no consigo clientes/) || [''])[0], dolor_normalizado: 'no consigue clientes pese a publicar', emocion: 'frustración', intensidad: 4, senal_pago: /pagué/.test(t), evidencia_pago: (t.match(/pagué \d+ euros por un curso/) || [''])[0], solucion_intentada: '', tipo_necesidad: 'aprender' }
      : { i: Number(i), cita: 'esta cita no existe en el comentario', dolor_normalizado: 'inventado', intensidad: 5, senal_pago: false }) };
  } else if (u.includes('Dolores a clasificar')) out = { asignaciones: [...u.matchAll(/^\[(\d+)\] /gm)].map(([, i]) => ({ i: Number(i), grupo: 'No consigue clientes aunque publica' })) };
  else if (u.includes('Redacta la oferta')) out = { audiencia: 'Coaches de salud', dolor_literal: 'frase que nadie dijo', resultado_medible: '3 llamadas de venta', tiempo: '30 días', mecanismo: 'Guion de dolor exacto', objecion_principal: 'publicar más', frase_oferta: 'Coaches que sufren…', entregables: ['Plantilla'], precio_prueba_hipotesis: '47 € como hipótesis' };
  else if (u.includes('Escribe un guion original')) { const ids = [...u.matchAll(/^(P\d+) \|/gm)].map((x) => x[1]); out = { filas: [
    { t_inicio_s: 0, t_fin_s: 3, texto_hablado: 'Si eres coach de salud, esto te interesa', texto_pantalla: 'Coach de salud', indicacion_visual: 'Rostro a cámara', funcion: 'IDE', patron_id: ids[0] },
    { t_inicio_s: 3, t_fin_s: 20, texto_hablado: 'Publicas a diario y llevas meses sin clientes', texto_pantalla: 'Meses sin clientes', indicacion_visual: 'Corte', funcion: 'DOL', patron_id: ids[1] },
    { t_inicio_s: 20, t_fin_s: 28, texto_hablado: 'Sígueme y te enseño la plantilla', texto_pantalla: 'Sígueme', indicacion_visual: 'Señala', funcion: 'CTA', patron_id: 'P99' },
  ], caption: 'Meses publicando sin clientes #coaching #ventas' }; }
  else if (u.includes('MI VERSIÓN de este reel')) {
    const ids = [...u.matchAll(/^(B\d+) \| /gm)].map((x) => x[1]);
    assert.ok(ids.length >= 3, 'el prompt lista las tomas del original'); assert.match(u, /pantalla grabada/); assert.match(u, /Creo bots de WhatsApp/);
    out = { filas: ids.map((id, k) => ({ toma: id, que_grabas: k === 1 ? 'Grabación de pantalla de mi panel de bots' : 'Primer plano a cámara', edicion: 'Corte seco y subtítulos palabra a palabra', texto_hablado: k === ids.length - 1 ? 'Escríbeme BOT y te monto el tuyo' : k === 1 ? 'Así contesta tu bot mientras duermes' : 'Si tu negocio responde tarde, pierdes ventas', texto_pantalla: k === 1 ? 'BOT 24/7' : '', funcion: k === ids.length - 1 ? 'CTA' : k === 1 ? 'ESP' : 'DOL', que_cambia: 'Herramienta y beneficio de mi servicio' })),
      caption: 'Tu negocio vende mientras duermes #ia #whatsapp', actualizaciones: [{ original: 'Herramienta Vieja 1.0', actual: 'Herramienta Nueva 3', motivo: 'la anterior se retiró', verificar: true }], lista_de_grabacion: ['Grabar pantalla del panel'], que_ensena: 'Cómo responde un bot de WhatsApp' };
  }
  else out = { hashtags: ['coaching'] };
  return json(route, { model: b.model, choices: [{ message: { content: JSON.stringify(out) } }], usage: { total_tokens: 900 } });
});
await page.route('https://generativelanguage.googleapis.com/**', (route) => {
  const req = route.request(); const u = new URL(req.url());
  if (req.method() === 'GET') return json(route, { models: ['gemini-flash-latest', 'gemini-flash-lite-latest'].map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] })) });
  geminiCalls++;
  assert.equal(u.searchParams.get('key'), 'gem_test'); assert.match(u.pathname, /gemini-flash-latest:generateContent$/);
  const b = req.postDataJSON(); const part = b.contents[0].parts[0].inlineData;
  assert.equal(part.mimeType, 'video/mp4'); assert.equal(Buffer.from(part.data, 'base64').length, 300000, 'el video llega completo a Gemini');
  const out = { global: { formato: 'Persona a cámara que alterna con grabación de pantalla', subtitulos: 'Palabra a palabra, amarillos, centro', musica: 'Lo-fi suave', gancho_visual: 'Señala a cámara con texto ERROR', que_ensena: 'Cómo escribir la primera frase', herramientas_mencionadas: [{ nombre: 'Herramienta Vieja 1.0', para_que: 'escribir' }], llamado_accion: 'Seguir la cuenta' },
    tomas: [
      { t_inicio_s: 0, t_fin_s: 1.4, plano: 'primer plano a cámara', que_se_ve: 'Señala a cámara', texto_en_pantalla: 'EL ERROR', edicion: 'zoom rápido', audio: 'voz', voz: 'Si eres coach' },
      { t_inicio_s: 1.4, t_fin_s: 10.8, plano: 'pantalla grabada del móvil', que_se_ve: 'Desplaza un perfil', texto_en_pantalla: 'Nadie te escribe', edicion: 'flecha y círculo', audio: 'voz y música', voz: '' },
      { t_inicio_s: 10.8, t_fin_s: 17, plano: 'primer plano a cámara', que_se_ve: 'Habla y señala abajo', texto_en_pantalla: '', edicion: 'corte seco', audio: 'voz', voz: '' },
      { t_inicio_s: 16, t_fin_s: 99, plano: 'solapada' },
    ] };
  return json(route, { modelVersion: 'gemini-flash-latest', candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] });
});
await page.route('https://www.googleapis.com/youtube/v3/**', (route) => {
  const u = new URL(route.request().url()); assert.equal(u.searchParams.get('key'), 'yt_test');
  if (u.pathname.endsWith('/search')) return json(route, { items: [{ id: { videoId: `v_${u.searchParams.get('q').length}` }, snippet: { title: 'Cómo conseguir clientes', channelTitle: 'Canal' } }] });
  const vid = u.searchParams.get('videoId');
  return json(route, { items: Array.from({ length: 20 }, (_, i) => ({ snippet: { videoId: vid, topLevelComment: { id: `${vid}_c${i}`, snippet: { videoId: vid, textOriginal: i % 4 === 3 ? 'Gran video, gracias' : `Yo publico todos los días y no consigo clientes, caso ${i}`, authorChannelId: { value: `UC${vid}${i}` }, publishedAt: new Date(NOW - 40 * DAY).toISOString() } } } })) });
});

for (const [n, v] of [['Apify', 'apify_test'], ['Groq', 'gsk_test'], ['YouTube Data API', 'yt_test'], ['Gemini', 'gem_test']]) { await keyInput(n).fill(v); await page.waitForTimeout(150); }
// Las claves persisten: se guardan al escribir y siguen ahí tras cerrar y volver a abrir la app.
await page.reload(); await page.waitForSelector('#tabs button[aria-current="page"]:has-text("1 · Proyecto")');
await tab('Configuración'); await page.waitForSelector('h2:has-text("Claves de acceso")');
assert.equal(await keyInput('Apify').inputValue(), 'apify_test'); assert.equal(await keyInput('Groq').inputValue(), 'gsk_test');
assert.match(await page.locator('section.card', { hasText: 'Claves de acceso' }).textContent(), /4 clave\(s\) guardada\(s\) en este navegador/);
const page2 = await ctx.newPage(); await page2.goto('http://localhost:8765/radar/'); await page2.waitForSelector('#tabs button[aria-current="page"]:has-text("1 · Proyecto")');
await page2.close();
console.log('OK las claves persisten tras recargar y al abrir la app en otra pestaña (ya no arranca en Configuración)');

await tab('1 · Proyecto');
await page.fill('input[placeholder^="Ej.: automatizar"]', 'Conseguir clientes para coaches de salud');
await page.fill('input[placeholder^="Ej.: creo bots"]', 'Creo bots de WhatsApp con IA para coaches');
await page.fill('input[placeholder^="Ej.: dueños"]', 'Coaches de salud que venden por Instagram');
await page.click('button:has-text("Crear proyecto")');
await page.waitForSelector('h2:has-text("Referentes")');
for (const hdl of ['@Ana.Coach', 'https://www.instagram.com/grande/', 'noexiste']) { await page.fill('input[aria-label="Usuario del referente"]', hdl); await page.click('button:has-text("Añadir referente")'); await page.waitForTimeout(200); }
assert.equal(await page.locator('section.card:has(h2:has-text("Referentes")) tbody tr').count(), 3);
console.log('OK proyecto y 3 referentes');

await tab('2 · Reels virales');
// Opción 1: reels pegados por enlace (de cualquier fecha)
await page.fill('textarea[placeholder^="https://www.instagram.com/reel/"]', 'https://www.instagram.com/reel/PEG1/?igsh=abc\nhttps://instagram.com/pegado.dos/reel/PEG2/\nhttps://www.instagram.com/pegado.uno/\nhola');
await run('Traer estos reels');
const opc1 = page.locator('section.card:has(h2:has-text("Opción 1"))');
assert.equal(await opc1.locator('tbody tr').count(), 2, await lastLog());
const t1 = await opc1.textContent();
assert.match(t1, /1\.200\.000/); assert.match(t1, /24,0×/); assert.match(t1, /oculto/);
assert.match(await page.$$eval('#activityLog li', (l) => l.map((x) => x.textContent).join('\n')), /no son enlaces de reel[^\n]*pegado\.uno\/, hola/);
console.log('OK reels por enlace: 2 traídos (uno de hace 400 días y otro de 2 días), enlaces inválidos ignorados, seguidores y vistas÷seguidores');

// Crear mi versión: descarga el video, transcribe, Gemini mira las tomas y escribe la versión adaptada
await opc1.locator('tbody tr').first().locator('button:has-text("Crear mi versión")').click();
await page.waitForTimeout(200); await idle();
await page.waitForSelector('#miVersion');
assert.equal(videoDescargas, 1); assert.equal(geminiCalls, 1);
const ver = await page.locator('#miVersion').textContent();
assert.match(ver, /Tu versión para Instagram Reels/); assert.match(ver, /Misma estructura que el original: 3 tomas, 17 s/, ver.slice(0, 800));
assert.match(ver, /pantalla grabada del móvil/); assert.match(ver, /Grabación de pantalla de mi panel de bots/); assert.match(ver, /Escríbeme BOT/);
assert.match(ver, /Herramienta Vieja 1\.0 → Herramienta Nueva 3/); assert.match(ver, /Comprueba que sigan vigentes/);
const det = await page.locator('#reelDetail').textContent();
assert.match(det, /Cómo está hecho \(toma a toma\)/); assert.match(det, /Palabra a palabra, amarillos/); assert.match(det, /«EL ERROR»/); assert.match(det, /1,8 cortes \/ 10 s/);
assert.match(await page.$$eval('#activityLog li', (l) => l.map((x) => x.textContent).join('\n')), /Video recibido en memoria \(0\.3 MB/);
await page.locator('#reelDetail').screenshot({ path: `${SHOTS}/detalle.png` });
await page.locator('#miVersion').screenshot({ path: `${SHOTS}/mi-version.png` });
console.log('OK crear mi versión: video descargado → transcripción → Gemini toma a toma → guion espejo validado con actualización de herramienta');

// Opción 2: ranking de referentes
await page.fill('section.card:has(h2:has-text("Opción 2")) input[type=number]', '36'); await page.keyboard.press('Tab'); await page.waitForTimeout(300);
await run('Revisar 3 cuenta(s)');
const rows = page.locator('section.card:has(h2:has-text("Opción 2")) .tableWrap').nth(1).locator('tbody tr');
assert.equal(await rows.count(), 10, await lastLog());
const primera = await rows.first().textContent();
assert.match(primera, /Mega-viral/); assert.match(primera, /@ana\.coach/);
const orden1 = await rows.allTextContents();
await page.reload(); await page.waitForSelector('h2:has-text("Opción 2")');
assert.deepEqual(await page.locator('section.card:has(h2:has-text("Opción 2")) .tableWrap').nth(1).locator('tbody tr').allTextContents(), orden1);
await page.screenshot({ path: `${SHOTS}/reels.png`, fullPage: true });
console.log('OK ranking de referentes: top 10 con Mega-viral primero, idéntico tras recargar');

await tab('3 · Dolores');
await run('Buscar dolores automáticamente');
const tablero = await page.locator('section.card:has(h2:has-text("Dolores validados"))').textContent();
assert.match(tablero, /1 dolor\(es\) pasan todos los umbrales/, (await lastLog()) + tablero.slice(0, 600));
assert.match(tablero, /válido → infoproducto/); assert.match(tablero, /Google Trends sin verificar/); assert.match(tablero, /señal de pago: «pagué 1\d\d euros por un curso»/);
const stored = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('radar-dolores-reels'); r.onsuccess = () => { const q = r.result.transaction('comments').objectStore('comments').getAll(); q.onsuccess = () => res(q.result); }; }));
assert.ok(stored.length >= 50); assert.ok(stored.filter((c) => c.procesado).every((c) => c.texto === '') && stored.every((c) => /^[0-9a-f]{16}$/.test(c.autor_hash) && !('autor' in c)), 'texto borrado y autor anonimizado');
console.log(`OK dolores: ${stored.length} comentarios leídos, citas literales, texto borrado tras extraer, autores anonimizados`);
await page.screenshot({ path: `${SHOTS}/dolores.png`, fullPage: true });

await tab('4 · Ofertas y guiones');
await run('Generar oferta');
await run('Generar guion');
const gen = await page.locator('main').textContent();
assert.match(gen, /Oferta · Infoproducto/); assert.match(gen, /no coincidía con ninguna cita real/);
assert.match(gen, /Fila 3: no indica un patrón de origen existente/); assert.match(gen, /El guion no pasa la validación/);
console.log('OK generador: oferta con cita real sustituida; guion con patrón inexistente marcado como error');
await page.screenshot({ path: `${SHOTS}/generador.png`, fullPage: true });

await tab('5 · Informe');
await page.waitForSelector('h2:has-text("Procedencia de los datos")');
const inf = await page.locator('main').textContent();
for (const re of [/Reels más virales/, /Procedencia de los datos/, /reels instagram/, /comentarios youtube/, /\$0\.12/]) assert.match(inf, re);
await page.screenshot({ path: `${SHOTS}/informe.png`, fullPage: true });
console.log('OK informe con procedencia');

await page.setViewportSize({ width: 390, height: 800 });
await tab('2 · Reels virales');
await page.waitForSelector('h2:has-text("Opción 2")');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
assert.ok(overflow <= 1, `desborde horizontal en móvil: ${overflow}px`);
await page.screenshot({ path: `${SHOTS}/movil.png` });
console.log('OK móvil sin desborde horizontal');

assert.deepEqual(errores, [], errores.join('\n'));
console.log(`\nTODO OK · ${llmCalls} llamadas LLM simuladas · sin errores de consola`);
await browser.close(); server.close();
