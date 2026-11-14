// fetch con reintentos y backoff exponencial ante 429 y errores 5xx.

export class ApiError extends Error {
  constructor(proveedor, status, mensaje, body) {
    super(mensaje);
    this.proveedor = proveedor;
    this.status = status;
    this.body = body;
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function esperaSugerida(res, texto) {
  const h = Number(res.headers.get('retry-after'));
  if (Number.isFinite(h) && h > 0) return h * 1000;
  const m = /try again in (?:(\d+)m)?\s*([\d.]+)\s*(ms|s)/i.exec(texto || '');
  if (m) return ((Number(m[1] || 0) * 60) + (m[3] === 'ms' ? Number(m[2]) / 1000 : Number(m[2]))) * 1000 + 500;
  return null;
}

function mensajeDe(body, texto) {
  const e = body?.error;
  return (typeof e === 'string' ? e : e?.message) || body?.message || (texto || '').slice(0, 300) || 'sin detalle';
}

/**
 * @param opts.proveedor nombre para los mensajes
 * @param opts.reintentos máximo de reintentos (por defecto 4)
 * @param opts.esperaMaxMs si el proveedor pide esperar más que esto, se desiste (por defecto 65 s)
 * @param opts.onWait callback(msRestantes, intento)
 */
export async function fetchJSON(url, init = {}, opts = {}) {
  const { proveedor = 'API', reintentos = 4, esperaMaxMs = 65000, onWait } = opts;
  let ultimo;
  for (let intento = 0; intento <= reintentos; intento++) {
    let res;
    try {
      res = await fetch(url, init);
    } catch (err) {
      ultimo = new ApiError(proveedor, 0, `${proveedor}: no se pudo conectar (${err.message}). Revisa tu conexión.`);
      if (intento === reintentos) break;
      await sleep(1500 * 2 ** intento);
      continue;
    }
    const texto = await res.text();
    let body = null;
    try { body = texto ? JSON.parse(texto) : null; } catch { /* respuesta no JSON */ }
    if (res.ok) return body;
    const msg = mensajeDe(body, texto);
    ultimo = new ApiError(proveedor, res.status, `${proveedor} respondió ${res.status}: ${msg}`, body);
    const reintentable = res.status === 429 || res.status >= 500;
    if (!reintentable || intento === reintentos) break;
    const espera = esperaSugerida(res, msg) ?? 1500 * 2 ** intento;
    if (espera > esperaMaxMs) break; // cuota agotada por un periodo largo: mejor pasar al proveedor de respaldo
    onWait?.(espera, intento + 1);
    await sleep(espera);
  }
  throw ultimo;
}
