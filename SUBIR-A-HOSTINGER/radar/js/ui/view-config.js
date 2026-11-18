// Configuración: claves, prueba real de cada conexión, modelos, umbrales, consumo y respaldo.

import { h, field, input, btn, note, fmt, download } from './dom.js';
import { DEFAULT_THRESHOLDS, THRESHOLD_LABELS, DEFAULT_MODELS, DAILY_LIMITS, formulaVersion } from '../core/config.js';
import { getSettings, saveSettings, getCounters, db, storageOk, pedirPersistencia, exportZip, importBackup } from '../services/store.js';
import { apifyAccount } from '../services/apify.js';
import { testProveedor } from '../services/llm.js';
import { ytTest } from '../services/media.js';

const PROVEEDORES = [
  {
    id: 'apify', nombre: 'Apify', obligatorio: true, para: 'Trae las métricas reales de los reels (vistas, likes, comentarios, seguidores).',
    pasos: ['Crea una cuenta gratis en apify.com (sin tarjeta; incluye $5 de crédito al mes).', 'Entra en console.apify.com.', 'Abre Settings → API & Integrations.', 'Copia el "Personal API token" y pégalo aquí.'],
    url: 'https://console.apify.com/settings/integrations',
    test: async () => { const a = await apifyAccount(); return `Conectado como "${a.usuario}"${a.plan ? ` (plan ${a.plan})` : ''}.${a.usoMesUsd != null ? ` Consumo de este mes: ${fmt.usd(a.usoMesUsd)}${a.limiteMesUsd != null ? ` de ${fmt.usd(a.limiteMesUsd)}` : ''}.` : ''}`; },
  },
  {
    id: 'groq', nombre: 'Groq', obligatorio: true, para: 'Transcribe los reels (Whisper) y hace el análisis con IA.',
    pasos: ['Crea una cuenta gratis en console.groq.com (sin tarjeta).', 'Abre API Keys → Create API Key.', 'Copia la clave (solo se muestra una vez) y pégala aquí.'],
    url: 'https://console.groq.com/keys',
    test: async () => { const r = await testProveedor('groq'); if (r.faltan.length) throw new Error(`La clave funciona, pero tu cuenta no tiene estos modelos: ${r.faltan.join(', ')}. Cámbialos en "Modelos".`); return `Clave válida. Modelos configurados disponibles (${r.ids.length} modelos en la cuenta).`; },
  },
  {
    id: 'youtube', nombre: 'YouTube Data API', obligatorio: false, para: 'Lee comentarios de videos de YouTube para encontrar dolores. Necesaria para la pestaña Dolores.',
    pasos: ['Entra en console.cloud.google.com y crea un proyecto.', 'APIs y servicios → Biblioteca → busca "YouTube Data API v3" → Habilitar.', 'APIs y servicios → Credenciales → Crear credenciales → Clave de API.', 'Copia la clave y pégala aquí.'],
    url: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com',
    test: async () => { await ytTest(); return 'Clave válida: YouTube respondió a una consulta real (1 unidad de cuota).'; },
  },
  {
    id: 'gemini', nombre: 'Gemini', obligatorio: true, para: 'Mira el video de cada reel y describe toma por toma qué se ve, el texto en pantalla y la edición: sin ella tu versión solo copia lo que se dice. También es el respaldo si Groq agota su cupo. El nivel gratuito puede usar los datos para entrenamiento.',
    pasos: ['Entra en aistudio.google.com.', 'Pulsa "Get API key" → Create API key.', 'Copia la clave y pégala aquí.'],
    url: 'https://aistudio.google.com/apikey',
    test: async () => { const r = await testProveedor('gemini'); if (r.faltan.length) throw new Error(`La clave funciona, pero estos modelos no están en tu cuenta: ${r.faltan.join(', ')}. Disponibles: ${r.ids.filter((x) => /flash/.test(x)).slice(0, 8).join(', ')}. Cámbialos en "Modelos".`); return 'Clave válida: Gemini puede analizar lo visual de los reels.'; },
  },
  {
    id: 'openrouter', nombre: 'OpenRouter (respaldo)', obligatorio: false, para: 'Tercer recurso, con modelos gratuitos (50 solicitudes al día).',
    pasos: ['Crea una cuenta en openrouter.ai.', 'Abre Keys → Create Key.', 'Copia la clave y pégala aquí.'],
    url: 'https://openrouter.ai/keys',
    test: async () => { const r = await testProveedor('openrouter'); if (r.faltan.length) throw new Error(`La clave funciona, pero el modelo "${r.faltan[0]}" ya no figura como gratuito. Gratuitos hoy: ${r.ids.slice(0, 8).join(', ')}.`); return 'Clave válida y modelo gratuito disponible.'; },
  },
];

export async function viewConfig(app) {
  const s = getSettings();
  const out = [];

  // --- Claves ---
  const claves = h('section', { class: 'card' },
    h('h2', {}, 'Claves de acceso'),
    h('p', { class: 'hint' }, 'Todas son gratuitas. Se pegan una sola vez: quedan guardadas en este navegador y se envían únicamente a su proveedor. Necesitas Apify, Groq y Gemini; YouTube es para buscar los dolores de tu audiencia.'));
  const guardadas = Object.values(s.keys).filter(Boolean).length;
  if (!storageOk()) claves.append(note('bad', 'Este navegador no está guardando datos, por eso las claves se pierden al cerrar. Suele pasar en ventanas de incógnito o privadas, o al abrir el enlace desde dentro de otra app (WhatsApp, Instagram). Abre la app en una ventana normal de Chrome, Safari o Edge.'));
  else if (guardadas) claves.append(note('ok', `${guardadas} clave(s) guardada(s) en este navegador (${location.host}). No tienes que volver a pegarlas mientras uses este mismo navegador y esta misma dirección.`));
  const keyFile = h('input', { type: 'file', accept: 'application/json', hidden: true });
  keyFile.addEventListener('change', async () => {
    const f = keyFile.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d?.app !== 'radar-claves' || typeof d.keys !== 'object') throw new Error('no es un archivo de claves de esta app');
      const cur = getSettings();
      const keys = { ...cur.keys };
      for (const k of Object.keys(cur.keys)) if (typeof d.keys[k] === 'string' && d.keys[k]) keys[k] = d.keys[k];
      saveSettings({ keys, models: { ...cur.models, ...(d.models || {}) } });
      app.log('Claves cargadas desde el archivo.', 'done');
      await app.render();
    } catch (e) { alert(`No se pudo leer el archivo: ${e.message}`); }
  });
  claves.append(h('div', { class: 'row' },
    btn('Guardar mis claves en un archivo', () => {
      const cur = getSettings();
      if (!Object.values(cur.keys).some(Boolean)) { alert('Aún no hay claves guardadas.'); return; }
      download('radar-mis-claves.json', JSON.stringify({ app: 'radar-claves', keys: cur.keys, models: cur.models }));
    }, 'alt'),
    btn('Cargar archivo de claves', () => keyFile.click(), 'alt'), keyFile),
    h('p', { class: 'hint' }, 'El archivo sirve para no volver a pegarlas si cambias de navegador, de equipo o de dirección web: lo cargas y listo. Guárdalo en un lugar privado; quien lo tenga puede gastar tu crédito.'));
  for (const p of PROVEEDORES) {
    const inp = input({ type: 'password', value: s.keys[p.id], placeholder: `Pega aquí tu clave de ${p.nombre}`, 'aria-label': `Clave de ${p.nombre}` });
    const res = h('div', {});
    const guardar = () => { const cur = getSettings(); saveSettings({ keys: { ...cur.keys, [p.id]: inp.value.trim() } }); pedirPersistencia(); };
    inp.addEventListener('input', guardar); // se guarda al instante, sin esperar a salir del campo
    const probar = btn('Probar', async () => {
      guardar();
      if (!inp.value.trim()) { res.replaceChildren(note('warn', 'Pega primero la clave.')); return; }
      res.replaceChildren(note('', 'Probando…'));
      try { res.replaceChildren(note('ok', await p.test())); }
      catch (e) { res.replaceChildren(note('bad', e.message)); }
    }, 'alt always');
    claves.append(
      h('h3', {}, p.nombre, ' ', h('span', { class: `pill ${p.obligatorio ? 'viral' : ''}` }, p.obligatorio ? 'necesaria' : 'opcional'), ' ',
        s.keys[p.id] ? h('span', { class: 'pill ok' }, 'guardada') : null),
      h('p', { class: 'hint' }, p.para),
      h('details', { open: !s.keys[p.id] && p.obligatorio }, h('summary', {}, 'Cómo conseguirla'),
        h('ol', { class: 'steps' }, p.pasos.map((x) => h('li', {}, x)), h('li', {}, h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir la página')))),
      h('div', { class: 'row' }, h('div', { class: 'field' }, inp), probar),
      res,
    );
  }
  out.push(claves);

  // --- Consumo ---
  const c = getCounters();
  const filas = Object.entries(DAILY_LIMITS).flatMap(([prov, lim]) => Object.entries(lim).map(([k, max]) => ({ prov, k, uso: c.uso[prov]?.[k] || 0, max })));
  out.push(h('section', { class: 'card' },
    h('h2', {}, 'Consumo de hoy'),
    h('p', { class: 'hint' }, `Contadores de este navegador para el día ${c.dia} (UTC), comparados con los límites gratuitos de referencia de noviembre de 2026. El límite real lo aplica cada proveedor; revisa su panel.`),
    h('div', { class: 'kpis' }, filas.map((f) => h('div', { class: 'kpi' }, h('b', {}, `${fmt.n(f.uso)} / ${fmt.n(f.max)}`), h('span', {}, `${f.prov} · ${f.k}`))))));

  // --- Modelos ---
  const modelos = h('section', { class: 'card' }, h('h2', {}, 'Modelos'),
    h('p', { class: 'hint' }, 'Los nombres de modelo cambian con el tiempo. Si "Probar" avisa de que uno no existe, cámbialo aquí.'));
  const grid = h('div', { class: 'grid2' });
  const NOMBRES = { groqStt: 'Groq · transcripción', groqLlm: 'Groq · análisis', gemini: 'Gemini · respaldo de texto', geminiVideo: 'Gemini · análisis del video', openrouter: 'OpenRouter' };
  for (const k of Object.keys(DEFAULT_MODELS)) {
    const i = input({ value: s.models[k] });
    i.addEventListener('change', () => { const cur = getSettings(); saveSettings({ models: { ...cur.models, [k]: i.value.trim() || DEFAULT_MODELS[k] } }); });
    grid.append(field(NOMBRES[k], i, `Por defecto: ${DEFAULT_MODELS[k]}`));
  }
  modelos.append(grid);
  out.push(modelos);

  // --- Umbrales ---
  const um = h('section', { class: 'card' }, h('h2', {}, 'Fórmulas y umbrales'),
    h('p', { class: 'hint' }, `Versión de fórmula activa: ${formulaVersion(s.thresholds)}. Los valores por defecto son la propuesta del plan; calíbralos con tus primeros proyectos. Cada cambio genera una versión nueva, que queda guardada con cada resultado.`));
  const g2 = h('div', { class: 'grid2' });
  for (const k of Object.keys(DEFAULT_THRESHOLDS)) {
    const i = input({ type: 'number', step: 'any', min: '0', value: s.thresholds[k] });
    i.addEventListener('change', async () => {
      const v = Number(i.value);
      if (!Number.isFinite(v) || v < 0) { i.value = getSettings().thresholds[k]; return; }
      const cur = getSettings(); saveSettings({ thresholds: { ...cur.thresholds, [k]: v } });
      await app.render();
    });
    g2.append(field(THRESHOLD_LABELS[k], i, `Por defecto: ${String(DEFAULT_THRESHOLDS[k]).replace('.', ',')}`));
  }
  um.append(g2, h('div', { class: 'row' }, btn('Restaurar valores por defecto', async () => { saveSettings({ thresholds: { ...DEFAULT_THRESHOLDS } }); await app.render(); }, 'alt')));
  out.push(um);

  // --- Datos ---
  out.push(await tarjetaDatos(app));
  return out;
}

const MB = (b) => `${(b / 1048576).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MB`;

/** Descarga la copia completa (datos + videos) y anota la fecha. */
export async function descargarCopia(app, soloDatos = false) {
  await app.run(soloDatos ? 'Copia de los datos' : 'Copia completa', async (log) => {
    const fecha = new Date().toISOString().slice(0, 10);
    if (soloDatos) download(`radar-datos-${fecha}.json`, JSON.stringify(await db.exportAll()));
    else {
      const zip = await exportZip(log);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(zip); a.download = `radar-copia-completa-${fecha}.zip`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      log(`Copia descargada (${MB(zip.size)}).`);
    }
    saveSettings({ ultimoRespaldo: new Date().toISOString() });
  });
}

async function tarjetaDatos(app) {
  const s = getSettings();
  const [nP, nR, nT, nO, videos] = await Promise.all([db.count('projects'), db.count('reels'), db.count('transcripts'), db.count('outputs'), db.all('videos')]);
  const pesoVideos = videos.reduce((a, v) => a + (v.size || 0), 0);
  let estimado = null;
  try { estimado = await navigator.storage?.estimate?.(); } catch { /* no disponible */ }
  let persistente = null;
  try { persistente = await navigator.storage?.persisted?.(); } catch { /* no disponible */ }
  const file = h('input', { type: 'file', accept: '.zip,.json,application/zip,application/json', hidden: true });
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    await app.run('Importar copia', async (log) => { const r = await importBackup(f); log(`${r.registros} registros y ${r.videos} video(s) importados. No se borró nada de lo que ya tenías.`); });
  });
  const chk = h('input', { type: 'checkbox', checked: s.guardarVideos });
  chk.addEventListener('change', () => saveSettings({ guardarVideos: chk.checked }));
  return h('section', { class: 'card', id: 'tusDatos' }, h('h2', {}, 'Tus datos'),
    h('p', { class: 'hint' }, 'Todo lo que traes y analizas se guarda solo, en este navegador: proyectos, cifras de cada reel (aunque solo hayas traído los datos), transcripciones, análisis toma a toma, gatillos, dolores, tus versiones y los videos. Actualizar la app desde la pestaña Deploys de Netlify no borra nada.'),
    h('div', { class: 'kpis' },
      [['Proyectos', nP], ['Reels guardados', nR], ['Reels analizados', nT], ['Guiones y ofertas', nO], ['Videos guardados', `${videos.length} · ${MB(pesoVideos)}`],
        ['Espacio usado / disponible', estimado?.quota ? `${MB(estimado.usage || 0)} / ${MB(estimado.quota)}` : '—']]
        .map(([k, v]) => h('div', { class: 'kpi' }, h('b', { style: 'font-size:1rem' }, typeof v === 'number' ? fmt.n(v) : v), h('span', {}, k)))),
    h('label', { class: 'row', style: 'align-items:center;gap:.5rem' }, chk, h('span', {}, 'Guardar los videos que se analizan (así puedes volver a verlos y reanalizarlos sin pagar otra descarga).')),
    persistente === false ? note('warn', 'El navegador todavía no ha marcado estos datos como permanentes: si el disco se llena, podría borrarlos. La app ya lo ha solicitado; tener una copia descargada te protege igualmente.') : null,
    note(s.ultimoRespaldo ? '' : 'warn', s.ultimoRespaldo ? `Última copia descargada: ${fmt.fechaHora(s.ultimoRespaldo)}.` : 'Aún no has descargado ninguna copia. Los datos del navegador se pierden si los borras, si cambias de equipo o si abres la app desde otra dirección.'),
    h('div', { class: 'row' },
      btn('Descargar copia completa (ZIP con videos)', () => descargarCopia(app)),
      btn('Descargar solo los datos (JSON)', () => descargarCopia(app, true), 'alt'),
      btn('Importar copia (ZIP o JSON)', () => file.click(), 'alt'), file),
    h('p', { class: 'hint' }, 'Importar una copia la suma a lo que ya tienes, sin borrar nada. Sirve para pasar todo a otro navegador, a otro equipo o a otra dirección de la app. Los autores de los comentarios se guardan como un código anónimo.'));
}
