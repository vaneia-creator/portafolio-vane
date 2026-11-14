// Orquestación de los módulos M0–M3. Cada paso guarda de dónde salió el dato y cuándo.

import { ACTORS, NETWORKS, formulaVersion } from './core/config.js';
import * as N from './core/normalize.js';
import { buildAnnotations, verifyPainItems, validateScript, hedges, normText } from './core/validate.js';
import { rankProject } from './core/virality.js';
import { scoreClusters, topCitas, trendVerdict } from './core/pains.js';
import * as P from './core/prompts.js';
import { db, uid, getSettings } from './services/store.js';
import { runActor } from './services/apify.js';
import { llmJSON } from './services/llm.js';
import { transcribeReel, ytSearch, ytComments } from './services/media.js';

const ahora = () => new Date().toISOString();
const creatorId = (projectId, plataforma, handle) => `${projectId}:${plataforma}:${handle}`;

export function costoEstimado(actor, resultados) {
  return ACTORS[actor].usdInicio + ACTORS[actor].usdPorResultado * resultados;
}

async function registrar(projectId, tipo, run, detalle) {
  await db.put('runs', { id: uid('run'), project_id: projectId, tipo, fecha: ahora(), ...run, detalle });
}

// ---------- M2: ingesta de métricas ----------
export async function ingestMetrics(project, onLog) {
  const th = getSettings().thresholds;
  const creators = await db.byProject('creators', project.id);
  if (!creators.length) throw new Error('Añade al menos un referente antes de traer métricas.');
  // Se piden algunos reels de más porque los de menos de 7 días se excluyen del ranking.
  const porPerfil = th.medianWindow + 6;
  const capturado = ahora();
  const resumen = [];

  const ig = creators.filter((c) => c.plataforma === 'instagram');
  if (ig.length) {
    onLog(`Instagram: pidiendo seguidores de ${ig.length} perfil(es)…`);
    const perf = await runActor(ACTORS.igProfiles.id, { usernames: ig.map((c) => c.handle) },
      { maxChargeUsd: costoEstimado('igProfiles', ig.length) + 0.05, onStatus: onLog });
    await registrar(project.id, 'perfiles_instagram', perf.run, `${perf.items.length} perfiles`);
    const perfiles = perf.items.map((i) => N.normIgProfile(i, capturado)).filter(Boolean);
    for (const c of ig) {
      const p = perfiles.find((x) => x.handle === c.handle);
      if (p) Object.assign(c, { followers: p.followers, url: p.url, privado: p.privado, captured_at: capturado });
      else Object.assign(c, { followers: null, captured_at: capturado, error: 'Apify no devolvió este perfil (no existe, es privado o está restringido).' });
    }
    await db.put('creators', ig);

    const validos = ig.filter((c) => !c.error && !c.privado);
    if (validos.length) {
      onLog(`Instagram: pidiendo los últimos ${porPerfil} reels de ${validos.length} perfil(es)…`);
      const r = await runActor(ACTORS.igReels.id,
        { username: validos.map((c) => c.handle), resultsLimit: porPerfil, skipPinnedPosts: true, skipTrialReels: true },
        { maxChargeUsd: costoEstimado('igReels', validos.length * porPerfil) + 0.05, onStatus: onLog });
      await registrar(project.id, 'reels_instagram', r.run, `${r.items.length} resultados`);
      const reels = r.items.map((i) => N.normIgReel(i, capturado)).filter(Boolean);
      resumen.push(await guardarReels(project, validos, reels, capturado));
    }
  }

  const tt = creators.filter((c) => c.plataforma === 'tiktok');
  if (tt.length) {
    onLog(`TikTok: pidiendo los últimos ${porPerfil} videos de ${tt.length} perfil(es)…`);
    const r = await runActor(ACTORS.ttVideos.id,
      { profiles: tt.map((c) => c.handle), resultsPerPage: porPerfil, profileScrapeSections: ['videos'], profileSorting: 'latest', excludePinnedPosts: true },
      { maxChargeUsd: costoEstimado('ttVideos', tt.length * porPerfil) + 0.05, onStatus: onLog });
    await registrar(project.id, 'videos_tiktok', r.run, `${r.items.length} resultados`);
    const reels = r.items.map((i) => N.normTtVideo(i, capturado)).filter(Boolean);
    for (const c of tt) {
      const uno = reels.find((x) => x.handle === c.handle);
      Object.assign(c, { followers: uno ? uno.followers : null, captured_at: capturado, url: `https://www.tiktok.com/@${c.handle}`,
        error: uno ? undefined : 'Apify no devolvió videos de este perfil.' });
    }
    await db.put('creators', tt);
    resumen.push(await guardarReels(project, tt, reels, capturado));
  }
  return resumen.flat();
}

async function guardarReels(project, creators, reels, capturado) {
  const filas = [], snaps = [], resumen = [];
  for (const c of creators) {
    const propios = reels.filter((r) => r.handle === c.handle);
    for (const r of propios) {
      const { followers, handle, ...resto } = r; // los seguidores van en `creators`
      filas.push({ ...resto, id: `${project.id}:${r.id}`, project_id: project.id, creator_id: c.id });
      snaps.push({ id: `${project.id}:${r.id}@${capturado}`, project_id: project.id, reel_id: `${project.id}:${r.id}`, captured_at: capturado, views: r.views, likes: r.likes, comments: r.comments });
    }
    resumen.push({ handle: c.handle, plataforma: c.plataforma, reels: propios.length, followers: c.followers });
  }
  if (filas.length) { await db.put('reels', filas); await db.put('metric_snapshots', snaps); }
  return resumen;
}

export async function ranking(project) {
  const th = getSettings().thresholds;
  const [creators, reels, snaps] = await Promise.all([db.byProject('creators', project.id), db.byProject('reels', project.id), db.byProject('metric_snapshots', project.id)]);
  // El instante de referencia es la última captura: el mismo conjunto de datos da siempre el mismo ranking.
  const capturas = reels.map((r) => Date.parse(r.captured_at)).filter(Number.isFinite);
  const ref = capturas.length ? Math.max(...capturas) : Date.now();
  const res = rankProject(creators, reels, snaps, th, ref);
  return { ...res, creators, reels, referencia: new Date(ref).toISOString(), formula_version: formulaVersion(th) };
}

// ---------- M2: transcripción y anotación ----------
export async function transcribeAndAnnotate(project, reel, { archivo, onLog } = {}) {
  let tr = await db.get('transcripts', reel.id);
  if (!tr || archivo) {
    onLog(`Transcribiendo ${reel.url}…`);
    const t = await transcribeReel(reel, { archivo, onLog });
    if (!t.words.length) {
      tr = { id: reel.id, project_id: project.id, reel_id: reel.id, idioma: t.idioma, modelo: t.modelo, via: t.via, words: [], texto: '', creado: ahora(), sin_voz: true };
      await db.put('transcripts', tr);
      throw new Error('Dato insuficiente: la transcripción no contiene palabras (reel sin voz o solo con música).');
    }
    tr = { id: reel.id, project_id: project.id, reel_id: reel.id, idioma: t.idioma, modelo: t.modelo, via: t.via, words: t.words, texto: t.texto, creado: ahora() };
    await db.put('transcripts', tr);
  }
  if (!tr.words.length) throw new Error('Dato insuficiente: la transcripción no contiene palabras (reel sin voz o solo con música).');
  onLog(`Anotando gatillos (${tr.words.length} palabras)…`);
  const r = await llmJSON({ ...P.promptAnotador(project, reel, tr.words), maxTokens: 6000 }, onLog);
  const { anotaciones, rechazados } = buildAnnotations(reel.id, tr.words, r.json?.segmentos);
  if (!anotaciones.length) throw new Error(`El LLM (${r.proveedor}) no devolvió segmentos válidos. Vuelve a intentarlo.`);
  const viejas = (await db.byProject('annotations', project.id)).filter((a) => a.reel_id === reel.id);
  if (viejas.length) await db.del('annotations', viejas.map((a) => a.id));
  await db.put('annotations', anotaciones.map((a) => ({ ...a, project_id: project.id, generado_por: `${r.proveedor} · ${r.modelo}`, generado: r.fecha })));
  const cubiertas = anotaciones.reduce((n, a) => n + (a.w_fin - a.w_inicio + 1), 0);
  return { anotaciones: anotaciones.length, rechazados: rechazados.length, cobertura: cubiertas / tr.words.length };
}

// ---------- M1: recolección de comentarios ----------
async function guardarComentarios(project, crudos) {
  const existentes = new Set((await db.byProject('comments', project.id)).map((c) => c.id));
  const nuevos = [];
  for (const c of crudos) {
    const a = await N.anonymize(c, project.id);
    if (!existentes.has(a.id)) { existentes.add(a.id); nuevos.push(a); }
  }
  if (nuevos.length) await db.put('comments', nuevos);
  return nuevos.length;
}

export async function generarConsultas(project, onLog) {
  const r = await llmJSON({ ...P.promptConsultas(project), maxTokens: 1500 }, onLog);
  const lista = (r.json?.consultas || []).map((c) => String(c).trim()).filter(Boolean);
  if (!lista.length) throw new Error('El LLM no devolvió consultas.');
  return [...new Set(lista)].slice(0, 30);
}

export async function collectYoutube(project, consultas, { videosPorConsulta, paginas }, onLog) {
  let total = 0, videos = 0;
  const vistos = new Set();
  for (const q of consultas) {
    onLog(`YouTube: buscando "${q}"…`);
    const vids = await ytSearch(q, { max: videosPorConsulta });
    for (const v of vids) {
      if (vistos.has(v.videoId)) continue;
      vistos.add(v.videoId);
      const { comentarios, omitido } = await ytComments(v.videoId, { paginas });
      if (omitido) { onLog(`  · "${v.titulo.slice(0, 60)}": ${omitido}.`); continue; }
      const n = await guardarComentarios(project, comentarios);
      total += n; videos++;
      onLog(`  · "${v.titulo.slice(0, 60)}": ${comentarios.length} comentarios (${n} nuevos).`);
    }
  }
  await registrar(project.id, 'comentarios_youtube', { actor: 'YouTube Data API v3' }, `${consultas.length} consultas, ${videos} videos, ${total} comentarios nuevos`);
  return { total, videos };
}

export async function collectReelComments(project, reels, porReel, onLog) {
  let total = 0;
  const ig = reels.filter((r) => r.plataforma === 'instagram');
  const tt = reels.filter((r) => r.plataforma === 'tiktok');
  if (ig.length) {
    onLog(`Instagram: pidiendo hasta ${porReel} comentarios de ${ig.length} reel(s)…`);
    const r = await runActor(ACTORS.igComments.id, { directUrls: ig.map((x) => x.url), resultsLimit: porReel },
      { maxChargeUsd: costoEstimado('igComments', ig.length * porReel) + 0.05, onStatus: onLog });
    await registrar(project.id, 'comentarios_instagram', r.run, `${r.items.length} comentarios`);
    total += await guardarComentarios(project, r.items.map(N.normIgComment).filter(Boolean));
  }
  if (tt.length) {
    onLog(`TikTok: pidiendo hasta ${porReel} comentarios de ${tt.length} video(s)…`);
    const r = await runActor(ACTORS.ttComments.id, { postURLs: tt.map((x) => x.url), commentsPerPost: porReel, maxRepliesPerComment: 0 },
      { maxChargeUsd: costoEstimado('ttComments', tt.length * porReel) + 0.05, onStatus: onLog });
    await registrar(project.id, 'comentarios_tiktok', r.run, `${r.items.length} comentarios`);
    total += await guardarComentarios(project, r.items.map(N.normTtComment).filter(Boolean));
  }
  return total;
}

export async function addManual(project, texto, url, fecha) {
  return guardarComentarios(project, N.parseManualPaste(texto, url, fecha));
}

// ---------- M1: extracción y agrupación ----------
const LOTE = 20;

export async function extractPains(project, onLog, debeParar = () => false) {
  const pendientes = (await db.byProject('comments', project.id)).filter((c) => !c.procesado && c.texto);
  let menciones = 0, rechazados = 0, procesados = 0;
  for (let i = 0; i < pendientes.length; i += LOTE) {
    if (debeParar()) break;
    const lote = pendientes.slice(i, i + LOTE);
    onLog(`Extrayendo dolores: comentarios ${i + 1}–${i + lote.length} de ${pendientes.length}…`);
    const r = await llmJSON({ ...P.promptExtractor(lote), maxTokens: 5000 }, onLog);
    const v = verifyPainItems(lote, r.json?.dolores);
    if (v.menciones.length) await db.put('pain_mentions', v.menciones.map((m) => ({ ...m, cluster_id: null, generado_por: `${r.proveedor} · ${r.modelo}`, generado: r.fecha })));
    // Privacidad: una vez procesado, el texto completo del comentario se borra; queda solo la cita corta.
    await db.put('comments', lote.map((c) => ({ ...c, procesado: true, texto: '' })));
    menciones += v.menciones.length; rechazados += v.rechazados.length; procesados += lote.length;
  }
  return { procesados, menciones, rechazados, restantes: pendientes.length - procesados };
}

export async function clusterPains(project, onLog) {
  const menciones = await db.byProject('pain_mentions', project.id);
  if (!menciones.length) throw new Error('No hay dolores extraídos todavía.');
  const unicos = [...new Set(menciones.map((m) => normText(m.dolor_norm)))];
  const grupoDe = new Map();
  const nombres = [];
  const TROZO = 60;
  let por = '';
  for (let i = 0; i < unicos.length; i += TROZO) {
    const trozo = unicos.slice(i, i + TROZO);
    onLog(`Agrupando dolores ${i + 1}–${i + trozo.length} de ${unicos.length}…`);
    const r = await llmJSON({ ...P.promptAgrupador(trozo, nombres), maxTokens: 5000 }, onLog);
    por = `${r.proveedor} · ${r.modelo}`;
    for (const a of r.json?.asignaciones || []) {
      const idx = Number(a?.i);
      const g = String(a?.grupo || '').trim();
      if (!Number.isInteger(idx) || !trozo[idx] || !g) continue;
      const canon = nombres.find((n) => normText(n) === normText(g)) || (nombres.push(g), g);
      grupoDe.set(trozo[idx], canon);
    }
  }
  const previos = await db.byProject('pain_clusters', project.id);
  if (previos.length) await db.del('pain_clusters', previos.map((c) => c.id));
  const clusters = nombres.map((nombre, i) => ({ id: `${project.id}:cl${i}`, project_id: project.id, nombre, generado_por: por, generado: ahora() }));
  if (clusters.length) await db.put('pain_clusters', clusters);
  const idDe = new Map(clusters.map((c) => [c.nombre, c.id]));
  const sinGrupo = [];
  for (const m of menciones) {
    const g = grupoDe.get(normText(m.dolor_norm));
    m.cluster_id = g ? idDe.get(g) : null;
    if (!g) sinGrupo.push(m.id);
  }
  await db.put('pain_mentions', menciones);
  return { clusters: clusters.length, sinGrupo: sinGrupo.length };
}

export async function painBoard(project) {
  const th = getSettings().thresholds;
  const [menciones, clusters, trends] = await Promise.all([db.byProject('pain_mentions', project.id), db.byProject('pain_clusters', project.id), db.get('trends', project.id)]);
  const trend = trendVerdict(trends?.puntos, th.trendsMinRatio);
  const scored = scoreClusters(menciones, clusters, th, Date.now(), trend);
  return { clusters: scored, menciones, trend, trends, formula_version: formulaVersion(th) };
}

// ---------- M3: generador ----------
export async function patronesDisponibles(project) {
  const [anot, reels, creators] = await Promise.all([db.byProject('annotations', project.id), db.byProject('reels', project.id), db.byProject('creators', project.id)]);
  const vistos = new Set();
  const out = [];
  anot.filter((a) => a.patron && a.funcion !== 'sin_gatillo')
    .sort((a, b) => (b.confianza ?? 0) - (a.confianza ?? 0) || (a.id < b.id ? -1 : 1))
    .forEach((a) => {
      const k = normText(a.patron);
      if (vistos.has(k)) return;
      vistos.add(k);
      const reel = reels.find((r) => r.id === a.reel_id);
      const cr = creators.find((c) => c.id === reel?.creator_id);
      out.push({ id: `P${out.length + 1}`, funcion: a.funcion, patron: a.patron, reel_url: reel?.url || null, creador: cr?.handle || null, anotacion_id: a.id });
    });
  return out;
}

export async function generateOffer(project, cluster, menciones, onLog) {
  if (!cluster.valida) throw new Error('Solo los dolores que pasan todos los umbrales se convierten en oferta.');
  const citas = topCitas(menciones, cluster.id, 3);
  const r = await llmJSON({ ...P.promptOferta(project, cluster, citas), maxTokens: 2500 }, onLog);
  const o = r.json || {};
  const avisos = [];
  if (!citas.some((c) => normText(c.cita_corta).includes(normText(o.dolor_literal).replace(/^["' ]+|["' ]+$/g, '')) && normText(o.dolor_literal))) {
    avisos.push('El "dolor literal" devuelto no coincidía con ninguna cita real; se sustituyó por la cita más intensa.');
    o.dolor_literal = citas[0].cita_corta;
  }
  const h = hedges(JSON.stringify(o));
  if (h.length) avisos.push(`Lenguaje dubitativo detectado: ${h.join(', ')}.`);
  const out = {
    id: uid('out'), project_id: project.id, tipo: cluster.formato, red: null, cluster_id: cluster.id, creado: r.fecha,
    generado_por: `${r.proveedor} · ${r.modelo}`, formula_version: formulaVersion(getSettings().thresholds),
    contenido_json: { ...o, cluster: cluster.nombre, citas: citas.map((c) => ({ cita: c.cita_corta, url: c.url, fuente: c.fuente })), metricas: { autores: cluster.autores, intensidad: cluster.intensidad, pago: cluster.pago, recencia: cluster.recencia, pain_score: cluster.pain_score }, avisos },
  };
  await db.put('outputs', out);
  return out;
}

export async function generateScript(project, redKey, cluster, menciones, onLog) {
  const red = NETWORKS[redKey];
  const patrones = await patronesDisponibles(project);
  if (!patrones.length) throw new Error('Dato insuficiente: no hay patrones. Transcribe y anota al menos un reel en la pestaña Reels.');
  const citas = topCitas(menciones, cluster.id, 5);
  const usados = patrones.slice(0, 25);
  const r = await llmJSON({ ...P.promptGuion(project, redKey, red, cluster, citas, usados), maxTokens: 5000 }, onLog);
  const transcripts = await db.byProject('transcripts', project.id);
  const validacion = validateScript(r.json, red, usados.map((p) => p.id), transcripts);
  const filas = (r.json?.filas || []).map((f) => ({ ...f, patron: usados.find((p) => p.id === f.patron_id) || null }));
  const out = {
    id: uid('out'), project_id: project.id, tipo: 'guion', red: redKey, cluster_id: cluster.id, creado: r.fecha,
    generado_por: `${r.proveedor} · ${r.modelo}`, formula_version: formulaVersion(getSettings().thresholds),
    contenido_json: { filas, caption: String(r.json?.caption || ''), cluster: cluster.nombre, citas: citas.map((c) => ({ cita: c.cita_corta, url: c.url, fuente: c.fuente })), validacion },
  };
  await db.put('outputs', out);
  return out;
}

// ---------- M0: descubrimiento de referentes ----------
export async function sugerirHashtags(project, plataforma, onLog) {
  const r = await llmJSON({ ...P.promptHashtags(project, plataforma), maxTokens: 800 }, onLog);
  return [...new Set((r.json?.hashtags || []).map((h) => String(h).replace(/^#/, '').replace(/\s+/g, '').toLowerCase()).filter(Boolean))].slice(0, 8);
}

/** Busca reels por hashtag y agrupa por creador. Devuelve candidatos con su métrica de respaldo real. */
export async function discover(project, plataforma, hashtags, porHashtag, onLog) {
  let items;
  if (plataforma === 'instagram') {
    const r = await runActor(ACTORS.igHashtag.id, { hashtags, resultsType: 'reels', resultsLimit: porHashtag },
      { maxChargeUsd: costoEstimado('igHashtag', hashtags.length * porHashtag) + 0.05, onStatus: onLog });
    await registrar(project.id, 'descubrimiento_instagram', r.run, `${r.items.length} resultados`);
    items = r.items.map((i) => N.normIgReel(i, ahora())).filter(Boolean);
  } else {
    const r = await runActor(ACTORS.ttVideos.id, { hashtags, resultsPerPage: porHashtag },
      { maxChargeUsd: costoEstimado('ttVideos', hashtags.length * porHashtag) + 0.05, onStatus: onLog });
    await registrar(project.id, 'descubrimiento_tiktok', r.run, `${r.items.length} resultados`);
    items = r.items.map((i) => N.normTtVideo(i, ahora())).filter(Boolean);
  }
  const porAutor = new Map();
  for (const it of items) {
    if (!it.handle) continue;
    const a = porAutor.get(it.handle) || { handle: it.handle, plataforma, reels: 0, vistas: [], followers: it.followers ?? null, ejemplo: it.url };
    a.reels++; if (it.views != null) a.vistas.push(it.views);
    porAutor.set(it.handle, a);
  }
  return [...porAutor.values()]
    .map((a) => ({ ...a, vistasMax: a.vistas.length ? Math.max(...a.vistas) : null, vistasTotal: a.vistas.reduce((x, y) => x + y, 0) }))
    .sort((a, b) => b.reels - a.reels || b.vistasTotal - a.vistasTotal || (a.handle < b.handle ? -1 : 1))
    .slice(0, 15);
}

export async function addCreator(project, plataforma, handleRaw, origen = 'usuario') {
  const handle = N.cleanHandle(handleRaw);
  if (!/^[a-z0-9._]{1,40}$/.test(handle)) throw new Error(`"${handleRaw}" no parece un usuario válido.`);
  const id = creatorId(project.id, plataforma, handle);
  if (await db.get('creators', id)) throw new Error(`@${handle} ya está en el proyecto.`);
  await db.put('creators', { id, project_id: project.id, plataforma, handle, followers: null, url: null, origen, captured_at: null });
}

export async function removeCreator(project, creator) {
  const reels = (await db.byProject('reels', project.id)).filter((r) => r.creator_id === creator.id);
  const ids = new Set(reels.map((r) => r.id));
  for (const t of ['metric_snapshots', 'annotations']) {
    const rows = (await db.byProject(t, project.id)).filter((x) => ids.has(x.reel_id));
    if (rows.length) await db.del(t, rows.map((x) => x.id));
  }
  if (ids.size) { await db.del('transcripts', [...ids]); await db.del('reels', [...ids]); }
  await db.del('creators', creator.id);
}
