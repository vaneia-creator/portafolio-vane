// M2: métricas reales, ranking por fórmula, transcripción y anotación de gatillos.

import { h, btn, note, fmt, table, link, empty, fnChip, etiquetaPill, download, toCSV } from './dom.js';
import { db, getSettings } from '../services/store.js';
import { ingestMetrics, ranking, transcribeAndAnnotate, costoEstimado } from '../pipeline.js';
import { embedUrl } from '../core/normalize.js';
import { TAXONOMY } from '../core/config.js';

function marcar(texto, gatillos) {
  // Resalta las palabras gatillo dentro del texto exacto (sin HTML: solo nodos).
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

export async function viewReels(app) {
  const p = app.project;
  const s = getSettings();
  const out = [];
  const R = await ranking(p);
  const { creators, reels } = R;
  const trans = await db.byProject('transcripts', p.id);
  const anot = await db.byProject('annotations', p.id);
  const conTrans = new Set(trans.filter((t) => t.words?.length).map((t) => t.reel_id));
  const conAnot = new Set(anot.map((a) => a.reel_id));
  const reelDe = new Map(reels.map((r) => [r.id, r]));
  const creDe = new Map(creators.map((c) => [c.id, c]));

  // --- Ingesta ---
  const ig = creators.filter((c) => c.plataforma === 'instagram').length;
  const tt = creators.length - ig;
  const porPerfil = s.thresholds.medianWindow + 6;
  const est = (ig ? costoEstimado('igProfiles', ig) + costoEstimado('igReels', ig * porPerfil) : 0) + (tt ? costoEstimado('ttVideos', tt * porPerfil) : 0);
  const ing = h('section', { class: 'card' },
    h('h2', {}, 'Métricas de los reels'),
    h('p', { class: 'hint' }, `Trae de Apify los últimos ${porPerfil} reels de cada referente (${creators.length} cuenta(s)) con sus cifras públicas reales. Cada captura queda guardada con fecha para medir la velocidad en capturas posteriores.`));
  if (!creators.length) ing.append(empty('Añade referentes en la pestaña Proyecto.'));
  else {
    ing.append(
      h('p', { class: 'hint' }, `Costo máximo estimado de esta captura: ${fmt.usd(est)} de tu crédito de Apify (tarifas del plan Free; la ejecución se detiene si lo supera).`),
      h('div', { class: 'row' }, btn(reels.length ? 'Volver a capturar métricas' : 'Traer métricas', () => {
        if (!s.keys.apify) { alert('Falta el token de Apify (Configuración).'); return; }
        app.run('Captura de métricas', async (log) => {
          const res = await ingestMetrics(p, log);
          for (const r of res) log(`@${r.handle}: ${r.reels} reels, ${r.followers == null ? 'seguidores no disponibles' : fmt.n(r.followers) + ' seguidores'}.`);
        });
      })));
  }
  out.push(ing);
  if (!reels.length) return out;

  // --- Resumen por creador ---
  out.push(h('section', { class: 'card' },
    h('h2', {}, 'Base de cálculo por creador'),
    h('p', { class: 'hint' }, `Datos capturados el ${fmt.fechaHora(R.referencia)}. Fórmula ${R.formula_version}. Se excluyen los reels con menos de ${s.thresholds.minAgeDays} días y se exigen ${s.thresholds.minReels} reels elegibles.`),
    table([
      { h: 'Creador', v: (c) => `@${c.handle}` },
      { h: 'Seguidores', n: true, v: (c) => fmt.n(c.followers) },
      { h: 'Reels capturados', n: true, v: (c) => fmt.n(reels.filter((r) => r.creator_id === c.id).length) },
      { h: 'Elegibles', n: true, v: (c) => fmt.n(R.porCreador[c.id].n_elegibles) },
      { h: 'Mediana de vistas', n: true, v: (c) => fmt.n(R.porCreador[c.id].mediana) },
      { h: 'Estado', wrap: true, v: (c) => { const r = R.porCreador[c.id]; if (c.error) return h('span', { class: 'pill bad' }, c.error); return r.estado === 'ok' ? h('span', { class: 'pill ok' }, 'en el ranking') : h('span', { class: 'pill warn' }, r.motivo); } },
    ], creators)));

  // --- Ranking ---
  const top = R.rows.slice(0, 10);
  const cols = [
    { h: '#', n: true, v: (x) => R.rows.indexOf(x) + 1 },
    { h: 'Reel', wrap: true, v: (x) => { const r = reelDe.get(x.reel_id); return h('span', {}, link(r.url, `@${creDe.get(r.creator_id)?.handle}`), ' · ', fmt.fecha(r.posted_at), h('br'), h('span', { class: 'muted' }, (r.caption || 'sin caption').slice(0, 70))); } },
    { h: 'Etiqueta', v: (x) => etiquetaPill(x.etiqueta) },
    { h: 'Score', n: true, title: '0,5·z + 0,3·ln(OS) + 0,2·percentil(EV)', v: (x) => fmt.d(x.score) },
    { h: 'Vistas', n: true, v: (x) => fmt.n(x.views) },
    { h: 'OS', n: true, title: 'Vistas ÷ mediana del creador', v: (x) => `${fmt.d(x.os, 1)}×` },
    { h: 'AR', n: true, title: 'Vistas ÷ seguidores', v: (x) => (x.ar == null ? 'dato insuficiente' : `${fmt.d(x.ar, 2)}×`) },
    { h: 'z', n: true, title: 'Z-score de ln(vistas) dentro del creador', v: (x) => fmt.d(x.z) },
    { h: 'EV', n: true, title: 'Interacciones ÷ vistas', v: (x) => (x.ev == null ? 'dato insuficiente' : `${fmt.pct(x.ev, 2)}${x.ev_parcial ? ' (parcial)' : ''}`) },
    { h: 'VEL', n: true, title: 'Vistas por día, con capturas entre el día 1 y el 7', v: (x) => (x.vel == null ? 'sin captura temprana' : fmt.n(x.vel)) },
  ];
  const csvCols = [
    { h: 'posicion', v: (x) => R.rows.indexOf(x) + 1 }, { h: 'url', v: (x) => reelDe.get(x.reel_id).url }, { h: 'creador', v: (x) => creDe.get(reelDe.get(x.reel_id).creator_id)?.handle },
    { h: 'publicado', v: (x) => reelDe.get(x.reel_id).posted_at }, { h: 'etiqueta', v: (x) => x.etiqueta }, { h: 'score', v: (x) => x.score }, { h: 'vistas', v: (x) => x.views },
    { h: 'os', v: (x) => x.os }, { h: 'ar', v: (x) => x.ar }, { h: 'z', v: (x) => x.z }, { h: 'ev', v: (x) => x.ev }, { h: 'ev_parcial', v: (x) => x.ev_parcial }, { h: 'vel', v: (x) => x.vel },
    { h: 'formula_version', v: () => R.formula_version }, { h: 'capturado', v: (x) => reelDe.get(x.reel_id).captured_at }, { h: 'fuente', v: (x) => reelDe.get(x.reel_id).fuente_dato },
  ];
  const estado = (x) => (conAnot.has(x.reel_id) ? h('span', { class: 'pill ok' }, 'analizado') : conTrans.has(x.reel_id) ? h('span', { class: 'pill warn' }, 'transcrito') : h('span', { class: 'pill' }, 'pendiente'));
  const analizar = (lista, titulo) => {
    if (!s.keys.groq) { alert('Falta la clave de Groq (Configuración).'); return; }
    app.run(titulo, async (log) => {
      let ok = 0;
      for (const x of lista) {
        const r = reelDe.get(x.reel_id);
        try {
          const res = await transcribeAndAnnotate(p, r, { onLog: log });
          log(`${r.url}: ${res.anotaciones} segmentos (${fmt.pct(res.cobertura)} del texto cubierto${res.rechazados ? `, ${res.rechazados} descartados por no ser verificables` : ''}).`);
          ok++;
        } catch (e) { log(`${r.url}: ${e.message}`); }
      }
      log(`${ok} de ${lista.length} reels analizados.`);
    });
  };
  const rank = h('section', { class: 'card' },
    h('h2', {}, 'Ranking de viralidad'),
    h('p', { class: 'hint' }, 'Orden por Score, con desempate por velocidad. Con los mismos datos el ranking sale siempre igual. EV "parcial" significa que la red no publica todos los campos (Instagram no publica guardados).'));
  if (!R.rows.length) rank.append(note('warn', 'Dato insuficiente: ningún creador alcanza el mínimo de reels elegibles. Añade referentes con más publicaciones.'));
  else {
    const pend = top.filter((x) => !conAnot.has(x.reel_id));
    rank.append(
      h('div', { class: 'row' },
        pend.length ? btn(`Transcribir y analizar el top ${top.length} (${pend.length} pendientes)`, () => analizar(pend, 'Análisis del top')) : h('span', { class: 'pill ok' }, 'Top analizado'),
        btn('Descargar ranking (CSV)', () => download('ranking-reels.csv', toCSV(csvCols, R.rows), 'text/csv'), 'alt')),
      h('h3', {}, `Top ${top.length}`),
      table([...cols, { h: 'Análisis', v: estado }, { h: '', v: (x) => btn('Abrir', () => { app.state.reelId = x.reel_id; app.render().then(() => document.getElementById('reelDetail')?.scrollIntoView({ behavior: 'smooth' })); }, 'small alt') }], top));
    if (R.rows.length > top.length) {
      rank.append(h('details', {}, h('summary', {}, `Ver los ${R.rows.length} reels rankeados`),
        table([...cols, { h: '', v: (x) => btn('Abrir', () => { app.state.reelId = x.reel_id; app.render(); }, 'small alt') }], R.rows)));
    }
  }
  out.push(rank);

  // --- Detalle ---
  const x = R.rows.find((r) => r.reel_id === app.state.reelId);
  if (x) {
    const r = reelDe.get(x.reel_id);
    const t = trans.find((y) => y.reel_id === r.id);
    const an = anot.filter((a) => a.reel_id === r.id);
    const file = h('input', { type: 'file', accept: 'video/*,audio/*', hidden: true });
    file.addEventListener('change', () => { const f = file.files[0]; if (f) app.run('Transcribir archivo', (log) => transcribeAndAnnotate(p, r, { archivo: f, onLog: log })); });
    const src = embedUrl(r);
    const der = h('div', {},
      h('div', { class: 'kpis' },
        [['Vistas', fmt.n(r.views)], ['Likes', r.likes == null ? 'oculto / no disponible' : fmt.n(r.likes)], ['Comentarios', fmt.n(r.comments)],
          ['Compartidos', r.shares == null ? 'no disponible' : fmt.n(r.shares)], ['Guardados', r.saves == null ? 'no disponible' : fmt.n(r.saves)], ['Duración', r.duration_s == null ? '—' : `${fmt.d(r.duration_s, 1)} s`]]
          .map(([k, v]) => h('div', { class: 'kpi' }, h('b', {}, v), h('span', {}, k)))),
      h('p', { class: 'hint', style: 'margin-top:.6rem' }, `Fuente: ${r.fuente_dato} (campo de vistas: ${r.views_campo}). Capturado el ${fmt.fechaHora(r.captured_at)}.`),
      h('div', { class: 'row noprint' },
        btn(an.length ? 'Volver a anotar' : t?.words?.length ? 'Anotar gatillos' : 'Transcribir y anotar', () => app.run('Análisis del reel', (log) => transcribeAndAnnotate(p, r, { onLog: log }))),
        btn('Subir archivo de video', () => file.click(), 'alt'), file));
    if (t?.sin_voz) der.append(note('warn', 'Dato insuficiente: la transcripción no contiene palabras (reel sin voz o solo con música).'));
    if (t?.words?.length) {
      der.append(h('h3', { class: 'sub3' }, 'Transcripción'),
        h('p', { class: 'hint' }, `${t.modelo} · idioma detectado: ${t.idioma || '—'} · ${t.via} · ${fmt.fechaHora(t.creado)}`),
        h('p', { style: 'margin-top:.4rem' }, t.texto));
    }
    if (an.length) {
      der.append(h('h3', { class: 'sub3' }, 'Gatillos por segmento'),
        h('p', { class: 'hint' }, `Anotado por ${an[0].generado_por}. El texto y los tiempos provienen de la transcripción; la interpretación es del modelo. La app no analiza la imagen: revisa el reel para los gatillos visuales.`),
        ...renderAnotaciones(an));
    }
    out.push(h('section', { class: 'card', id: 'reelDetail' },
      h('h2', {}, `Reel de @${creDe.get(r.creator_id)?.handle} · `, etiquetaPill(x.etiqueta)),
      h('p', { class: 'hint' }, link(r.url), ` · publicado el ${fmt.fecha(r.posted_at)}`),
      h('div', { class: 'reelDetail' },
        h('div', {}, src ? h('iframe', { class: 'embed', src, loading: 'lazy', title: 'Reel original', allow: 'encrypted-media', referrerpolicy: 'no-referrer' }) : null,
          h('p', { class: 'hint' }, 'Publicación original incrustada desde la red; la app no aloja el video.')),
        der)));
  }
  return out;
}
