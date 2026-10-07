// Smithara shared motion. Elements opt in via data attributes:
// data-hero="n" (load sequence; add data-line for line mask, data-kind="mask|draw|logo|img")
// data-reveal="" | "img" | "mask" | "num"  (+ data-delay="ms") for scroll reveals. No page transitions.
(function () {
  if (window.__smithara) return; window.__smithara = true;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var E = 'cubic-bezier(.22,.61,.36,1)';
  var seen = new WeakSet();
  var KF = {
    up: [{ opacity: 0, transform: 'translateY(28px)' }, { opacity: 1, transform: 'none' }],
    img: [{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }],
    mask: [{ clipPath: 'inset(100% 0 0 0)', transform: 'scale(1.04)' }, { clipPath: 'inset(0 0 0 0)', transform: 'none' }],
    num: [{ opacity: 0, transform: 'translateY(48px)' }, { opacity: 1, transform: 'none' }],
    line: [{ transform: 'translateY(110%)' }, { transform: 'none' }],
    draw: [{ clipPath: 'inset(100% 0 0 0)', opacity: 0 }, { clipPath: 'inset(0 0 0 0)', opacity: 1 }],
    logo: [{ opacity: 0, transform: 'scale(.92) rotate(-8deg)' }, { opacity: 1, transform: 'none' }],
    star: [{ opacity: 0, transform: 'scale(.2) rotate(-90deg)' }, { opacity: 1, transform: 'none' }]
  };
  var DUR = { up: 800, img: 1100, mask: 1300, num: 900, line: 950, draw: 1800, logo: 1000, star: 900 };

  function play(el, kind, delay) {
    el.style.opacity = '';
    el.animate(KF[kind], { duration: DUR[kind], delay: delay, easing: E, fill: 'backwards' });
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      play(en.target, en.target.dataset.reveal || 'up', +(en.target.dataset.delay || 0));
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

  function handle(el) {
    if (seen.has(el)) return; seen.add(el);
    if (reduce) return;
    if (el.dataset.hero !== undefined) {
      var kind = el.hasAttribute('data-line') ? 'line' : (el.dataset.kind || 'up');
      play(el, kind, 120 + (+el.dataset.hero) * 110);
      return;
    }
    var r = el.getBoundingClientRect();
    if (r.top < innerHeight * 0.9 && r.bottom > 0) { play(el, el.dataset.reveal || 'up', +(el.dataset.delay || 0)); return; }
    el.style.opacity = '0';
    io.observe(el);
  }
  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.matches('[data-hero],[data-reveal]')) handle(node);
    node.querySelectorAll('[data-hero],[data-reveal]').forEach(handle);
  }
  function start() {
    scan(document.body);
    new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(scan); }); })
      .observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

  try { sessionStorage.removeItem('sm-transition'); } catch (e) {}
  // Same-page anchors (e.g. Home.dc.html#reviews while on Home) scroll smoothly instead of reloading.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented || a.target === '_blank') return;
    var href = a.getAttribute('href');
    if (!/\.dc\.html#/.test(href)) return;
    var url = new URL(href, location.href);
    if (url.pathname !== location.pathname) return;
    var t = document.querySelector(url.hash);
    if (!t) return;
    e.preventDefault();
    window.scrollTo({ top: t.getBoundingClientRect().top + scrollY - 24, behavior: reduce ? 'auto' : 'smooth' });
  });
})();
