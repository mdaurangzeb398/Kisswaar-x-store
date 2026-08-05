/* ==========================================================================
   KISSWAAR — Product Listing Page logic
   ========================================================================== */
(() => {
  'use strict';
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

  /* ---- Demo catalog (48 items) — replace with API data in production ---- */
  const ADJ = ['Aura','Solstice','Nimbus','Forge','Willow','Pace','Coastal','Rooted','Keystroke','Highland','Echo','Zenith','Glacier','Voyager','Marlowe','Brewhaus','Norrland','Stride','Terra','Cloudweave','Arc','Prop','Kiln','Folio','Ember','Horizon','Market'];
  const NOUN = ['Wireless Earbuds','Running Sneakers','Denim Jacket','Desk Lamp','Leather Backpack','Ceramic Mug Set','Yoga Mat','Wool Throw','Fitness Watch','Linen Shirt','Table Planter','Cold Brew Maker','Insulated Bottle','Mechanical Keyboard','Sunglasses','Notebook','Phone Stand','Canvas Tote','Chef Knife','Storage Basket','Compression Socks','Action Camera','Memory-Foam Pillow','Bedsheet Set'];
  const CATS = [
    { key: 'fashion', label: 'Fashion' },
    { key: 'electronics', label: 'Electronics' },
    { key: 'home', label: 'Home & Living' },
    { key: 'beauty', label: 'Beauty' },
    { key: 'sports', label: 'Sports & Fitness' }
  ];
  const BRANDS = ['Norrland','Stride','Echo','Glacier','Voyager','Rooted','Zenith','Forge'];
  const COLORS = [
    { key: 'black', hex: '#1C1B18' }, { key: 'ivory', hex: '#F0EADB' }, { key: 'emerald', hex: '#0B3D2E' },
    { key: 'gold', hex: '#C9A227' }, { key: 'rust', hex: '#B23A2E' }, { key: 'navy', hex: '#1F2E4A' }
  ];
  const SIZES = ['XS','S','M','L','XL'];

  function seededRand(seed) {
    let x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  const CATALOG = Array.from({ length: 48 }, (_, i) => {
    const n = i + 1;
    const cat = CATS[i % CATS.length];
    const brand = BRANDS[i % BRANDS.length];
    const base = Math.floor(seededRand(n) * 6000) + 399;
    const hasDiscount = seededRand(n * 3) > 0.4;
    const was = hasDiscount ? Math.round(base * (1 + seededRand(n * 5) * 0.6)) : null;
    const rating = Math.round((seededRand(n * 7) * 2 + 3) * 2) / 2; // 3.0–5.0
    return {
      id: `plp-${n}`,
      name: `${ADJ[i % ADJ.length]} ${NOUN[(i * 3) % NOUN.length]}`,
      brand,
      category: cat.key,
      categoryLabel: cat.label,
      price: base,
      was,
      rating,
      reviews: Math.floor(seededRand(n * 11) * 4000) + 12,
      colors: [COLORS[i % COLORS.length].key, COLORS[(i + 2) % COLORS.length].key],
      sizes: cat.key === 'fashion' ? [SIZES[i % SIZES.length], SIZES[(i + 1) % SIZES.length]] : [],
      img: `plp-item-${n}`,
      isNew: seededRand(n * 13) > 0.75,
      isBestseller: seededRand(n * 17) > 0.8,
      createdRank: n
    };
  });

  /* ---- State ---- */
  const state = {
    category: new Set(),
    brand: new Set(),
    color: new Set(),
    size: new Set(),
    minRating: 0,
    priceMin: 0,
    priceMax: 9000,
    sort: 'relevance',
    view: 'grid',
    pageSize: 12,
    visibleCount: 12
  };

  function applyUrlCategory() {
    const params = new URLSearchParams(window.location.search);
    const cat = params.get('cat');
    if (cat && CATS.some(c => c.key === cat)) state.category.add(cat);
  }

  function filteredSorted() {
    let list = CATALOG.filter(p => {
      if (state.category.size && !state.category.has(p.category)) return false;
      if (state.brand.size && !state.brand.has(p.brand)) return false;
      if (state.color.size && !p.colors.some(c => state.color.has(c))) return false;
      if (state.size.size && !p.sizes.some(s => state.size.has(s))) return false;
      if (state.minRating && p.rating < state.minRating) return false;
      if (p.price < state.priceMin || p.price > state.priceMax) return false;
      return true;
    });
    switch (state.sort) {
      case 'price-asc': list.sort((a, b) => a.price - b.price); break;
      case 'price-desc': list.sort((a, b) => b.price - a.price); break;
      case 'rating': list.sort((a, b) => b.rating - a.rating); break;
      case 'newest': list.sort((a, b) => b.createdRank - a.createdRank); break;
      default: break; // relevance = catalog order
    }
    return list;
  }

  /* ---- Rendering ---- */
  function starString(rating) {
    const full = Math.floor(rating);
    const half = rating % 1 >= 0.5;
    return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(5 - full - (half ? 1 : 0));
  }

  function cardHTML(p) {
    const off = p.was ? Math.round((1 - p.price / p.was) * 100) : null;
    return `
    <div class="product-card">
      <div class="kw-card">
        <div class="product-media">
          <span class="product-badges">
            ${off ? `<span class="pill-badge sale">-${off}%</span>` : ''}
            ${p.isNew ? `<span class="pill-badge new">New</span>` : ''}
            ${p.isBestseller ? `<span class="pill-badge bestseller">Bestseller</span>` : ''}
          </span>
          <span class="product-quick-actions">
            <button class="qa-btn" data-wishlist-toggle="${p.id}" aria-label="Add to wishlist"><i class="fa-regular fa-heart"></i></button>
            <button class="qa-btn" data-compare-toggle="${p.id}" aria-label="Add to compare"><i class="fa-solid fa-code-compare"></i></button>
          </span>
          <img class="img-primary" data-src="https://picsum.photos/seed/${p.img}/420/420" alt="${p.name}" loading="lazy" data-record-view="${p.id}">
          <div class="product-card-add"><button class="btn-kw btn-primary btn-sm" data-add-cart="${p.id}" data-name="${p.name}"><i class="fa-solid fa-bag-shopping"></i> Add to Cart</button></div>
        </div>
        <div class="product-info">
          <span class="product-brand">${p.brand}</span>
          <a href="pdp.html?id=${p.id}" class="product-title">${p.name}</a>
          <p class="product-desc-inline">${p.categoryLabel} · Crafted for everyday premium living, quality-checked before dispatch.</p>
          <div class="product-rating"><span class="stars">${starString(p.rating)}</span><span class="rating-count">${p.rating.toFixed(1)} (${p.reviews.toLocaleString('en-IN')})</span></div>
          <div class="product-price-row">
            <span class="price-now">₹${p.price.toLocaleString('en-IN')}</span>
            ${p.was ? `<span class="price-was">₹${p.was.toLocaleString('en-IN')}</span><span class="price-off">${off}% off</span>` : ''}
          </div>
          <span class="product-meta-mini"><i class="fa-solid fa-truck-fast"></i> Free delivery available</span>
        </div>
      </div>
    </div>`;
  }

  function lazyObserve(container) {
    const imgs = $$('img[data-src]', container);
    if (!('IntersectionObserver' in window)) { imgs.forEach(i => i.src = i.dataset.src); return; }
    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.src = e.target.dataset.src; e.target.removeAttribute('data-src'); obs.unobserve(e.target); }
      });
    }, { rootMargin: '250px' });
    imgs.forEach(i => io.observe(i));
  }

  function revealObserve(container) {
    const els = $$('.reveal', container);
    if (!('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); } });
    }, { threshold: 0.1 });
    els.forEach(e => io.observe(e));
  }

  function renderActivePills() {
    const wrap = $('#activeFilterPills');
    if (!wrap) return;
    let pills = [];
    state.category.forEach(c => pills.push({ type: 'category', value: c, label: CATS.find(x => x.key === c).label }));
    state.brand.forEach(b => pills.push({ type: 'brand', value: b, label: b }));
    state.color.forEach(c => pills.push({ type: 'color', value: c, label: c[0].toUpperCase() + c.slice(1) }));
    state.size.forEach(s => pills.push({ type: 'size', value: s, label: 'Size ' + s }));
    if (state.minRating) pills.push({ type: 'rating', value: state.minRating, label: state.minRating + '★ & up' });

    wrap.innerHTML = pills.map(p => `
      <span class="active-pill" data-pill-type="${p.type}" data-pill-value="${p.value}">
        ${p.label} <button aria-label="Remove filter"><i class="fa-solid fa-xmark"></i></button>
      </span>`).join('');
    wrap.style.display = pills.length ? 'flex' : 'none';

    $$('.active-pill button', wrap).forEach(btn => {
      btn.addEventListener('click', () => {
        const pill = btn.closest('.active-pill');
        const { pillType, pillValue } = pill.dataset;
        if (pillType === 'rating') state.minRating = 0;
        else state[pillType].delete(pillValue);
        syncFilterUI();
        state.visibleCount = state.pageSize;
        render();
      });
    });
  }

  function syncFilterUI() {
    $$('.kw-check[data-filter-type]').forEach(chk => {
      const input = $('input', chk);
      input.checked = state[chk.dataset.filterType].has(chk.dataset.filterValue);
    });
    $$('.swatch[data-color]').forEach(sw => sw.classList.toggle('active', state.color.has(sw.dataset.color)));
    $$('.chip[data-size]').forEach(c => c.classList.toggle('active', state.size.has(c.dataset.size)));
    $$('.rating-filter-item[data-rating]').forEach(r => r.classList.toggle('active', Number(r.dataset.rating) === state.minRating));
  }

  function updateResultsCount(total) {
    const el = $('#plpResultCount');
    if (el) el.textContent = `${total.toLocaleString('en-IN')} results`;
  }

  function renderPagination(total) {
    const wrap = $('#plpPagination');
    if (!wrap) return;
    const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    const currentPage = Math.min(totalPages, Math.ceil(state.visibleCount / state.pageSize));
    if (totalPages <= 1) { wrap.innerHTML = ''; return; }

    let html = `<button ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}" aria-label="Previous page"><i class="fa-solid fa-chevron-left"></i></button>`;
    const windowSize = 2;
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= currentPage - windowSize && i <= currentPage + windowSize)) {
        html += `<button data-page="${i}" class="${i === currentPage ? 'active' : ''}">${i}</button>`;
      } else if (i === currentPage - windowSize - 1 || i === currentPage + windowSize + 1) {
        html += `<span class="dots">…</span>`;
      }
    }
    html += `<button ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}" aria-label="Next page"><i class="fa-solid fa-chevron-right"></i></button>`;
    wrap.innerHTML = html;

    $$('button[data-page]', wrap).forEach(btn => {
      btn.addEventListener('click', () => {
        const page = Number(btn.dataset.page);
        state.visibleCount = Math.min(total, page * state.pageSize);
        render(true);
        $('#plpGrid').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  let loading = false;
  function render(skipPillRerender) {
    const grid = $('#plpGrid');
    const noResults = $('#plpNoResults');
    if (!grid) return;
    const list = filteredSorted();
    updateResultsCount(list.length);
    if (!skipPillRerender) renderActivePills();

    if (!list.length) {
      grid.innerHTML = '';
      noResults.style.display = 'block';
      renderPagination(0);
      return;
    }
    noResults.style.display = 'none';

    const visible = list.slice(0, state.visibleCount);
    grid.className = `product-grid row g-3 g-md-4 ${state.view === 'list' ? 'list-mode' : ''}`;
    grid.innerHTML = visible.map(p => `<div class="${state.view === 'grid' ? 'col-6 col-md-4 col-lg-3' : 'col-12'} reveal in">${cardHTML(p)}</div>`).join('');
    lazyObserve(grid);
    revealObserve(grid);
    renderPagination(list.length);

    const sentinel = $('#infiniteSentinel');
    if (sentinel) sentinel.style.display = state.visibleCount >= list.length ? 'none' : 'block';
  }

  function loadMore() {
    const total = filteredSorted().length;
    if (loading || state.visibleCount >= total) return;
    loading = true;
    $('#infiniteLoader').style.display = 'flex';
    setTimeout(() => {
      state.visibleCount = Math.min(total, state.visibleCount + state.pageSize);
      render(true);
      $('#infiniteLoader').style.display = 'none';
      loading = false;
    }, 500); // simulate network latency
  }

  /* ---- Filter panel interactions ---- */
  function initFilterGroups() {
    $$('.filter-group-title').forEach(btn => {
      const group = btn.closest('.filter-group');
      const body = $('.filter-group-body', group);
      body.style.maxHeight = body.scrollHeight + 'px';
      btn.addEventListener('click', () => {
        group.classList.toggle('collapsed');
        if (!group.classList.contains('collapsed')) body.style.maxHeight = body.scrollHeight + 'px';
      });
    });
  }

  function initCheckboxFilters() {
    $$('.kw-check[data-filter-type] input').forEach(input => {
      input.addEventListener('change', () => {
        const chk = input.closest('.kw-check');
        const { filterType, filterValue } = chk.dataset;
        if (input.checked) state[filterType].add(filterValue); else state[filterType].delete(filterValue);
        state.visibleCount = state.pageSize;
        render();
      });
    });
  }

  function initSwatches() {
    $$('.swatch[data-color]').forEach(sw => {
      sw.addEventListener('click', () => {
        const c = sw.dataset.color;
        state.color.has(c) ? state.color.delete(c) : state.color.add(c);
        state.visibleCount = state.pageSize;
        syncFilterUI();
        render();
      });
    });
  }

  function initSizeChips() {
    $$('.chip[data-size]').forEach(c => {
      c.addEventListener('click', () => {
        const s = c.dataset.size;
        state.size.has(s) ? state.size.delete(s) : state.size.add(s);
        state.visibleCount = state.pageSize;
        syncFilterUI();
        render();
      });
    });
  }

  function initRatingFilter() {
    $$('.rating-filter-item[data-rating]').forEach(r => {
      r.addEventListener('click', () => {
        const val = Number(r.dataset.rating);
        state.minRating = state.minRating === val ? 0 : val;
        state.visibleCount = state.pageSize;
        syncFilterUI();
        render();
      });
    });
  }

  function initPriceRange() {
    const minInput = $('#priceMinInput'), maxInput = $('#priceMaxInput'), applyBtn = $('#priceApplyBtn');
    if (!applyBtn) return;
    applyBtn.addEventListener('click', () => {
      state.priceMin = Number(minInput.value) || 0;
      state.priceMax = Number(maxInput.value) || 99999;
      state.visibleCount = state.pageSize;
      render();
    });
  }

  function initClearAll() {
    $('#filterClearAll') && $('#filterClearAll').addEventListener('click', () => {
      state.category.clear(); state.brand.clear(); state.color.clear(); state.size.clear();
      state.minRating = 0; state.priceMin = 0; state.priceMax = 9000;
      $('#priceMinInput').value = 0; $('#priceMaxInput').value = 9000;
      $$('.kw-check[data-filter-type] input').forEach(i => i.checked = false);
      state.visibleCount = state.pageSize;
      syncFilterUI();
      render();
    });
  }

  function initSort() {
    const sel = $('#sortSelect');
    if (!sel) return;
    sel.addEventListener('change', () => { state.sort = sel.value; render(); });
  }

  function initViewToggle() {
    $$('.view-toggle button[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.view = btn.dataset.view;
        $$('.view-toggle button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        render(true);
      });
    });
  }

  function initMobileFilter() {
    const panel = $('.plp-layout .filter-panel');
    const openBtn = $('#mobileFilterOpen');
    const closeBtn = $('#filterPanelClose');
    const backdrop = $('#filterOffcanvasBackdrop');
    if (!panel) return;
    const open = () => { panel.classList.add('open'); backdrop.classList.add('show'); document.body.style.overflow = 'hidden'; };
    const close = () => { panel.classList.remove('open'); backdrop.classList.remove('show'); document.body.style.overflow = ''; };
    openBtn && openBtn.addEventListener('click', open);
    closeBtn && closeBtn.addEventListener('click', close);
    backdrop && backdrop.addEventListener('click', close);
  }

  function initInfiniteScroll() {
    const sentinel = $('#infiniteSentinel');
    if (!sentinel || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) loadMore(); });
    }, { rootMargin: '300px' });
    io.observe(sentinel);
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyUrlCategory();
    syncFilterUI();
    initFilterGroups();
    initCheckboxFilters();
    initSwatches();
    initSizeChips();
    initRatingFilter();
    initPriceRange();
    initClearAll();
    initSort();
    initViewToggle();
    initMobileFilter();
    render();
    initInfiniteScroll();
  });
})();
