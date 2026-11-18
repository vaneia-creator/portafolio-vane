// Validadores anti-invención. Todo lo que devuelve el LLM se comprueba contra el texto real
// (transcripción o comentario). Lo que no se puede comprobar se descarta y se informa.

import { TAXONOMY_CODES, HEDGE_WORDS } from './config.js';

export function normText(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[“”«»"]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export const wordCount = (s) => (normText(s) ? normText(s).split(' ').length : 0);

/** ¿`cita` aparece literalmente dentro de `fuente`? (ignora mayúsculas y espacios repetidos) */
export function isLiteral(cita, fuente) {
  const c = normText(cita).replace(/^["'…. ]+|["'…. ]+$/g, '');
  return c.length > 0 && normText(fuente).includes(c);
}

const soloLetras = (s) => normText(s).replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();

/** ¿`texto` comparte una racha de `n` o más palabras seguidas con `fuente`? */
export function sharesRun(texto, fuente, n) {
  const a = soloLetras(texto).split(' ').filter(Boolean);
  const f = ' ' + soloLetras(fuente) + ' ';
  for (let i = 0; i + n <= a.length; i++) {
    if (f.includes(' ' + a.slice(i, i + n).join(' ') + ' ')) return a.slice(i, i + n).join(' ');
  }
  return null;
}

export function hedges(texto) {
  const t = normText(texto);
  return HEDGE_WORDS.filter((w) => new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, 'u').test(t));
}

export function seccionPorTiempo(startMs, seccionLLM) {
  if (startMs < 1000) return 'Gancho 0–1 s';
  if (startMs < 3000) return 'Gancho 1–3 s';
  const s = normText(seccionLLM);
  if (s.startsWith('res')) return 'Resolución';
  if (s === 'cta') return 'CTA';
  return 'Desarrollo';
}

/**
 * Convierte los segmentos del LLM (rangos de índices de palabra) en anotaciones.
 * El texto exacto y las marcas de tiempo salen SIEMPRE de la transcripción, nunca del LLM.
 */
export function buildAnnotations(reelId, words, segmentos) {
  const out = [];
  const rechazados = [];
  const n = words.length;
  let prevEnd = -1;
  const lista = Array.isArray(segmentos) ? [...segmentos] : [];
  lista.sort((a, b) => Number(a?.w_inicio) - Number(b?.w_inicio));
  for (const seg of lista) {
    const a = Number(seg?.w_inicio), b = Number(seg?.w_fin);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b >= n || a > b) {
      rechazados.push({ motivo: 'rango de palabras fuera de la transcripción', seg });
      continue;
    }
    if (a <= prevEnd) { rechazados.push({ motivo: 'segmento solapado con el anterior', seg }); continue; }
    prevEnd = b;
    const trozo = words.slice(a, b + 1);
    const texto = trozo.map((w) => String(w.word).trim()).join(' ');
    const start_ms = Math.round(trozo[0].start * 1000);
    const end_ms = Math.round(trozo[trozo.length - 1].end * 1000);
    let funcion = String(seg.funcion || '').trim().toUpperCase();
    const avisos = [];
    if (funcion !== 'SIN_GATILLO' && !TAXONOMY_CODES.includes(funcion)) {
      avisos.push(`función "${seg.funcion}" fuera de la taxonomía; se marca sin_gatillo`);
      funcion = 'SIN_GATILLO';
    }
    const sinGatillo = funcion === 'SIN_GATILLO';
    const gatillos = (Array.isArray(seg.palabras_gatillo) ? seg.palabras_gatillo : [])
      .map(String).filter((g) => isLiteral(g, texto));
    const descartados = (Array.isArray(seg.palabras_gatillo) ? seg.palabras_gatillo.length : 0) - gatillos.length;
    if (descartados > 0) avisos.push(`${descartados} palabra(s) gatillo descartadas por no estar en el texto`);
    let patron = sinGatillo ? '' : String(seg.patron_reutilizable || '').trim();
    if (patron) {
      const copia = sharesRun(patron, texto, 5);
      if (copia) { avisos.push(`patrón descartado: copia la frase original ("${copia}")`); patron = ''; }
    }
    const conf = Number(seg.confianza);
    const porQue = sinGatillo ? '' : String(seg.por_que_engancha || '').trim();
    const h = hedges(`${porQue} ${seg.mecanismo || ''}`);
    if (h.length) avisos.push(`lenguaje dubitativo: ${h.join(', ')}`);
    out.push({
      id: `${reelId}:${a}-${b}`,
      reel_id: reelId,
      w_inicio: a, w_fin: b, start_ms, end_ms,
      texto_exacto: texto,
      seccion: seccionPorTiempo(start_ms, seg.seccion),
      funcion: sinGatillo ? 'sin_gatillo' : funcion,
      palabras_gatillo: gatillos,
      mecanismo: sinGatillo ? '' : String(seg.mecanismo || '').trim(),
      por_que: porQue,
      evidencia_visual: 'no analizado (la app no procesa imagen)',
      patron,
      confianza: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : null,
      avisos,
    });
  }
  return { anotaciones: out, rechazados };
}

/**
 * Verifica los dolores extraídos por el LLM contra los comentarios reales del lote.
 * URL, autor y fecha se toman del comentario; el LLM no puede alterarlos.
 */
export function verifyPainItems(comentarios, items) {
  const menciones = [];
  const rechazados = [];
  const vistos = new Set();
  for (const it of Array.isArray(items) ? items : []) {
    const i = Number(it?.i);
    const c = comentarios[i];
    if (!Number.isInteger(i) || !c) { rechazados.push({ motivo: 'índice de comentario inexistente', it }); continue; }
    if (vistos.has(i)) { rechazados.push({ motivo: 'comentario duplicado en la respuesta', it }); continue; }
    const cita = String(it.cita || '').trim();
    if (!isLiteral(cita, c.texto)) { rechazados.push({ motivo: 'la cita no es literal del comentario', it }); continue; }
    if (wordCount(cita) > 25) { rechazados.push({ motivo: 'cita de más de 25 palabras', it }); continue; }
    const dolor = String(it.dolor_normalizado || '').trim();
    if (!dolor || wordCount(dolor) > 10) { rechazados.push({ motivo: 'dolor normalizado vacío o de más de 10 palabras', it }); continue; }
    const intensidad = Number(it.intensidad);
    if (!Number.isInteger(intensidad) || intensidad < 1 || intensidad > 5) { rechazados.push({ motivo: 'intensidad fuera de 1–5', it }); continue; }
    let senal = it.senal_pago === true;
    let evidencia = String(it.evidencia_pago || '').trim();
    const avisos = [];
    if (senal && !isLiteral(evidencia, c.texto)) {
      senal = false; evidencia = '';
      avisos.push('señal de pago anulada: la evidencia no es literal del comentario');
    }
    const necesidad = ['delegar', 'aprender'].includes(it.tipo_necesidad) ? it.tipo_necesidad : 'otro';
    vistos.add(i);
    menciones.push({
      id: `m:${c.id}`,
      project_id: c.project_id,
      comment_id: c.id,
      fuente: c.fuente,
      url: c.url,
      autor_hash: c.autor_hash,
      origen: c.origen || null,
      fecha: c.fecha || null,
      cita_corta: cita,
      dolor_norm: dolor,
      emocion: String(it.emocion || '').trim().toLowerCase(),
      intensidad,
      senal_pago: senal,
      evidencia_pago: senal ? evidencia : '',
      solucion_intentada: isLiteral(it.solucion_intentada, c.texto) ? String(it.solucion_intentada).trim() : '',
      tipo_necesidad: necesidad,
      avisos,
    });
  }
  return { menciones, rechazados };
}

const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;

/** Comprueba un guion contra los límites de la red, los patrones de origen y la regla de no copiar. */
export function validateScript(guion, red, patronIds, transcripts) {
  const problemas = [];
  const filas = Array.isArray(guion?.filas) ? guion.filas : [];
  if (!filas.length) problemas.push({ nivel: 'error', msg: 'El guion no tiene filas.' });
  const lim = red.limites;
  const caption = String(guion?.caption || '');
  if (caption.length > lim.captionMax) problemas.push({ nivel: 'error', msg: `Caption de ${caption.length} caracteres; el máximo es ${lim.captionMax}.` });
  const tags = caption.match(HASHTAG_RE) || [];
  if (lim.hashtagsMax != null && tags.length > lim.hashtagsMax) problemas.push({ nivel: 'error', msg: `${tags.length} hashtags; el máximo es ${lim.hashtagsMax}.` });
  const ctas = filas.filter((f) => String(f.funcion).toUpperCase() === 'CTA').length;
  if (ctas !== 1) problemas.push({ nivel: 'error', msg: `El guion tiene ${ctas} CTA; debe tener exactamente uno.` });
  let fin = 0;
  filas.forEach((f, idx) => {
    const n = idx + 1;
    const fn = String(f.funcion || '').toUpperCase();
    if (!TAXONOMY_CODES.includes(fn)) problemas.push({ nivel: 'error', msg: `Fila ${n}: función "${f.funcion}" fuera de la taxonomía.` });
    if (!patronIds.includes(f.patron_id)) problemas.push({ nivel: 'error', msg: `Fila ${n}: no indica un patrón de origen existente.` });
    const ini = Number(f.t_inicio_s), end = Number(f.t_fin_s);
    if (!(Number.isFinite(ini) && Number.isFinite(end) && end > ini)) problemas.push({ nivel: 'error', msg: `Fila ${n}: tiempos inválidos.` });
    else fin = Math.max(fin, end);
    for (const t of transcripts || []) {
      const copia = sharesRun(`${f.texto_hablado || ''}`, t.texto, 6);
      if (copia) { problemas.push({ nivel: 'error', msg: `Fila ${n}: reproduce una frase de un reel analizado ("${copia}").` }); break; }
    }
    const h = hedges(f.texto_hablado || '');
    if (h.length) problemas.push({ nivel: 'aviso', msg: `Fila ${n}: lenguaje dubitativo (${h.join(', ')}).` });
  });
  if (fin > lim.duracionMaxS) problemas.push({ nivel: 'error', msg: `Duración de ${fin} s; el máximo de la red es ${lim.duracionMaxS} s.` });
  const [a, b] = red.duracionRecomendadaS;
  if (fin && (fin < a || fin > b)) problemas.push({ nivel: 'aviso', msg: `Duración de ${fin} s fuera del rango de referencia ${a}–${b} s. ${red.notaDuracion}` });
  return { duracion_s: fin, hashtags: tags.length, caption_chars: caption.length, problemas, ok: !problemas.some((p) => p.nivel === 'error') };
}

const txt = (v) => (typeof v === 'string' ? v.trim() : '');
const r1 = (n) => Math.round(n * 10) / 10;

/** Palabras de la transcripción que empiezan dentro de [a, b) segundos. */
export function wordsInRange(words, a, b) {
  return (words || []).filter((w) => w.start >= a - 0.05 && w.start < b).map((w) => String(w.word).trim()).join(' ');
}

/**
 * Limpia el desglose visual que devuelve Gemini: tomas ordenadas, sin solapes y dentro de la duración real.
 * Los cortes por cada 10 s se calculan en código.
 */
export function buildVisual(json, durS) {
  const lim = Number.isFinite(durS) && durS > 0 ? durS + 1 : Infinity;
  const raw = (Array.isArray(json?.tomas) ? json.tomas : [])
    .map((t) => ({ ...t, a: Number(t?.t_inicio_s), b: Number(t?.t_fin_s) }))
    .filter((t) => Number.isFinite(t.a) && Number.isFinite(t.b))
    .sort((x, y) => x.a - y.a);
  const tomas = [];
  let prev = 0, descartadas = (Array.isArray(json?.tomas) ? json.tomas.length : 0) - raw.length;
  for (const t of raw) {
    const a = Math.max(t.a, prev), b = Math.min(t.b, lim);
    if (t.a < 0 || t.a >= lim || b - a < 0.2 || t.a < prev - 0.5) { descartadas++; continue; }
    prev = b;
    tomas.push({ id: `B${tomas.length + 1}`, t_inicio_s: r1(a), t_fin_s: r1(b), plano: txt(t.plano), que_se_ve: txt(t.que_se_ve),
      texto_en_pantalla: txt(t.texto_en_pantalla), edicion: txt(t.edicion), audio: txt(t.audio), voz: txt(t.voz) });
    if (tomas.length >= 40) break;
  }
  const g = json?.global || {};
  const fin = tomas.length ? tomas[tomas.length - 1].t_fin_s : null;
  return {
    tomas, descartadas,
    formato: txt(g.formato), subtitulos: txt(g.subtitulos), musica: txt(g.musica), gancho_visual: txt(g.gancho_visual),
    que_ensena: txt(g.que_ensena), llamado_accion: txt(g.llamado_accion),
    herramientas: (Array.isArray(g.herramientas_mencionadas) ? g.herramientas_mencionadas : [])
      .map((x) => ({ nombre: txt(x?.nombre), para_que: txt(x?.para_que) })).filter((x) => x.nombre).slice(0, 15),
    cortes_por_10s: fin ? r1((tomas.length / fin) * 10) : null,
  };
}

/** Comprueba "mi versión": una fila por cada toma del original, sin copiar frases y dentro de los límites de la red. */
export function validateEspejo(json, tomas, red, fuentesTexto) {
  const problemas = [];
  const filas = [];
  const recibidas = Array.isArray(json?.filas) ? json.filas : [];
  const porId = new Map(recibidas.map((f) => [String(f?.toma || '').trim().toUpperCase(), f]));
  for (const t of tomas) {
    const f = porId.get(t.id);
    if (!f) { problemas.push({ nivel: 'error', msg: `Falta la toma ${t.id} (${t.t_inicio_s}–${t.t_fin_s} s).` }); continue; }
    const fn = String(f.funcion || '').trim().toUpperCase();
    const fila = { toma: t.id, t_inicio_s: t.t_inicio_s, t_fin_s: t.t_fin_s, original: t,
      texto_hablado: txt(f.texto_hablado), texto_pantalla: txt(f.texto_pantalla), que_grabas: txt(f.que_grabas),
      edicion: txt(f.edicion), funcion: TAXONOMY_CODES.includes(fn) ? fn : null, que_cambia: txt(f.que_cambia) };
    if (!fila.funcion) problemas.push({ nivel: 'aviso', msg: `${t.id}: función "${f.funcion || ''}" fuera de la taxonomía.` });
    for (const src of fuentesTexto.filter(Boolean)) {
      const copia = sharesRun(fila.texto_hablado, src, 6) || sharesRun(fila.texto_pantalla, src, 6);
      if (copia) { problemas.push({ nivel: 'error', msg: `${t.id}: copia una frase del original ("${copia}").` }); break; }
    }
    const h = hedges(`${fila.texto_hablado} ${fila.texto_pantalla}`);
    if (h.length) problemas.push({ nivel: 'aviso', msg: `${t.id}: lenguaje dubitativo (${h.join(', ')}).` });
    filas.push(fila);
  }
  const ids = new Set(tomas.map((t) => t.id));
  const sobran = recibidas.filter((f) => !ids.has(String(f?.toma || '').trim().toUpperCase())).length;
  if (sobran) problemas.push({ nivel: 'aviso', msg: `${sobran} fila(s) extra no corresponden a ninguna toma del original y se descartaron.` });
  const caption = txt(json?.caption);
  const lim = red.limites;
  if (caption.length > lim.captionMax) problemas.push({ nivel: 'error', msg: `Caption de ${caption.length} caracteres; el máximo es ${lim.captionMax}.` });
  const tags = caption.match(HASHTAG_RE) || [];
  if (lim.hashtagsMax != null && tags.length > lim.hashtagsMax) problemas.push({ nivel: 'error', msg: `${tags.length} hashtags; el máximo es ${lim.hashtagsMax}.` });
  if (!filas.some((f) => f.funcion === 'CTA')) problemas.push({ nivel: 'aviso', msg: 'Ninguna toma lleva el llamado a la acción hacia tu servicio.' });
  const dur = tomas.length ? tomas[tomas.length - 1].t_fin_s : 0;
  if (dur > lim.duracionMaxS) problemas.push({ nivel: 'aviso', msg: `El original dura ${dur} s y ${red.nombre} admite ${lim.duracionMaxS} s.` });
  return { filas, caption, hashtags: tags.length, duracion_s: dur, problemas, ok: !problemas.some((p) => p.nivel === 'error') };
}
