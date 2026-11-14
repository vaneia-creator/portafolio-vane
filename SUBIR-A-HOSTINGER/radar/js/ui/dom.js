// Utilidades de interfaz. Todo texto externo se inserta como nodo de texto (nunca como HTML).

import { TAXONOMY } from '../core/config.js';

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const nf = new Intl.NumberFormat('es-ES', { useGrouping: 'always' });
export const fmt = {
  n: (v) => (v == null ? '—' : nf.format(Math.round(v))),
  d: (v, dec = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec })),
  pct: (v, dec = 0) => (v == null ? '—' : `${(v * 100).toLocaleString('es-ES', { maximumFractionDigits: dec })} %`),
  usd: (v) => (v == null ? '—' : `$${v.toFixed(2)}`),
  fecha: (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; },
  fechaHora: (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : '—'; },
  t: (ms) => { const s = ms / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; },
};

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', {}, hint) : null);
}
export const input = (attrs) => h('input', { type: 'text', autocomplete: 'off', ...attrs });
export const btn = (texto, onclick, cls = '') => h('button', { type: 'button', class: `btn ${cls}`.trim(), onclick }, texto);

export function fnChip(code) {
  const t = TAXONOMY[code];
  if (!t) return h('span', { class: 'fn none', title: 'Sin gatillo justificable con el texto' }, 'sin gatillo');
  return h('span', { class: 'fn', style: `background:${t.color}`, title: t.nombre }, code);
}

export function etiquetaPill(e) {
  const cls = { 'Mega-viral': 'mega', Viral: 'viral', 'Sobre la media': 'above' }[e] || '';
  return h('span', { class: `pill ${cls}` }, e);
}

export function table(cols, rows) {
  return h('div', { class: 'tableWrap' }, h('table', {},
    h('thead', {}, h('tr', {}, cols.map((c) => h('th', { class: c.n ? 'n' : '', title: c.title }, c.h)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, cols.map((c) => h('td', { class: [c.n ? 'n' : '', c.wrap ? 'wrap' : ''].join(' ').trim() }, c.v(r))))))));
}

export const link = (url, texto) => h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, texto || url);
export const note = (cls, ...c) => h('div', { class: `note ${cls}`.trim() }, ...c);
export const empty = (texto) => h('p', { class: 'empty' }, texto);

export function download(nombre, contenido, tipo = 'application/json') {
  const a = h('a', { href: URL.createObjectURL(new Blob([contenido], { type: tipo })), download: nombre });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function toCSV(cols, rows) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [cols.map((c) => esc(c.h)).join(';'), ...rows.map((r) => cols.map((c) => esc(c.v(r))).join(';'))].join('\r\n');
}
