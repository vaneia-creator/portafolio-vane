// M1: recolección de comentarios reales, extracción verificada, agrupación y validación de dolores.

import { h, field, input, btn, note, fmt, link, empty } from './dom.js';
import { db, getSettings } from '../services/store.js';
import * as PL from '../pipeline.js';
import { parseTrendsCSV, topCitas } from '../core/pains.js';

const FUENTES = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', manual: 'Entrada manual' };

export function criterioPills(c, th) {
  const pill = (ok, txt) => h('span', { class: `pill ${ok === true ? 'ok' : ok === false ? 'bad' : 'warn'}` }, `${ok === true ? '✓' : ok === false ? '✗' : '?'} ${txt}`);
  return h('div', { class: 'criteria' },
    pill(c.criterios.frecuencia, `${c.autores} personas en ${c.n_origenes} videos o publicaciones (mín. ${th.painMinAuthors} y ${th.painMinSources})`),
    pill(c.criterios.intensidad, `intensidad ${fmt.d(c.intensidad)} (mín. ${fmt.d(th.painMinIntensity, 1)})`),
    pill(c.criterios.pago, `señal de pago ${fmt.pct(c.pago)} (mín. ${fmt.pct(th.painMinPay)})`),
    pill(c.criterios.recencia, c.recencia == null ? 'recencia: sin fechas' : `recientes ${fmt.pct(c.recencia)} (mín. ${fmt.pct(th.painMinRecency)})`),
    pill(c.criterios.mercado, c.criterios.mercado == null ? 'Google Trends sin verificar' : `Google Trends: ${c.mercado_estado}`));
}

export function citasNodes(menciones, clusterId, n = 5) {
  return topCitas(menciones, clusterId, n).map((m) => h('div', { class: 'cita' }, `«${m.cita_corta}»`,
    h('small', {}, `${FUENTES[m.fuente]} · ${fmt.fecha(m.fecha)} · intensidad ${m.intensidad}${m.senal_pago ? ` · señal de pago: «${m.evidencia_pago}»` : ''} · `,
      /^https?:/.test(m.url) ? link(m.url, 'ver origen') : m.url)));
}

export async function viewPains(app) {
  const p = app.project;
  const s = getSettings();
  const th = s.thresholds;
  const out = [];
  const st = (app.state.pains ||= { consultas: (p.consultas || []).join('\n'), videos: 5, paginas: 1, porReel: 30 });
  const comments = await db.byProject('comments', p.id);
  const pendientes = comments.filter((c) => !c.procesado).length;
  const B = await PL.painBoard(p);
  const avanz = [];

  // --- 1. Consultas ---
  const ta = h('textarea', { placeholder: 'Una consulta por línea. Ej.: no consigo clientes por instagram' }, st.consultas);
  const consultas = () => [...new Set(st.consultas.split('\n').map((x) => x.trim()).filter(Boolean))];
  const cuota = h('p', { class: 'hint' });
  const pintar = () => { const n = consultas().length; cuota.textContent = n ? `${n} consulta(s) → unas ${fmt.n(n * 100 + n * st.videos * st.paginas)} unidades de las 10.000 diarias de YouTube (cada búsqueda cuesta 100; hay un cupo de ~100 búsquedas al día).` : ''; };
  ta.addEventListener('input', async () => { st.consultas = ta.value; pintar(); });
  ta.addEventListener('change', async () => { p.consultas = consultas(); await db.put('projects', p); });
  const vid = input({ type: 'number', min: '1', max: '20', value: st.videos });
  vid.addEventListener('input', () => { st.videos = Math.min(20, Math.max(1, Number(vid.value) || 5)); pintar(); });
  pintar();
  avanz.push(h('section', { class: 'card' },
    h('h2', {}, 'Búsquedas de YouTube'),
    h('p', { class: 'hint' }, 'Consultas que tu audiencia escribiría en YouTube cuando tiene el problema. Genera una lista con IA y edítala: tú validas qué se busca.'),
    h('div', { class: 'row' }, h('div', { class: 'field' }, ta)),
    h('div', { class: 'row' },
      h('div', { class: 'field', style: 'flex:0 1 190px' }, h('span', {}, 'Videos por consulta'), vid),
      btn('Generar consultas con IA', () => app.run('Generar consultas', async (log) => { const l = await PL.generarConsultas(p, log); st.consultas = l.join('\n'); p.consultas = l; await db.put('projects', p); }), 'alt'),
      btn('Recoger comentarios de YouTube', () => {
        const l = consultas();
        if (!l.length) { alert('Escribe o genera al menos una consulta.'); return; }
        if (!s.keys.youtube) { alert('Falta la clave de YouTube Data API (Configuración).'); return; }
        app.run('Comentarios de YouTube', async (log) => { const r = await PL.collectYoutube(p, l, { videosPorConsulta: st.videos, paginas: st.paginas }, log); log(`${r.total} comentarios nuevos de ${r.videos} videos.`); });
      })),
    cuota));

  // --- 2. Otras fuentes ---
  const R = await PL.ranking(p);
  const virales = R.rows.slice(0, 10).map((x) => R.reels.find((r) => r.id === x.reel_id));
  const porReel = input({ type: 'number', min: '10', max: '50', value: st.porReel });
  porReel.addEventListener('input', () => { st.porReel = Math.min(50, Math.max(1, Number(porReel.value) || 30)); });
  const mTxt = h('textarea', { placeholder: 'Pega aquí comentarios, reseñas o mensajes de foros (uno por línea o separados por una línea en blanco).' });
  const mUrl = input({ type: 'url', placeholder: 'https://… (de dónde lo copiaste)' });
  const mFecha = input({ type: 'date' });
  const csv = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true });
  csv.addEventListener('change', async () => {
    const f = csv.files[0]; if (!f) return;
    const puntos = parseTrendsCSV(await f.text());
    if (puntos.length < 8) { alert('No se reconocieron datos en el archivo. Descarga el CSV de "Interés a lo largo del tiempo" de Google Trends (12 meses).'); return; }
    await db.put('trends', { id: p.id, project_id: p.id, archivo: f.name, subido: new Date().toISOString(), puntos });
    await app.render();
  });
  const igN = virales.filter((r) => r.plataforma === 'instagram').length, ttN = virales.length - igN;
  avanz.push(h('section', { class: 'card' },
    h('h2', {}, 'Más fuentes'),
    h('p', { class: 'hint' }, `Un dolor solo se valida si aparece en al menos ${th.painMinSources} fuentes distintas, así que conviene combinar YouTube con otra.`),
    h('h3', {}, 'Comentarios de los reels que estás analizando (de otras cuentas)'),
    virales.length
      ? h('div', {},
        h('p', { class: 'hint' }, `Hasta ${st.porReel} comentarios de cada uno de los ${virales.length} reels del top. Costo máximo estimado en Apify: ${fmt.usd((igN ? PL.costoEstimado('igComments', igN * st.porReel) : 0) + (ttN ? PL.costoEstimado('ttComments', ttN * st.porReel) : 0))}.`),
        h('div', { class: 'row' }, h('div', { class: 'field', style: 'flex:0 1 190px' }, h('span', {}, 'Comentarios por reel'), porReel),
          btn('Recoger comentarios de los reels', () => {
            if (!s.keys.apify) { alert('Falta el token de Apify (Configuración).'); return; }
            app.run('Comentarios de reels', async (log) => { const n = await PL.collectReelComments(p, virales, st.porReel, log); log(`${n} comentarios nuevos.`); });
          })))
      : h('p', { class: 'hint' }, 'Primero genera el ranking en la pestaña Reels.'),
    h('h3', {}, 'Pegar textos a mano'),
    h('p', { class: 'hint' }, 'Para foros, reseñas o grupos. Copia y pega el texto: la app no hace scraping de esos sitios.'),
    h('div', { class: 'row' }, h('div', { class: 'field' }, mTxt)),
    h('div', { class: 'row' }, field('Enlace de origen', mUrl), h('div', { class: 'field', style: 'flex:0 1 180px' }, h('span', {}, 'Fecha de los textos'), mFecha),
      btn('Añadir textos', async () => {
        if (mTxt.value.trim().length < 15) { alert('Pega primero los textos.'); return; }
        const n = await PL.addManual(p, mTxt.value, mUrl.value, mFecha.value ? new Date(mFecha.value).toISOString() : null);
        app.log(`${n} textos añadidos a mano.`); await app.render();
      }, 'alt')),
    h('h3', {}, 'Interés de mercado (Google Trends)'),
    h('p', { class: 'hint' }, 'En trends.google.es busca tu tema, elige "Últimos 12 meses", descarga el CSV de "Interés a lo largo del tiempo" y súbelo aquí.'),
    B.trends
      ? note(B.trend.estado === 'decreciente' ? 'bad' : 'ok', `${B.trends.archivo}: tendencia ${B.trend.estado}${B.trend.ratio != null ? ` (media final ÷ media inicial = ${fmt.d(B.trend.ratio)}; de ${B.trend.desde} a ${B.trend.hasta})` : ''}. Subido el ${fmt.fechaHora(B.trends.subido)}.`)
      : note('warn', 'Sin CSV: el criterio de interés de mercado queda "sin verificar".'),
    h('div', { class: 'row' }, btn(B.trends ? 'Sustituir CSV' : 'Subir CSV de Google Trends', () => csv.click(), 'alt'), csv)));

  // --- 3. Extraer y agrupar ---
  const porFuente = Object.keys(FUENTES).map((f) => [FUENTES[f], comments.filter((c) => c.fuente === f).length]).filter(([, n]) => n);
  const sinGrupo = B.menciones.filter((m) => !m.cluster_id).length;
  avanz.push(h('section', { class: 'card' },
    h('h2', {}, 'Pasos sueltos'),
    h('p', { class: 'hint' }, 'La IA lee cada comentario y propone el dolor; la app solo acepta los que citan literalmente el comentario. Al terminar, el texto completo se borra y queda la cita corta (privacidad).'),
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('b', {}, fmt.n(comments.length)), h('span', {}, 'comentarios recogidos')),
      h('div', { class: 'kpi' }, h('b', {}, fmt.n(pendientes)), h('span', {}, 'pendientes de leer')),
      h('div', { class: 'kpi' }, h('b', {}, fmt.n(B.menciones.length)), h('span', {}, 'dolores verificados')),
      h('div', { class: 'kpi' }, h('b', {}, fmt.n(B.clusters.length)), h('span', {}, 'grupos'))),
    porFuente.length ? h('p', { class: 'hint', style: 'margin-top:.5rem' }, `Por fuente: ${porFuente.map(([f, n]) => `${f} ${fmt.n(n)}`).join(' · ')}.`) : null,
    h('div', { class: 'row' },
      btn(`Extraer dolores (${fmt.n(pendientes)} pendientes)`, () => {
        if (!pendientes) { alert('No hay comentarios pendientes. Recoge comentarios primero.'); return; }
        app.run('Extracción de dolores', async (log) => { const r = await PL.extractPains(p, log); log(`${r.procesados} comentarios leídos → ${r.menciones} dolores verificados; ${r.rechazados} respuestas descartadas por no ser literales.`); });
      }),
      btn(`Agrupar dolores${sinGrupo ? ` (${fmt.n(sinGrupo)} sin grupo)` : ''}`, () => {
        if (!B.menciones.length) { alert('Primero extrae los dolores.'); return; }
        app.run('Agrupación de dolores', async (log) => { const r = await PL.clusterPains(p, log); log(`${r.clusters} grupos${r.sinGrupo ? `; ${r.sinGrupo} dolores quedaron sin grupo` : ''}.`); });
      }, 'alt'))));

  // --- Búsqueda automática ---
  const nCom = comments.length;
  out.push(h('section', { class: 'card' },
    h('h2', {}, 'Dolores de tu audiencia'),
    h('p', { class: 'hint' }, `Un clic y la app hace todo: piensa qué buscaría tu audiencia en YouTube a partir de tu tema y tu servicio, recoge los comentarios de esos videos y de los reels que estás analizando, lee los que expresan un problema y los agrupa. Solo acepta dolores con cita literal del comentario.`),
    !s.keys.youtube ? note('warn', 'Falta la clave de YouTube (Configuración): sin ella solo se usan los comentarios de los reels.') : null,
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('b', {}, fmt.n(nCom)), h('span', {}, 'comentarios recogidos')),
      h('div', { class: 'kpi' }, h('b', {}, fmt.n(pendientes)), h('span', {}, 'sin leer')),
      h('div', { class: 'kpi' }, h('b', {}, fmt.n(B.menciones.length)), h('span', {}, 'dolores con cita')),
      h('div', { class: 'kpi' }, h('b', {}, fmt.n(B.clusters.filter((c) => c.valida).length)), h('span', {}, 'dolores validados'))),
    h('div', { class: 'row' },
      btn(nCom ? 'Buscar más dolores' : 'Buscar dolores automáticamente', () => {
        if (!s.keys.groq && !s.keys.gemini) { alert('Falta la clave de Groq (Configuración).'); return; }
        app.run('Búsqueda de dolores', (log) => PL.autoPains(p, log));
      }),
      pendientes ? btn(`Leer más comentarios (${fmt.n(pendientes)} sin leer)`, () => app.run('Leer comentarios', async (log) => {
        const r = await PL.extractPains(p, log, undefined, { max: 240 });
        log(`${r.procesados} leídos → ${r.menciones} dolores con cita.`);
        await PL.clusterPains(p, log);
      }), 'alt') : null),
    h('p', { class: 'hint' }, 'Cada búsqueda lee hasta 240 comentarios (los que más parecen expresar un problema) para no agotar el cupo diario gratuito de la IA. Cuesta unos centavos de Apify si hay reels analizados (20 comentarios por reel).')));

  // --- 4. Tablero ---
  const board = h('section', { class: 'card' },
    h('h2', {}, 'Dolores validados'),
    h('p', { class: 'hint' }, `Fórmula ${B.formula_version}. Pain Score = 0,3·frecuencia + 0,25·intensidad + 0,3·pago + 0,15·recencia. Solo los grupos que pasan todos los umbrales se convierten en oferta.`));
  if (!B.clusters.length) board.append(empty('Aún no hay grupos. Recoge comentarios, extrae y agrupa.'));
  else {
    const validos = B.clusters.filter((c) => c.valida).length;
    board.append(note(validos ? 'ok' : 'warn', validos ? `${validos} dolor(es) pasan todos los umbrales.` : 'Ningún grupo pasa todavía todos los umbrales: abajo ves qué le falta a cada uno (✗). Pulsa "Buscar más dolores" para reunir más comentarios.'));
    for (const c of B.clusters) {
      board.append(h('details', { open: c.valida || c.formato === 'guion' },
        h('summary', {}, `${c.nombre} · Pain Score ${fmt.d(c.pain_score)} · `,
          c.valida ? h('span', { class: 'pill ok' }, `válido → ${c.formato}`) : c.formato === 'guion' ? h('span', { class: 'pill warn' }, 'solo guion de audiencia') : h('span', { class: 'pill bad' }, 'no válido')),
        criterioPills(c, th),
        h('p', { class: 'hint' }, `${c.n_menciones} menciones · fuentes: ${c.fuentes.map((f) => FUENTES[f]).join(', ')} · quieren delegar: ${c.delegar} · quieren aprender: ${c.aprender}.`),
        ...citasNodes(B.menciones, c.id)));
    }
    if (validos || B.clusters.some((c) => c.formato === 'guion')) board.append(h('div', { class: 'row' }, btn('Crear ofertas y guiones →', () => app.go('generador'))));
  }
  out.push(board);
  out.push(h('details', { class: 'card' }, h('summary', {}, 'Opciones avanzadas (búsquedas, textos pegados a mano, Google Trends, pasos sueltos)'), ...avanz));
  return out;
}
