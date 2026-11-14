// Cliente de Apify (API v2). Ejecuta actores públicos que leen datos públicos sin iniciar sesión.

import { fetchJSON, sleep, ApiError } from './http.js';
import { getSettings } from './store.js';

const BASE = 'https://api.apify.com/v2';

function auth() {
  const token = getSettings().keys.apify;
  if (!token) throw new ApiError('Apify', 0, 'Falta el token de Apify. Añádelo en Configuración.');
  return { Authorization: `Bearer ${token}` };
}

/** Datos de la cuenta y consumo del mes (para la prueba de conexión). */
export async function apifyAccount() {
  const me = await fetchJSON(`${BASE}/users/me`, { headers: auth() }, { proveedor: 'Apify', reintentos: 1 });
  let limites = null;
  try { limites = await fetchJSON(`${BASE}/users/me/limits`, { headers: auth() }, { proveedor: 'Apify', reintentos: 1 }); } catch { /* opcional */ }
  return {
    usuario: me?.data?.username ?? null,
    plan: me?.data?.plan?.id ?? null,
    usoMesUsd: limites?.data?.current?.monthlyUsageUsd ?? null,
    limiteMesUsd: limites?.data?.limits?.maxMonthlyUsageUsd ?? null,
  };
}

/**
 * Ejecuta un actor, espera a que termine y devuelve sus resultados reales.
 * @param maxChargeUsd tope de gasto de la ejecución (Apify la detiene al alcanzarlo)
 */
export async function runActor(actorId, input, { maxChargeUsd, onStatus } = {}) {
  const q = new URLSearchParams();
  if (maxChargeUsd) q.set('maxTotalChargeUsd', String(maxChargeUsd));
  const start = await fetchJSON(
    `${BASE}/acts/${actorId}/runs?${q}`,
    { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
    { proveedor: 'Apify', reintentos: 1 },
  );
  let run = start?.data;
  if (!run?.id) throw new ApiError('Apify', 0, 'Apify no devolvió el identificador de la ejecución.');
  const t0 = Date.now();
  while (['READY', 'RUNNING'].includes(run.status)) {
    onStatus?.(`Apify ${actorId.replace('~', '/')}: ${run.status === 'READY' ? 'en cola' : 'ejecutando'} (${Math.round((Date.now() - t0) / 1000)} s)`);
    if (Date.now() - t0 > 15 * 60000) throw new ApiError('Apify', 0, `La ejecución ${run.id} lleva más de 15 minutos. Revísala en console.apify.com.`);
    await sleep(1000);
    const r = await fetchJSON(`${BASE}/actor-runs/${run.id}?waitForFinish=25`, { headers: auth() }, { proveedor: 'Apify' });
    run = r.data;
  }
  if (run.status !== 'SUCCEEDED') {
    throw new ApiError('Apify', 0, `La ejecución de ${actorId.replace('~', '/')} terminó con estado ${run.status}${run.statusMessage ? `: ${run.statusMessage}` : ''}.`);
  }
  const items = await fetchJSON(`${BASE}/datasets/${run.defaultDatasetId}/items?clean=true&format=json`, { headers: auth() }, { proveedor: 'Apify' });
  return {
    items: Array.isArray(items) ? items : [],
    run: { id: run.id, actor: actorId.replace('~', '/'), terminado: run.finishedAt, costoUsd: typeof run.usageTotalUsd === 'number' ? run.usageTotalUsd : null },
  };
}
