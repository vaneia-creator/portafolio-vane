// M2: elegir reels que funcionaron (por enlace o por ranking de referentes) y crear "mi versión" de cada uno.

import { h, btn, note, input, fmt, table, link, empty, fnChip, etiquetaPill, download, toCSV } from './dom.js';
import { db, getSettings, saveSettings } from '../services/store.js';
import { ingestMetrics, ranking, analizarReel, crearMiVersion, addReelsByUrl, costoEstimado } from '../pipeline.js';
import { embedUrl } from '../core/normalize.js';
import { TAXONOMY, NETWORKS, ACTORS } from '../core/config.js';
import { renderOutput } from './view-generator.js';

function marcar(texto, gatillos) {
  let partes = [texto];
  for (const g of gatillos || []) {
    partes = partes.flatMap((p) => {
      if (typeof p !== 'string') return [p];
      const i = p.toLowerCase().indexOf(g.toLowerCase());
      if (i < 0 || !g) return [p];
      return [p.slice(0, i), h('mark', {}, p.slice(i, i + g.length)), p.slice(i + g.length)];
    });
  }
  return partes;
}

export function renderAnotaciones(anot) {
  return anot.sort((a, b) => a.w_inicio - b.w_inicio).map((a) => h('div', { class: 'seg', style: `border-left-color:${TAXONOMY[a.funcion]?.color || 'var(--muted)'}` },
    h('div', { class: 'meta' }, fnChip(a.funcion), h('b', {}, TAXONOMY[a.funcion]?.nombre || 'Sin gatillo'), h('span', {}, a.seccion),
      h('span', { class: 'mono' }, `${fmt.t(a.start_ms)} → ${fmt.t(a.end_ms)}`), a.confianza != null ? h('span', {}, `confianza ${fmt.d(a.confianza)}`) : null),
    h('blockquote', {}, '«', marcar(a.texto_exacto, a.palabras_gatillo), '»'),
    a.funcion !== 'sin_gatillo' ? h('dl', {},
      h('dt', {}, 'Mecanismo'), h('dd', {}, a.mecanismo || '—'),
      h('dt', {}, 'Por qué engancha'), h('dd', {}, a.por_que || '—'),
      h('dt', {}, 'Patrón'), h('dd', {}, a.patron || 'sin patrón reutilizable')) : null,
    a.avisos?.length ? h('p', { class: 'hint' }, `Validación: ${a.avisos.join('; ')}.`) : null));
}

export function renderVisual(v) {
  return h('div', {},
    h('div', { class: 'kpis' },
      [['Formato', v.formato || '—'], ['Ritmo', v.cortes_por_10s == null ? '—' : `${fmt.d(v.cortes_por_10s, 1)} cortes / 10 s`], ['Subtítulos', v.subtitulos || 'no hay'], ['Música', v.musica || 'no hay']]
        .map(([k, x]) => h('div', { class: 'kpi' }, h('b', { style: 'font-size:.95rem' }, x), h('span', {}, k)))),
    v.gancho_visual ? h('p', { class: 'hint', style: 'margin-top:.5rem' }, `Gancho visual (primer segundo): ${v.gancho_visual}`) : null,
    v.que_ensena ? h('p', { class: 'hint' }, `Qué enseña: ${v.que_ensena}`) : null,
    v.herramientas?.length ? h('p', { class: 'hint' }, `Herramientas que aparecen: ${v.herramientas.map((x) => `${x.nombre}${x.para_que ? ` (${x.para_que})` : ''}`).join(' · ')}`) : null,
    table([
      { h: 'Toma', v: (t) => h('span', {}, h('b', {}, t.id), h('br'), h('span', { class: 'mono' }, `${t.t_inicio_s}–${t.t_fin_s} s`)) },
      { h: 'Plano', wrap: true, v: (t) => t.plano || '—' },
      { h: 'Qué se ve', wrap: true, v: (t) => t.que_se_ve || '—' },
      { h: 'Texto en pantalla', wrap: true, v: (t) => (t.texto_en_pantalla ? `«${t.texto_en_pantalla}»` : '—') },
      { h: 'Edición', wrap: true, v: (t) => t.edicion || '—' },
      { h: 'Audio', wrap: true, v: (t) => t.audio || '—' },
    ], v.tomas));
}

export async function viewReels(app) {
  const p = app.project;
  const s = getSettings();
  const out = [];
  const R = await ranking(p);
  const { creators, reels } = R;
  const trans = await db.byProject('transcripts', p.id);
  const anot = await db.byProject('annotations', p.id);
  const outputs = (await db.byProject('outputs', p.id)).filter((o) => o.tipo === 'espejo');
  const reelDe = new Map(reels.map((r) => [r.id, r]));
  const creDe = new Map(creators.map((c) => [c.id, c]));
  const st = (app.state.reels ||= { red: p.red_objetivo || 'instagram', enlaces: '' });

  const abrir = (id) => { app.state.reelId = id; app.render().then(() => document.getElementById('reelDetail')?.scrollIntoView({ behavior: 'smooth' })); };
  const crear = (r) => {
    if (!s.keys.apify || !s.keys.groq) { alert('Faltan las claves de Apify y Groq (Configuración).'); return; }
    if (!p.nicho_usuario) { alert('Primero escribe tu servicio (lo que vendes) en la pestaña Proyecto.'); app.go('proyecto'); return; }
    if (!s.keys.gemini && !confirm('Sin la clave de Gemini tu versión solo copiará lo que se dice, no lo visual ni la edición. ¿Continuar igualmente?')) return;
    app.state.reelId = r.id;
    app.run('Crear mi versión', async (log) => { await crearMiVersion(p, r, st.red, log); }).then(() => document.getElementById('miVersion')?.scrollIntoView({ behavior: 'smooth' }));
  };
  const estado = (id) => {
    const t = trans.find((x) => x.reel_id === id);
    if (outputs.some((o) => o.reel_id === id)) return h('span', { class: 'pill ok' }, 'versión creada');
    if (t?.visual) return h('span', { class: 'pill warn' }, 'analizado');
    if (t) return h('span', { class: 'pill warn' }, 'solo audio');
    return h('span', { class: 'pill' }, 'pendiente');
  };
  const redSel = h('select', {}, Object.entries(NETWORKS).map(([k, v]) => h('option', { value: k, selected: st.red === k }, v.nombre)));
  redSel.addEventListener('change', () => { st.red = redSel.value; });

  // --- Cómo funciona ---
  out.push(h('section', { class: 'card' },
    h('h2', {}, 'Replica reels que ya funcionaron'),
    h('p', { class: 'hint' }, `Eliges un reel que funcionó y pulsas "Crear mi versión". La app descarga el video, transcribe lo que se dice, Gemini mira cada toma (plano, texto en pantalla, edición) y escribe tu guion con la misma estructura, el mismo visual y la misma edición, enseñando lo equivalente de tu servicio${p.nicho_usuario ? ` («${p.nicho_usuario}»)` : ''}. Si el original usa una herramienta antigua, la cambia por la actual y te lo señala.`),
    h('div', { class: 'row' }, h('label', { class: 'field', style: 'flex:0 1 260px' }, h('span', {}, 'Red donde publicarás tu versión'), redSel)),
    !p.nicho_usuario ? note('warn', 'Falta tu servicio en la pestaña Proyecto: es lo que la app usa para adaptar cada reel a lo que vendes.') : null,
    !s.keys.gemini ? note('warn', 'Falta la clave de Gemini (Configuración): sin ella no se puede copiar lo visual ni la edición.') : null));

  // --- Opción 1: enlaces ---
  const ta = h('textarea', { placeholder: 'https://www.instagram.com/reel/…\nhttps://www.tiktok.com/@cuenta/video/…' }, st.enlaces);
  ta.addEventListener('input', () => { st.enlaces = ta.value; });
  const elegidos = reels.filter((r) => r.elegido).sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
  const cardA = h('section', { class: 'card' },
    h('h2', {}, 'Opción 1 · Pega los reels que sabes que funcionaron'),
    h('p', { class: 'hint' }, 'La forma más directa y barata: tú eliges los reels (de cualquier fecha). Uno por línea, de Instagram o TikTok.'),
    h('div', { class: 'row' }, h('div', { class: 'field' }, ta)),
    h('div', { class: 'row' }, btn('Traer estos reels', () => {
      if (!s.keys.apify) { alert('Falta el token de Apify (Configuración).'); return; }
      if (!st.enlaces.trim()) { alert('Pega al menos un enlace.'); return; }
      app.run('Traer reels por enlace', async (log) => { const n = await addReelsByUrl(p, st.enlaces, log); log(`${n} reel(s) añadidos.`); st.enlaces = ''; });
    })),
    h('p', { class: 'hint' }, `Traer las cifras cuesta ${fmt.usd(ACTORS.igReels.usdPorResultado)} por reel. "Crear mi versión" descarga además el video: en Instagram Apify cobra ${fmt.usd(ACTORS.igReels.usdPorMBVideo)} por cada MB; en TikTok, ${fmt.usd(ACTORS.ttVideos.usdPorVideo)} por video. El costo real queda registrado en la actividad.`));
  if (elegidos.length) {
    cardA.append(table([
      { h: 'Reel', wrap: true, v: (r) => h('span', {}, link(r.url, `@${creDe.get(r.creator_id)?.handle || '—'}`), ' · ', fmt.fecha(r.posted_at), h('br'), h('span', { class: 'muted' }, (r.caption || 'sin caption').slice(0, 70))) },
      { h: 'Vistas', n: true, v: (r) => fmt.n(r.views) },
      { h: 'Seguidores', n: true, v: (r) => fmt.n(creDe.get(r.creator_id)?.followers) },
      { h: 'Vistas ÷ seguidores', n: true, v: (r) => { const f = creDe.get(r.creator_id)?.followers; return f && r.views != null ? `${fmt.d(r.views / f, 1)}×` : '—'; } },
      { h: 'Likes', n: true, v: (r) => (r.likes == null ? 'oculto' : fmt.n(r.likes)) },
      { h: 'Estado', v: (r) => estado(r.id) },
      { h: '', v: (r) => h('span', { style: 'display:flex;gap:.3rem' }, btn('Crear mi versión', () => crear(r), 'small'), btn('Ver', () => abrir(r.id), 'small alt')) },
    ], elegidos));
  }
  out.push(cardA);

  // --- Opción 2: ranking de referentes ---
  const refs = creators.filter((c) => c.origen !== 'enlace');
  const porPerfil = s.captura.reelsPorCuenta;
  const ig = refs.filter((c) => c.plataforma === 'instagram').length, tt = refs.length - ig;
  const est = (ig ? costoEstimado('igProfiles', ig) + costoEstimado('igReels', ig * porPerfil) : 0) + (tt ? costoEstimado('ttVideos', tt * porPerfil) : 0);
  const cardB = h('section', { class: 'card' },
    h('h2', {}, 'Opción 2 · Encuentra los virales de tus referentes'),
    h('p', { class: 'hint' }, 'Revisa los últimos reels de cada cuenta y los ordena por cuánto destacan frente a lo normal de esa cuenta (Instagram no permite pedir directamente "los más vistos"). Los referentes se añaden en la pestaña Proyecto.'));
  if (!refs.length) cardB.append(h('div', { class: 'row' }, btn('Añadir referentes', () => app.go('proyecto'), 'alt')));
  else {
    const nReels = input({ type: 'number', min: '8', max: '50', value: porPerfil });
    nReels.addEventListener('change', async () => {
      const v = Math.min(50, Math.max(8, Math.round(Number(nReels.value)) || 20));
      saveSettings({ captura: { ...getSettings().captura, reelsPorCuenta: v } });
      await app.render();
    });
    cardB.append(
      h('div', { class: 'row' }, h('label', { class: 'field', style: 'flex:0 1 230px' }, h('span', {}, 'Reels a revisar por cuenta'), nReels, h('small', {}, 'Solo cifras; no se descarga ningún video.')),
        btn(reels.some((r) => !r.elegido) ? 'Volver a revisar las cuentas' : `Revisar ${refs.length} cuenta(s)`, () => {
          if (!s.keys.apify) { alert('Falta el token de Apify (Configuración).'); return; }
          app.run('Revisar cuentas', async (log) => { for (const r of await ingestMetrics(p, log)) log(`@${r.handle}: ${r.reels} reels, ${r.followers == null ? 'seguidores no disponibles' : fmt.n(r.followers) + ' seguidores'}.`); });
        })),
      h('p', { class: 'hint' }, `Costo máximo estimado: ${fmt.usd(est)} de tu crédito de Apify.`),
      porPerfil < s.thresholds.minReels ? note('warn', `Con ${porPerfil} reels por cuenta no se alcanza el mínimo de ${s.thresholds.minReels} para comparar. `,
        btn(`Bajar el mínimo a ${Math.max(5, porPerfil - 2)}`, async () => { saveSettings({ thresholds: { ...getSettings().thresholds, minReels: Math.max(5, porPerfil - 2) } }); await app.render(); }, 'small alt')) : null);
    const conDatos = refs.filter((c) => reels.some((r) => r.creator_id === c.id && !r.elegido));
    if (conDatos.length) {
      cardB.append(h('details', {}, h('summary', {}, 'Base de cálculo por cuenta'), table([
        { h: 'Cuenta', v: (c) => `@${c.handle}` },
        { h: 'Seguidores', n: true, v: (c) => fmt.n(c.followers) },
        { h: 'Reels revisados', n: true, v: (c) => fmt.n(reels.filter((r) => r.creator_id === c.id).length) },
        { h: 'Mediana de vistas', n: true, v: (c) => fmt.n(R.porCreador[c.id]?.mediana) },
        { h: 'Estado', wrap: true, v: (c) => { const r = R.porCreador[c.id]; if (c.error) return h('span', { class: 'pill bad' }, c.error); return r?.estado === 'ok' ? h('span', { class: 'pill ok' }, 'en el ranking') : h('span', { class: 'pill warn' }, r?.motivo || '—'); } },
      ], conDatos)));
      const cols = [
        { h: '#', n: true, v: (x) => R.rows.indexOf(x) + 1 },
        { h: 'Reel', wrap: true, v: (x) => { const r = reelDe.get(x.reel_id); return h('span', {}, link(r.url, `@${creDe.get(r.creator_id)?.handle}`), ' · ', fmt.fecha(r.posted_at), h('br'), h('span', { class: 'muted' }, (r.caption || 'sin caption').slice(0, 70))); } },
        { h: 'Etiqueta', v: (x) => etiquetaPill(x.etiqueta) },
        { h: 'Vistas', n: true, v: (x) => fmt.n(x.views) },
        { h: 'vs. su normal', n: true, title: 'Vistas ÷ mediana de la cuenta (OS)', v: (x) => `${fmt.d(x.os, 1)}×` },
        { h: 'vs. seguidores', n: true, title: 'Vistas ÷ seguidores (AR)', v: (x) => (x.ar == null ? '—' : `${fmt.d(x.ar, 1)}×`) },
        { h: 'Score', n: true, title: '0,5·z + 0,3·ln(OS) + 0,2·percentil(EV)', v: (x) => fmt.d(x.score) },
        { h: 'Estado', v: (x) => estado(x.reel_id) },
        { h: '', v: (x) => h('span', { style: 'display:flex;gap:.3rem' }, btn('Crear mi versión', () => crear(reelDe.get(x.reel_id)), 'small'), btn('Ver', () => abrir(x.reel_id), 'small alt')) },
      ];
      const csvCols = [
        { h: 'posicion', v: (x) => R.rows.indexOf(x) + 1 }, { h: 'url', v: (x) => reelDe.get(x.reel_id).url }, { h: 'cuenta', v: (x) => creDe.get(reelDe.get(x.reel_id).creator_id)?.handle },
        { h: 'publicado', v: (x) => reelDe.get(x.reel_id).posted_at }, { h: 'etiqueta', v: (x) => x.etiqueta }, { h: 'score', v: (x) => x.score }, { h: 'vistas', v: (x) => x.views },
        { h: 'os', v: (x) => x.os }, { h: 'ar', v: (x) => x.ar }, { h: 'z', v: (x) => x.z }, { h: 'ev', v: (x) => x.ev }, { h: 'formula_version', v: () => R.formula_version }, { h: 'capturado', v: (x) => reelDe.get(x.reel_id).captured_at },
      ];
      if (!R.rows.length) cardB.append(note('warn', 'Dato insuficiente: ninguna cuenta alcanza el mínimo de reels para comparar.'));
      else cardB.append(
        h('h3', {}, `Los ${Math.min(10, R.rows.length)} que más destacan`),
        table(cols, R.rows.slice(0, 10)),
        h('div', { class: 'row' }, btn('Descargar ranking (CSV)', () => download('ranking-reels.csv', toCSV(csvCols, R.rows), 'text/csv'), 'alt')),
        R.rows.length > 10 ? h('details', {}, h('summary', {}, `Ver los ${R.rows.length} reels`), table(cols, R.rows)) : null);
    }
  }
  out.push(cardB);

  // --- Detalle ---
  const r = reelDe.get(app.state.reelId);
  if (r) {
    const t = trans.find((y) => y.reel_id === r.id);
    const an = anot.filter((a) => a.reel_id === r.id);
    const mias = outputs.filter((o) => o.reel_id === r.id).sort((a, b) => (a.creado < b.creado ? 1 : -1));
    const fila = R.rows.find((x) => x.reel_id === r.id);
    const file = h('input', { type: 'file', accept: 'video/*', hidden: true });
    file.addEventListener('change', () => { const f = file.files[0]; if (f) app.run('Analizar archivo de video', (log) => analizarReel(p, r, { archivo: f, onLog: log })); });
    const src = embedUrl(r);
    const der = h('div', {},
      h('div', { class: 'kpis' },
        [['Vistas', fmt.n(r.views)], ['Likes', r.likes == null ? 'oculto' : fmt.n(r.likes)], ['Comentarios', fmt.n(r.comments)],
          ['Compartidos', r.shares == null ? 'no disponible' : fmt.n(r.shares)], ['Duración', r.duration_s == null ? '—' : `${fmt.d(r.duration_s, 1)} s`]]
          .map(([k, v]) => h('div', { class: 'kpi' }, h('b', {}, v), h('span', {}, k)))),
      h('p', { class: 'hint', style: 'margin-top:.6rem' }, `Fuente: ${r.fuente_dato}. Capturado el ${fmt.fechaHora(r.captured_at)}.`),
      h('div', { class: 'row noprint' },
        btn(mias.length ? 'Crear otra versión' : 'Crear mi versión', () => crear(r)),
        btn(t ? 'Volver a analizar' : 'Solo analizar', () => app.run('Análisis del reel', (log) => analizarReel(p, r, { onLog: log })), 'alt'),
        btn('Subir archivo de video', () => file.click(), 'alt'), file));
    if (t?.visual_error && !t.visual) der.append(note('warn', `Sin análisis visual: ${t.visual_error}`));
    if (t?.visual) der.append(h('h3', { class: 'sub3' }, 'Cómo está hecho (toma a toma)'), h('p', { class: 'hint' }, `Observado por ${t.visual.modelo} mirando el video.`), renderVisual(t.visual));
    if (t?.texto) der.append(h('details', {}, h('summary', {}, 'Transcripción'), h('p', { class: 'hint' }, `${t.modelo} · ${t.idioma || '—'} · ${t.via}`), h('p', { style: 'margin-top:.4rem' }, t.texto)));
    if (an.length) der.append(h('details', {}, h('summary', {}, `Por qué engancha (${an.length} segmentos)`), h('p', { class: 'hint' }, `Anotado por ${an[0].generado_por}. Texto y tiempos de la transcripción; la interpretación es del modelo.`), ...renderAnotaciones(an)));
    out.push(h('section', { class: 'card', id: 'reelDetail' },
      h('h2', {}, `Reel de @${creDe.get(r.creator_id)?.handle || '—'}`, fila ? [' · ', etiquetaPill(fila.etiqueta)] : null),
      h('p', { class: 'hint' }, link(r.url), ` · publicado el ${fmt.fecha(r.posted_at)}`),
      h('div', { class: 'reelDetail' },
        h('div', {}, src ? h('iframe', { class: 'embed', src, loading: 'lazy', title: 'Reel original', allow: 'encrypted-media', referrerpolicy: 'no-referrer' }) : null,
          h('p', { class: 'hint' }, 'Publicación original incrustada desde la red; la app no aloja el video.')),
        der)));
    if (mias.length) {
      const cont = h('div', { id: 'miVersion', style: 'display:grid;gap:1.2rem' });
      for (const o of mias) cont.append(renderOutput(o, async () => { if (confirm('¿Eliminar esta versión?')) { await db.del('outputs', o.id); await app.render(); } }));
      out.push(cont);
    }
  }
  return out;
}
