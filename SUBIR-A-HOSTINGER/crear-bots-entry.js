/*
 * Vane.IA — Punto de entrada a la sección "Crear bots".
 * Se ejecuta DESPUÉS de que React termina de montar la página, para no
 * interferir con la hidratación. Añade:
 *   1) Un enlace "Crear bots" en el menú de navegación.
 *   2) Una píldora flotante siempre visible (garantiza el acceso en móvil).
 * React tolera nodos externos en <body>, así que esto es seguro.
 */
(function () {
  var TARGET = '/crear-bots/';
  var LABEL = 'Crear bots';

  function injectNavLink() {
    var nav = document.querySelector('.navlinks');
    if (!nav || nav.querySelector('[data-vane-bots]')) return;
    var cta = nav.querySelector('.navcta');
    var a = document.createElement('a');
    a.href = TARGET;
    a.textContent = LABEL;
    a.setAttribute('data-vane-bots', '1');
    if (cta) nav.insertBefore(a, cta);
    else nav.appendChild(a);
  }

  function injectFloatingPill() {
    if (document.querySelector('[data-vane-bots-pill]')) return;
    var pill = document.createElement('a');
    pill.href = TARGET;
    pill.setAttribute('data-vane-bots-pill', '1');
    pill.innerHTML = '<span aria-hidden="true">✦</span> Crear bots';
    pill.style.cssText = [
      'position:fixed', 'right:18px', 'bottom:18px', 'z-index:9999',
      'display:inline-flex', 'align-items:center', 'gap:.5em',
      'padding:.75rem 1.15rem', 'border-radius:999px',
      'background:#d8577e', 'color:#fff', 'font-weight:700',
      'font-size:.9rem', 'text-decoration:none',
      'font-family:Inter,system-ui,sans-serif',
      'box-shadow:0 12px 28px -8px rgba(119,29,59,.55)',
      'transition:transform .18s ease'
    ].join(';');
    pill.addEventListener('mouseenter', function () { pill.style.transform = 'translateY(-3px)'; });
    pill.addEventListener('mouseleave', function () { pill.style.transform = 'none'; });
    document.body.appendChild(pill);
  }

  function run() {
    injectNavLink();
    injectFloatingPill();
    // La navegación puede re-renderizar; reintentamos por si acaso.
    var tries = 0;
    var iv = setInterval(function () {
      injectNavLink();
      if (++tries >= 5) clearInterval(iv);
    }, 800);
  }

  // Esperamos a que React termine de hidratar.
  if (document.readyState === 'complete') {
    setTimeout(run, 600);
  } else {
    window.addEventListener('load', function () { setTimeout(run, 600); });
  }
})();
