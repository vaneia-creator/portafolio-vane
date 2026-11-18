// Prompts del plan (sección 10), adaptados para que el LLM devuelva índices y citas verificables.
// Todo lo que devuelve se valida después en código (core/validate.js).

import { TAXONOMY } from './config.js';

const REGLAS = `Reglas obligatorias:
- Responde SOLO con un objeto JSON válido, sin texto adicional.
- No inventes nada. Si falta un dato, usa el valor que se indica para ese caso.
- Prohibido el lenguaje dubitativo ("tal vez", "quizá", "probablemente", "posiblemente"). Afirma solo lo que el texto respalda.
- Escribe en español.`;

const taxonomia = () => Object.entries(TAXONOMY).map(([k, v]) => `${k} = ${v.nombre}`).join('; ');

export function promptConsultas(p) {
  return {
    system: `Eres un investigador de mercado. ${REGLAS}`,
    user: `Tema: "${p.tema}". Servicio que vende el usuario: "${p.nicho_usuario || 'no indicado'}". Audiencia: "${p.audiencia || 'no indicada'}".
Genera entre 8 y 10 consultas de búsqueda para YouTube en español, como las escribiría esa audiencia cuando tiene el problema: el problema en sí, "cómo…", "no puedo…", "por qué no…", comparativas y precios.
Devuelve: {"consultas": ["…", "…"]}`,
  };
}

export function promptHashtags(p, plataforma) {
  return {
    system: `Eres un estratega de contenido en redes. ${REGLAS}`,
    user: `Tema: "${p.tema}". Nicho: "${p.nicho_usuario || 'no indicado'}". Audiencia: "${p.audiencia || 'no indicada'}". Plataforma: ${plataforma}.
Propón de 5 a 8 hashtags en español (sin "#", una sola palabra cada uno, sin espacios) que usan los creadores de este nicho.
Devuelve: {"hashtags": ["…"]}`,
  };
}

export function promptAnotador(project, reel, words) {
  const idx1 = words.findIndex((w) => w.start >= 1);
  const idx3 = words.findIndex((w) => w.start >= 3);
  const numeradas = words.map((w, i) => `[${i}]${String(w.word).trim()}`).join(' ');
  return {
    system: `Eres un analista de guiones de video corto. ${REGLAS}`,
    user: `Nicho del usuario: "${project.nicho_usuario || project.tema}". Audiencia: "${project.audiencia || 'no indicada'}".
Caption del reel: """${(reel.caption || '').slice(0, 600)}"""
Duración: ${reel.duration_s ?? 'desconocida'} s.

Transcripción con cada palabra numerada:
${numeradas}

Datos de tiempo: la primera palabra que empieza después del segundo 1 es la [${idx1 < 0 ? 'ninguna' : idx1}]; después del segundo 3 es la [${idx3 < 0 ? 'ninguna' : idx3}].

Tarea: divide TODA la transcripción en segmentos contiguos que no se solapen (cada palabra pertenece a un solo segmento). Separa el gancho en dos segmentos (antes del segundo 1 y del segundo 1 al 3) cuando haya palabras en ambos tramos. Después del segundo 3 clasifica cada segmento como "desarrollo", "resolucion" o "cta".
Para cada segmento devuelve:
- "w_inicio" y "w_fin": índices de la primera y la última palabra (enteros, inclusivos).
- "seccion": "gancho", "desarrollo", "resolucion" o "cta".
- "funcion": uno de estos códigos: ${taxonomia()}. Si el segmento no tiene un gatillo justificable con su propio texto, usa "sin_gatillo".
- "palabras_gatillo": lista de palabras o expresiones copiadas literalmente del segmento.
- "mecanismo": qué hace el segmento, en una frase.
- "por_que_engancha": por qué funciona con ESTA audiencia y este nicho, citando lo que dice el texto. Sin frases genéricas.
- "patron_reutilizable": la estructura con variables entre corchetes (por ejemplo "[Número] errores que [audiencia] comete con [tema]"). No copies la frase original.
- "confianza": número entre 0 y 1.
No describas imágenes: no las ves.
Devuelve: {"segmentos": [{…}]}`,
  };
}

export function promptExtractor(comentarios) {
  const lista = comentarios.map((c, i) => `[${i}] ${c.texto.slice(0, 500).replace(/\s+/g, ' ')}`).join('\n');
  return {
    system: `Eres un analista de investigación de mercado. ${REGLAS}`,
    user: `Comentarios reales, numerados:
${lista}

Para cada comentario que exprese un problema, frustración o necesidad de quien lo escribe, devuelve un elemento con:
- "i": número del comentario.
- "cita": fragmento copiado LITERALMENTE del comentario, de 25 palabras como máximo, que contiene el dolor.
- "dolor_normalizado": el dolor en 10 palabras como máximo, en forma neutra.
- "emocion": una palabra (frustración, miedo, vergüenza, urgencia, confusión, cansancio, enojo…).
- "intensidad": entero de 1 a 5 (1 = queja leve; 3 = molestia clara y repetida; 5 = desesperación o urgencia explícita).
- "senal_pago": true solo si el comentario menciona un precio, una herramienta o servicio de pago que probó, "pagaría", o contratar a alguien. Si no, false.
- "evidencia_pago": si senal_pago es true, el fragmento LITERAL que lo demuestra; si no, "".
- "solucion_intentada": fragmento LITERAL donde dice qué intentó; si no lo dice, "".
- "tipo_necesidad": "delegar" si quiere que alguien se lo haga, "aprender" si quiere saber cómo hacerlo, "otro" en los demás casos.
Ignora spam, elogios, saludos y preguntas sin problema. Si un comentario no expresa un dolor, omítelo.
Devuelve: {"dolores": [{…}]}`,
  };
}

export function promptAgrupador(dolores, nombresExistentes) {
  const lista = dolores.map((d, i) => `[${i}] ${d}`).join('\n');
  return {
    system: `Eres un analista que agrupa dolores de clientes. ${REGLAS}`,
    user: `Grupos ya existentes: ${nombresExistentes.length ? nombresExistentes.map((n) => `"${n}"`).join(', ') : '(ninguno)'}.

Dolores a clasificar, numerados:
${lista}

Asigna cada dolor a un grupo. Reutiliza un grupo existente cuando el dolor sea el mismo problema de fondo; crea uno nuevo solo si no encaja en ninguno. El nombre del grupo describe el problema en 8 palabras como máximo. No crees grupos genéricos como "otros".
Devuelve: {"asignaciones": [{"i": 0, "grupo": "…"}]} con un elemento por cada dolor.`,
  };
}

export function promptOferta(project, cluster, citas) {
  const formatos = {
    servicio: 'SERVICIO (hecho para el cliente o consultoría): el dolor es urgente y la audiencia quiere delegarlo.',
    infoproducto: 'INFOPRODUCTO (miniguía, plantilla, curso corto o taller): el dolor es de "no sé cómo" y se resuelve con pasos.',
  };
  return {
    system: `Eres un estratega de ofertas. ${REGLAS}`,
    user: `Proyecto: tema "${project.tema}", nicho del usuario "${project.nicho_usuario || 'no indicado'}", audiencia "${project.audiencia || 'no indicada'}".
Dolor validado: "${cluster.nombre}".
Métricas calculadas: ${cluster.autores} autores distintos, intensidad media ${cluster.intensidad.toFixed(2)} de 5, ${(cluster.pago * 100).toFixed(0)} % con señal de pago.
Formato ya decidido por regla: ${formatos[cluster.formato]}
Citas reales (evidencia):
${citas.map((c, i) => `(${i + 1}) "${c.cita_corta}"`).join('\n')}

Redacta la oferta usando solo lo que respaldan las citas. Devuelve:
{"audiencia": "…", "dolor_literal": "cita elegida, copiada tal cual", "resultado_medible": "…", "tiempo": "…", "mecanismo": "…", "objecion_principal": "…", "frase_oferta": "[Audiencia] que sufre [dolor literal] consigue [resultado medible] en [tiempo] con [mecanismo], sin [objeción principal].", "entregables": ["…"], "precio_prueba_hipotesis": "precio sugerido, expresado como hipótesis a validar, con su razonamiento"}
El resultado, el tiempo y el precio son hipótesis tuyas: no las presentes como datos.`,
  };
}

export function promptGuion(project, redKey, red, cluster, citas, patrones) {
  return {
    system: `Eres guionista de video corto. ${REGLAS}`,
    user: `Red: ${red.nombre}. Audiencia: "${project.audiencia || project.nicho_usuario || project.tema}". Nicho del usuario: "${project.nicho_usuario || project.tema}".
Dolor que ataca el guion: "${cluster.nombre}". Citas reales de la audiencia:
${citas.map((c, i) => `(${i + 1}) "${c.cita_corta}"`).join('\n')}

Patrones reutilizables extraídos de reels virales analizados (usa solo estos, por su id):
${patrones.map((p) => `${p.id} | ${p.funcion} | ${p.patron}`).join('\n')}

Especificaciones de ${red.nombre}:
${red.guia.map((g) => `- ${g}`).join('\n')}
- Duración de referencia: ${red.duracionRecomendadaS[0]}–${red.duracionRecomendadaS[1]} s. Máximo absoluto: ${red.limites.duracionMaxS} s.
- Caption: máximo ${red.limites.captionMax} caracteres${red.limites.hashtagsMax != null ? `; máximo ${red.limites.hashtagsMax} hashtags` : ''}.

Escribe un guion original. Cada fila usa la ESTRUCTURA de un patrón de la lista, rellenada con el dolor y el lenguaje de la audiencia. No reproduzcas frases de otros creadores. Incluye exactamente una fila con función CTA, al final.
Devuelve: {"filas": [{"t_inicio_s": 0, "t_fin_s": 2, "texto_hablado": "…", "texto_pantalla": "…", "indicacion_visual": "…", "funcion": "CUR", "patron_id": "id copiado de la lista"}], "caption": "…"}
Los códigos de función válidos son: ${taxonomia()}.`,
  };
}

/** Para Gemini, que recibe el video: describe lo que se ve, se lee y se oye, toma por toma. */
export function promptVisual(reel, transcripcion) {
  return {
    system: `Eres editor de video y analista de reels. Ves y oyes el video adjunto. ${REGLAS}`,
    user: `Analiza este reel${reel.duration_s ? ` de ${reel.duration_s} s` : ''}. Describe SOLO lo que se ve y se oye; si algo no aparece, deja el campo en "".
${transcripcion ? `Transcripción de referencia del audio: """${transcripcion.slice(0, 2500)}"""\n` : ''}
Divide el video en tomas: una toma nueva en cada corte, cambio de plano, cambio de pantalla o cambio de texto en pantalla. Para cada toma:
- "t_inicio_s", "t_fin_s": segundos, con un decimal.
- "plano": tipo de plano o pantalla (por ejemplo: "primer plano a cámara", "plano medio", "pantalla grabada del móvil", "pantalla de ordenador", "b-roll", "texto sobre fondo", "imagen fija").
- "que_se_ve": qué aparece y qué hace la persona o la pantalla, en una frase concreta.
- "texto_en_pantalla": el texto que aparece escrito, copiado literalmente (sin contar los subtítulos automáticos de la voz).
- "edicion": recursos de edición de esa toma (corte seco, zoom, transición, efecto, flecha, círculo, sticker, emoji, cambio de velocidad, pantalla dividida…).
- "audio": "voz", "música", "efecto de sonido" o combinación, y cómo suena.
- "voz": lo que se dice en esa toma, literal.
Además, en "global":
- "formato": cómo está hecho el reel en una frase (por ejemplo: "persona a cámara que alterna con grabación de pantalla").
- "subtitulos": estilo de subtítulos (posición, tamaño, color, palabra a palabra o por frases) o "" si no hay.
- "musica": música de fondo o "".
- "gancho_visual": qué pasa exactamente en el primer segundo.
- "que_ensena": qué enseña o demuestra el reel, con sus pasos si los hay.
- "herramientas_mencionadas": lista de {"nombre", "para_que"} con cada app, herramienta, plataforma o versión que se ve o se nombra.
- "llamado_accion": qué pide al final, o "".
Devuelve: {"global": {…}, "tomas": [{…}]}`,
  };
}

/**
 * "Mi versión": misma estructura, visual, edición y tipo de enseñanza; contenido adaptado al servicio del usuario.
 * Las tomas, sus tiempos y la descripción del original los pone el código; el modelo solo escribe la versión nueva.
 */
export function promptEspejo(project, red, reel, tomas, visual, anot, citas) {
  const filas = tomas.map((t) => `${t.id} | ${t.t_inicio_s}–${t.t_fin_s} s | plano: ${t.plano || '—'} | se ve: ${t.que_se_ve || '—'} | texto en pantalla: "${t.texto_en_pantalla || ''}" | edición: ${t.edicion || '—'} | dice: "${t.dice || ''}" | función: ${t.funciones || '—'}`).join('\n');
  const glob = visual
    ? `Formato: ${visual.formato || '—'}. Subtítulos: ${visual.subtitulos || 'no hay'}. Música: ${visual.musica || 'no hay'}. Gancho visual del primer segundo: ${visual.gancho_visual || '—'}. Ritmo: ${visual.cortes_por_10s ?? '—'} cortes cada 10 s. Qué enseña: ${visual.que_ensena || '—'}. Herramientas que aparecen: ${(visual.herramientas || []).map((x) => `${x.nombre} (${x.para_que})`).join('; ') || 'ninguna'}. Llamado a la acción: ${visual.llamado_accion || 'ninguno'}.`
    : 'No hay análisis visual de este reel: solo se conoce lo que se dice. Propón un plano y una edición coherentes con el texto y márcalo en "que_cambia".';
  const pat = anot.filter((a) => a.patron).map((a) => `${a.funcion}: ${a.patron}`).slice(0, 12).join('\n');
  return {
    system: `Eres guionista y editor de reels. Adaptas reels que funcionaron a otro negocio sin copiar sus frases. ${REGLAS}`,
    user: `REEL ORIGINAL que funcionó (${reel.views ? `${reel.views} reproducciones` : 'reproducciones no disponibles'}):
${glob}
Caption original: """${(reel.caption || '').slice(0, 400)}"""
Tomas del original:
${filas}
${pat ? `Patrones detectados:\n${pat}\n` : ''}
MI NEGOCIO:
- Tema: ${project.tema}
- Mi servicio (lo que vendo): ${project.nicho_usuario || 'no indicado'}
- A quién se lo vendo: ${project.audiencia || 'no indicado'}
- Red donde lo publico: ${red.nombre} (caption de ${red.limites.captionMax} caracteres como máximo${red.limites.hashtagsMax != null ? `, ${red.limites.hashtagsMax} hashtags como máximo` : ''}).
${citas.length ? `Frases reales de mi audiencia (usa su lenguaje cuando encaje):\n${citas.map((c) => `- "${c}"`).join('\n')}\n` : ''}
TAREA: escribe MI VERSIÓN de este reel.
1. Una fila por cada toma del original (${tomas.map((t) => t.id).join(', ')}), en el mismo orden. Cada toma conserva su duración, su tipo de plano, su edición y el mismo estilo de texto en pantalla.
2. Mismo tipo de enseñanza: si el original enseña 3 pasos, el mío enseña 3 pasos; si demuestra una herramienta en pantalla, el mío demuestra en pantalla algo equivalente de mi servicio.
3. El contenido cambia: lo que se enseña pasa a ser algo de mi tema y mi servicio, concreto y útil para quien me compra.
4. Si el original muestra o nombra una herramienta, versión, función, precio o dato que ya no es lo más actual que conoces, usa el equivalente actual y anótalo en "actualizaciones" con "verificar": true.
5. No copies frases del original: como máximo 4 palabras seguidas iguales.
6. La última toma lleva el llamado a la acción hacia mi servicio (función CTA). Si el original tenía un CTA, usa el mismo formato.
Para cada toma devuelve: "toma" (el id), "que_grabas" (qué grabo yo: mismo plano, con mis elementos), "edicion" (qué edición aplico, concreta), "texto_hablado", "texto_pantalla", "funcion" (uno de: ${Object.keys(TAXONOMY).join(', ')}), "que_cambia" (qué adapté respecto al original).
Devuelve: {"filas": [{…}], "caption": "…", "actualizaciones": [{"original": "…", "actual": "…", "motivo": "…", "verificar": true}], "lista_de_grabacion": ["toma o recurso que debo grabar o preparar"], "que_ensena": "qué enseña mi versión en una frase"}`,
  };
}
