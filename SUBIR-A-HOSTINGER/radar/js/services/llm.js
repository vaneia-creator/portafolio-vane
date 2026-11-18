// Análisis con LLM con cadena de respaldo: Groq → Gemini Flash-Lite → OpenRouter (:free).
// Cada respuesta se devuelve con el proveedor y el modelo que la generó.

import { fetchJSON, ApiError } from './http.js';
import { getSettings, bump, overLimit } from './store.js';

export function parseJSON(texto) {
  let t = String(texto || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* intenta recortar */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('la respuesta no es JSON');
}

async function openaiCompat(proveedor, url, key, model, { system, user, maxTokens }, extra, onWait) {
  const body = {
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0,
    response_format: { type: 'json_object' },
    ...extra(maxTokens),
  };
  const r = await fetchJSON(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { proveedor, onWait });
  return { texto: r?.choices?.[0]?.message?.content, tokens: r?.usage?.total_tokens ?? 0, modelo: r?.model || model };
}

const PROVEEDORES = [
  {
    id: 'groq_llm', nombre: 'Groq', key: (s) => s.keys.groq, model: (s) => s.models.groqLlm,
    call: (s, req, onWait) => openaiCompat('Groq', 'https://api.groq.com/openai/v1/chat/completions', s.keys.groq, s.models.groqLlm, req,
      (max) => ({ max_completion_tokens: max, seed: 7, ...(s.models.groqLlm.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}) }), onWait),
  },
  {
    id: 'gemini', nombre: 'Gemini', key: (s) => s.keys.gemini, model: (s) => s.models.gemini,
    call: async (s, { system, user, maxTokens }, onWait) => {
      const r = await fetchJSON(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.models.gemini)}:generateContent?key=${encodeURIComponent(s.keys.gemini)}`,
        {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: maxTokens },
          }),
        }, { proveedor: 'Gemini', onWait });
      return {
        texto: (r?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''),
        tokens: r?.usageMetadata?.totalTokenCount ?? 0, modelo: r?.modelVersion || s.models.gemini,
      };
    },
  },
  {
    id: 'openrouter', nombre: 'OpenRouter', key: (s) => s.keys.openrouter, model: (s) => s.models.openrouter,
    call: (s, req, onWait) => openaiCompat('OpenRouter', 'https://openrouter.ai/api/v1/chat/completions', s.keys.openrouter, s.models.openrouter, req,
      (max) => ({ max_tokens: max }), onWait),
  },
];

export const llmDisponible = () => { const s = getSettings(); return PROVEEDORES.some((p) => p.key(s)); };

/**
 * Pide JSON al primer proveedor disponible; si falla o agotó su cuota, pasa al siguiente.
 * @returns {{json, proveedor, modelo, fecha}}
 */
export async function llmJSON({ system, user, maxTokens = 4000 }, onLog) {
  const s = getSettings();
  const activos = PROVEEDORES.filter((p) => p.key(s));
  if (!activos.length) throw new ApiError('LLM', 0, 'Falta una clave de LLM. Añade al menos la de Groq en Configuración.');
  const errores = [];
  for (const p of activos) {
    const tope = overLimit(p.id, { requests: 1 });
    if (tope) { errores.push(tope); onLog?.(`${tope} Paso al siguiente proveedor.`); continue; }
    try {
      bump(p.id, { requests: 1 }); // las solicitudes fallidas también consumen cuota
      const r = await p.call(s, { system, user, maxTokens }, (ms) => onLog?.(`${p.nombre} pide esperar ${Math.ceil(ms / 1000)} s (límite por minuto)…`));
      if (r.tokens) bump(p.id, { tokens: r.tokens });
      const json = parseJSON(r.texto);
      return { json, proveedor: p.nombre, modelo: r.modelo, fecha: new Date().toISOString() };
    } catch (err) {
      errores.push(`${p.nombre}: ${err.message}`);
      onLog?.(`${p.nombre} falló (${err.message}).${activos[activos.length - 1] === p ? '' : ' Paso al proveedor de respaldo.'}`);
    }
  }
  throw new ApiError('LLM', 0, `Ningún proveedor de LLM respondió. ${errores.join(' | ')}`);
}

/** Pruebas de conexión: lista los modelos reales de la cuenta y comprueba que el configurado existe. */
export async function testProveedor(id) {
  const s = getSettings();
  if (id === 'groq') {
    const r = await fetchJSON('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${s.keys.groq}` } }, { proveedor: 'Groq', reintentos: 0 });
    const ids = (r?.data || []).map((m) => m.id);
    return { ids, faltan: [s.models.groqLlm, s.models.groqStt].filter((m) => !ids.includes(m)) };
  }
  if (id === 'gemini') {
    const r = await fetchJSON(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(s.keys.gemini)}`, {}, { proveedor: 'Gemini', reintentos: 0 });
    const ids = (r?.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
    return { ids, faltan: [s.models.gemini, s.models.geminiVideo].filter((m) => m && !ids.includes(m)) };
  }
  if (id === 'openrouter') {
    const k = await fetchJSON('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${s.keys.openrouter}` } }, { proveedor: 'OpenRouter', reintentos: 0 });
    const r = await fetchJSON('https://openrouter.ai/api/v1/models', {}, { proveedor: 'OpenRouter', reintentos: 0 });
    const ids = (r?.data || []).map((m) => m.id).filter((m) => m.endsWith(':free') || m === 'openrouter/free');
    return { ids, faltan: ids.includes(s.models.openrouter) ? [] : [s.models.openrouter], cuenta: k?.data || null };
  }
  throw new Error('proveedor desconocido');
}
