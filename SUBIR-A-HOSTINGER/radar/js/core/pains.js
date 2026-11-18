// Validación de dolores (sección 4 del plan). Las métricas de cada cluster se calculan en código
// a partir de las menciones verificadas; el LLM solo propone el nombre del grupo.

import { origenDe } from './normalize.js';

const DAY_MS = 86400000;

/** Lee el CSV que descarga Google Trends ("Interés a lo largo del tiempo"). */
export function parseTrendsCSV(text) {
  const puntos = [];
  for (const linea of String(text).split(/\r?\n/)) {
    const m = linea.match(/^\s*"?(\d{4}-\d{2}(?:-\d{2})?)"?\s*[,;\t]\s*"?(<?\s*\d+)/);
    if (!m) continue;
    const valor = m[2].includes('<') ? 0.5 : Number(m[2]);
    puntos.push({ fecha: m[1], valor });
  }
  return puntos;
}

/** Tendencia: media del último cuarto de la serie ÷ media del primer cuarto. */
export function trendVerdict(puntos, minRatio) {
  if (!puntos || puntos.length < 8) return { estado: 'dato_insuficiente', motivo: 'Sin CSV de Google Trends o con menos de 8 puntos.' };
  const q = Math.max(2, Math.floor(puntos.length / 4));
  const media = (arr) => arr.reduce((a, p) => a + p.valor, 0) / arr.length;
  const ini = media(puntos.slice(0, q));
  const fin = media(puntos.slice(-q));
  if (ini === 0) return { estado: fin > 0 ? 'creciente' : 'dato_insuficiente', ratio: null, ini, fin, motivo: fin > 0 ? '' : 'Serie sin interés registrado.' };
  const ratio = fin / ini;
  const estado = ratio < minRatio ? 'decreciente' : ratio >= 2 - minRatio ? 'creciente' : 'estable';
  return { estado, ratio, ini, fin, desde: puntos[0].fecha, hasta: puntos[puntos.length - 1].fecha };
}

/**
 * Calcula métricas, umbrales y Pain Score por cluster.
 * @param menciones pain_mentions con cluster_id asignado
 * @param clusters [{id, nombre}]
 */
export function scoreClusters(menciones, clusters, th, nowMs, trend) {
  const base = clusters.map((cl) => {
    const ms = menciones.filter((m) => m.cluster_id === cl.id);
    const autores = new Set(ms.map((m) => m.autor_hash)).size;
    const fuentes = [...new Set(ms.map((m) => m.fuente))].sort();
    const origenes = [...new Set(ms.map((m) => m.origen || origenDe(m.url)))];
    const intensidad = ms.length ? ms.reduce((a, m) => a + m.intensidad, 0) / ms.length : null;
    const pago = ms.length ? ms.filter((m) => m.senal_pago).length / ms.length : null;
    const fechadas = ms.filter((m) => Number.isFinite(Date.parse(m.fecha)));
    const limite = nowMs - th.recencyMonths * 30.4375 * DAY_MS;
    const recencia = fechadas.length ? fechadas.filter((m) => Date.parse(m.fecha) >= limite).length / fechadas.length : null;
    const delegar = ms.filter((m) => m.tipo_necesidad === 'delegar').length;
    const aprender = ms.filter((m) => m.tipo_necesidad === 'aprender').length;
    return { ...cl, n_menciones: ms.length, autores, fuentes, n_origenes: origenes.length, intensidad, pago, recencia, n_fechadas: fechadas.length, delegar, aprender };
  });
  const maxAutores = Math.max(0, ...base.map((c) => c.autores));
  const trendEstado = trend?.estado || 'dato_insuficiente';
  return base
    .map((c) => {
      const criterios = {
        frecuencia: c.autores >= th.painMinAuthors && c.n_origenes >= th.painMinSources,
        intensidad: c.intensidad != null && c.intensidad >= th.painMinIntensity,
        pago: c.pago != null && c.pago >= th.painMinPay,
        recencia: c.recencia != null && c.recencia >= th.painMinRecency,
        mercado: trendEstado === 'dato_insuficiente' ? null : trendEstado !== 'decreciente',
      };
      const frecNorm = maxAutores ? c.autores / maxAutores : 0;
      const pain_score =
        th.wFreq * frecNorm + th.wInt * ((c.intensidad ?? 0) / 5) + th.wPay * (c.pago ?? 0) + th.wRec * (c.recencia ?? 0);
      const cuatro = criterios.frecuencia && criterios.intensidad && criterios.pago && criterios.recencia;
      const valida = cuatro && criterios.mercado !== false;
      // Guion de audiencia: intensidad alta pero señal de pago baja (cumple todo salvo el pago).
      const soloGuion = !valida && criterios.frecuencia && criterios.intensidad && criterios.recencia && criterios.pago === false && criterios.mercado !== false;
      let formato = null;
      if (valida) formato = c.delegar > c.aprender ? 'servicio' : 'infoproducto';
      else if (soloGuion) formato = 'guion';
      return { ...c, frecNorm, pain_score, criterios, valida, formato, mercado_estado: trendEstado };
    })
    .sort((a, b) => b.pain_score - a.pain_score || (a.id < b.id ? -1 : 1));
}

/** Hasta `n` citas por cluster: primero las más intensas, sin repetir autor. */
export function topCitas(menciones, clusterId, n = 5) {
  const vistos = new Set();
  return menciones
    .filter((m) => m.cluster_id === clusterId)
    .sort((a, b) => b.intensidad - a.intensidad || Number(b.senal_pago) - Number(a.senal_pago) || (a.id < b.id ? -1 : 1))
    .filter((m) => (vistos.has(m.autor_hash) ? false : (vistos.add(m.autor_hash), true)))
    .slice(0, n);
}
