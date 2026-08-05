/* ==========================================================================
   KISSWAAR — Core Theme JS (vanilla ES6, no external framework deps)
   ========================================================================== */
(() => {
  'use strict';

  /* ---------------------------------------------------------------------
     0. Utilities
  --------------------------------------------------------------------- */
  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
      catch (e) { return fallback; }
    },
    set(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* quota / privacy mode */ }
    }
  };

  /* ---------------------------------------------------------------------
     1. Theme toggle (light / dark) — persisted
  --------------------------------------------------------------------- */
  const ThemeMode = {
    key: 'kw_theme',
    init() {
      const saved = store.get(this.key, null) ||
        (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme', saved);
      $$('.theme-toggle').forEach(btn => {
        btn.setAttribute('aria-pressed', saved === 'dark');
        btn.addEventListener('click', () => this.toggle());
      });
    },
    toggle() {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      store.set(this.key, next);
      $$('.theme-toggle').forEach(btn => btn.setAttribute('aria-pressed', next === 'dark'));
    }
  };

  /* ---------------------------------------------------------------------
     2. Toast notifications
  --------------------------------------------------------------------- */
  const Toast = {
    wrap: null,
    init() {
      this.wrap = document.createElement('div');
      this.wrap.className = 'kw-toast-wrap';
      this.wrap.setAttribute('role', 'status');
      this.wrap.setAttribute('aria-live', 'polite');
      document.body.appendChild(this.wrap);
    },
    show(msg, icon = 'fa-circle-check') {
      const el = document.createElement('div');
      el.className = 'kw-toast';
      el.innerHTML = `<i class="fa-solid ${icon}"></i><span>${msg}</span>`;
      this.wrap.appendChild(el);
      requestAnimationFrame(() => el.classList.add('show'));
      setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 350);
      }, 2600);
    }
  };

  /* ---------------------------------------------------------------------
     3. Mobile off-canvas menu
  --------------------------------------------------------------------- */
  const MobileMenu = {
    init() {
      const openBtn = $('#mobileMenuOpen');
      const closeBtn = $('#mobileMenuClose');
      const menu = $('#mobileMenu');
      const overlay = $('#mobileOverlay');
      if (!menu) return;
      const open = () => { menu.classList.add('open'); overlay.classList.add('show'); document.body.style.overflow = 'hidden'; };
      const close = () => { menu.classList.remove('open'); overlay.classList.remove('show'); document.body.style.overflow = ''; };
      openBtn && openBtn.addEventListener('click', open);
      closeBtn && closeBtn.addEventListener('click', close);
      overlay && overlay.addEventListener('click', close);

      $$('.mm-accordion-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const panel = btn.nextElementSibling;
          const isOpen = panel.style.maxHeight;
          $$('.mm-accordion-panel').forEach(p => p.style.maxHeight = null);
          if (!isOpen) panel.style.maxHeight = panel.scrollHeight + 'px';
        });
      });
    }
  };

  /* ---------------------------------------------------------------------
     4. AI Search — suggestions, voice search, image search
  --------------------------------------------------------------------- */
  const SearchBox = {
    demoTerms: [
      { icon: 'fa-clock-rotate-left', label: 'Recent', items: ['leather sneakers', 'wireless earbuds', 'silk saree'] },
      { icon: 'fa-arrow-trend-up', label: 'Trending', items: ['festive lighting', 'ceramic dinner set', 'ergonomic chair', 'linen bedsheets'] }
    ],
    init() {
      const input = $('#kwSearchInput');
      const suggestBox = $('#kwSearchSuggest');
      if (!input || !suggestBox) return;

      const render = (query = '') => {
        let html = '';
        this.demoTerms.forEach(group => {
          const items = query
            ? group.items.filter(i => i.toLowerCase().includes(query.toLowerCase()))
            : group.items;
          if (!items.length) return;
          html += `<div class="suggest-label">${group.label}</div>`;
          items.forEach(i => {
            html += `<div class="suggest-item" role="option" tabindex="0"><i class="fa-solid ${group.icon}"></i><span>${i}</span></div>`;
          });
        });
        if (!html) html = `<div class="suggest-item"><i class="fa-solid fa-magnifying-glass"></i><span>Search for "${query}"</span></div>`;
        suggestBox.innerHTML = html;
        $$('.suggest-item', suggestBox).forEach(el => {
          el.addEventListener('click', () => {
            input.value = el.textContent.trim();
            suggestBox.classList.remove('show');
            Toast.show(`Searching "${input.value}"…`, 'fa-magnifying-glass');
          });
        });
      };

      input.addEventListener('focus', () => { render(input.value); suggestBox.classList.add('show'); });
      input.addEventListener('input', () => render(input.value));
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.kw-search')) suggestBox.classList.remove('show');
      });
      $('#kwSearchForm') && $('#kwSearchForm').addEventListener('submit', (e) => {
        e.preventDefault();
        if (input.value.trim()) Toast.show(`Searching "${input.value}"…`, 'fa-magnifying-glass');
        suggestBox.classList.remove('show');
      });

      /* Voice search */
      const micBtn = $('#kwVoiceSearch');
      if (micBtn) {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        micBtn.addEventListener('click', () => {
          if (!SR) { Toast.show('Voice search isn\u2019t supported in this browser.', 'fa-microphone-slash'); return; }
          const recognizer = new SR();
          recognizer.lang = 'en-IN';
          recognizer.interimResults = false;
          micBtn.classList.add('mic-active');
          Toast.show('Listening…', 'fa-microphone');
          recognizer.start();
          recognizer.onresult = (ev) => {
            const text = ev.results[0][0].transcript;
            input.value = text;
            Toast.show(`Heard: "${text}"`, 'fa-microphone');
          };
          recognizer.onerror = () => Toast.show('Couldn\u2019t catch that — try again.', 'fa-microphone-slash');
          recognizer.onend = () => micBtn.classList.remove('mic-active');
        });
      }

      /* Image search (upload trigger — visual search backend not wired in this static theme) */
      const imgBtn = $('#kwImageSearch');
      const imgInput = $('#kwImageSearchFile');
      if (imgBtn && imgInput) {
        imgBtn.addEventListener('click', () => imgInput.click());
        imgInput.addEventListener('change', () => {
          if (imgInput.files && imgInput.files[0]) {
            Toast.show(`Analyzing "${imgInput.files[0].name}" for similar products…`, 'fa-image');
          }
        });
      }
    }
  };

  /* ---------------------------------------------------------------------
     5. Hero slider
  --------------------------------------------------------------------- */
  const HeroSlider = {
    init() {
      const root = $('#heroSlider');
      if (!root) return;
      const slides = $$('.hero-slide', root);
      const dotsWrap = $('#heroDots');
      let idx = 0, timer;

      slides.forEach((_, i) => {
        const dot = document.createElement('button');
        dot.setAttribute('aria-label', `Go to slide ${i + 1}`);
        if (i === 0) dot.classList.add('active');
        dot.addEventListener('click', () => go(i));
        dotsWrap.appendChild(dot);
      });
      const dots = $$('button', dotsWrap);

      function go(i) {
        slides[idx].classList.remove('active');
        dots[idx].classList.remove('active');
        idx = (i + slides.length) % slides.length;
        slides[idx].classList.add('active');
        dots[idx].classList.add('active');
        restart();
      }
      function restart() {
        clearInterval(timer);
        timer = setInterval(() => go(idx + 1), 5500);
      }
      $('.hero-arrow.next', root) && $('.hero-arrow.next', root).addEventListener('click', () => go(idx + 1));
      $('.hero-arrow.prev', root) && $('.hero-arrow.prev', root).addEventListener('click', () => go(idx - 1));
      root.addEventListener('mouseenter', () => clearInterval(timer));
      root.addEventListener('mouseleave', restart);
      restart();
    }
  };

  /* ---------------------------------------------------------------------
     6. Tabs (Trending / Best Sellers / New Arrivals / Recommended)
  --------------------------------------------------------------------- */
  const Tabs = {
    init() {
      $$('.kw-tabs').forEach(group => {
        const btns = $$('.kw-tab-btn', group);
        const panelWrap = document.querySelector(group.dataset.panels);
        if (!panelWrap) return;
        const panels = $$('.kw-tab-panel', panelWrap);
        btns.forEach(btn => {
          btn.addEventListener('click', () => {
            btns.forEach(b => b.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const target = $(`#${btn.dataset.target}`, panelWrap);
            target && target.classList.add('active');
          });
        });
      });
    }
  };

  /* ---------------------------------------------------------------------
     7. Flash sale countdown
  --------------------------------------------------------------------- */
  const FlashTimer = {
    init() {
      $$('.flash-timer[data-ends]').forEach(box => {
        const end = Date.now() + parseInt(box.dataset.ends, 10) * 1000;
        const hEl = $('.t-hours', box), mEl = $('.t-mins', box), sEl = $('.t-secs', box);
        const tick = () => {
          const diff = Math.max(0, end - Date.now());
          const h = Math.floor(diff / 3.6e6);
          const m = Math.floor((diff % 3.6e6) / 6e4);
          const s = Math.floor((diff % 6e4) / 1000);
          if (hEl) hEl.textContent = String(h).padStart(2, '0');
          if (mEl) mEl.textContent = String(m).padStart(2, '0');
          if (sEl) sEl.textContent = String(s).padStart(2, '0');
          if (diff <= 0) clearInterval(iv);
        };
        tick();
        const iv = setInterval(tick, 1000);
      });
    }
  };

  /* ---------------------------------------------------------------------
     8. Wishlist / Compare / Cart — localStorage-backed, event delegated
  --------------------------------------------------------------------- */
  const Cart = {
    keys: { wishlist: 'kw_wishlist', compare: 'kw_compare', cart: 'kw_cart' },
    init() {
      this.refreshCounts();
      document.addEventListener('click', (e) => {
        const wBtn = e.target.closest('[data-wishlist-toggle]');
        const cBtn = e.target.closest('[data-compare-toggle]');
        const aBtn = e.target.closest('[data-add-cart]');
        if (wBtn) this.toggle('wishlist', wBtn);
        if (cBtn) this.toggle('compare', cBtn, 4);
        if (aBtn) this.addToCart(aBtn);
      });
    },
    toggle(type, btn, limit) {
      const id = btn.dataset[type === 'wishlist' ? 'wishlistToggle' : 'compareToggle'];
      let list = store.get(this.keys[type], []);
      const has = list.includes(id);
      if (has) {
        list = list.filter(i => i !== id);
        btn.classList.remove('active');
      } else {
        if (limit && list.length >= limit) {
          Toast.show(`You can compare up to ${limit} products at once.`, 'fa-circle-info');
          return;
        }
        list.push(id);
        btn.classList.add('active');
      }
      store.set(this.keys[type], list);
      this.refreshCounts();
      Toast.show(
        has ? `Removed from ${type}.` : `Added to ${type}.`,
        type === 'wishlist' ? 'fa-heart' : 'fa-code-compare'
      );
    },
    addToCart(btn) {
      const id = btn.dataset.addCart;
      const name = btn.dataset.name || 'Item';
      let cart = store.get(this.keys.cart, {});
      cart[id] = (cart[id] || 0) + 1;
      store.set(this.keys.cart, cart);
      this.refreshCounts();
      Toast.show(`${name} added to cart.`, 'fa-cart-shopping');
    },
    refreshCounts() {
      const wl = store.get(this.keys.wishlist, []).length;
      const cp = store.get(this.keys.compare, []).length;
      const cart = store.get(this.keys.cart, {});
      const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);
      $$('[data-count="wishlist"]').forEach(el => { el.textContent = wl; el.style.display = wl ? 'flex' : 'none'; });
      $$('[data-count="compare"]').forEach(el => { el.textContent = cp; el.style.display = cp ? 'flex' : 'none'; });
      $$('[data-count="cart"]').forEach(el => { el.textContent = cartCount; el.style.display = cartCount ? 'flex' : 'none'; });
      $$('[data-wishlist-toggle]').forEach(btn => {
        btn.classList.toggle('active', store.get(this.keys.wishlist, []).includes(btn.dataset.wishlistToggle));
      });
    }
  };

  /* ---------------------------------------------------------------------
     9. Recently viewed — records product cards with data-record-view
  --------------------------------------------------------------------- */
  const RecentlyViewed = {
    key: 'kw_recent',
    init() {
      document.addEventListener('click', (e) => {
        const el = e.target.closest('[data-record-view]');
        if (!el) return;
        let list = store.get(this.key, []);
        const id = el.dataset.recordView;
        list = list.filter(i => i !== id);
        list.unshift(id);
        list = list.slice(0, 12);
        store.set(this.key, list);
      });
    }
  };

  /* ---------------------------------------------------------------------
     10. Lazy loading (IntersectionObserver fallback for data-src)
  --------------------------------------------------------------------- */
  const LazyLoad = {
    init() {
      const imgs = $$('img[data-src]');
      if (!('IntersectionObserver' in window)) {
        imgs.forEach(img => { img.src = img.dataset.src; });
        return;
      }
      const io = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target;
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
            img.addEventListener('load', () => img.classList.add('loaded'));
            obs.unobserve(img);
          }
        });
      }, { rootMargin: '200px 0px' });
      imgs.forEach(img => io.observe(img));
    }
  };

  /* ---------------------------------------------------------------------
     11. Reveal on scroll
  --------------------------------------------------------------------- */
  const Reveal = {
    init() {
      const els = $$('.reveal');
      if (!('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
      const io = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) { entry.target.classList.add('in'); obs.unobserve(entry.target); }
        });
      }, { threshold: 0.12 });
      els.forEach(e => io.observe(e));
    }
  };

  /* ---------------------------------------------------------------------
     12. Back to top
  --------------------------------------------------------------------- */
  const BackToTop = {
    init() {
      const btn = $('#backToTop');
      if (!btn) return;
      window.addEventListener('scroll', () => {
        btn.classList.toggle('show', window.scrollY > 500);
      }, { passive: true });
      btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }
  };

  /* ---------------------------------------------------------------------
     13. Newsletter form
  --------------------------------------------------------------------- */
  const Newsletter = {
    init() {
      $$('.newsletter-form').forEach(form => {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const input = $('input', form);
          if (input && input.value.trim()) {
            Toast.show('Subscribed! Welcome to KISSWAAR.', 'fa-envelope-circle-check');
            form.reset();
          }
        });
      });
    }
  };

  /* ---------------------------------------------------------------------
     Boot
  --------------------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', () => {
    Toast.init();
    ThemeMode.init();
    MobileMenu.init();
    SearchBox.init();
    HeroSlider.init();
    Tabs.init();
    FlashTimer.init();
    Cart.init();
    RecentlyViewed.init();
    LazyLoad.init();
    Reveal.init();
    BackToTop.init();
    Newsletter.init();
  });
})();
