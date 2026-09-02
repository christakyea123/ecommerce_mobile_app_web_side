/* ==========================================================================
   MODERN HOME SECTIONS — Glomek
   Builds the marketplace-style home surfaces from data app.js has already
   fetched: a circular category rail, a flash-sale rail with a live countdown,
   a recommended rail, and a services strip.

   Everything degrades: if a data source is empty the section simply does not
   render, rather than showing an empty shell.
   ========================================================================== */
(function () {
    'use strict';

    if (window.location.pathname.includes('/pages/')) return; // home only

    function appState() {
        try { return typeof state !== 'undefined' ? state : null; } catch { return null; }
    }

    const esc = (s) => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s));

    /* ── Mount points ─────────────────────────────────────── */
    function buildScaffold() {
        const main = document.querySelector('.main-content');
        if (!main || document.getElementById('glModernTop')) return;

        const holder = document.createElement('div');
        holder.id = 'glModernTop';
        holder.innerHTML = `
            <div class="gl-call-strip" id="glCallStrip">
                <span class="material-symbols-rounded">support_agent</span>
                <span>Call to Order:</span>
                <a href="tel:+233543791625">+233 54 379 1625</a>
            </div>

            <section class="gl-section tinted" id="glCategoryRail" hidden>
                <div class="gl-section-head">
                    <h2 class="gl-section-title">Your essentials, all in one place</h2>
                    <a class="gl-section-link" href="#" id="glAllCatsLink">
                        See all <span class="material-symbols-rounded">chevron_right</span>
                    </a>
                </div>
                <div class="gl-circle-rail" id="glCircleRail"></div>
            </section>

            <section class="gl-section" id="glFlashSection" hidden>
                <div class="gl-section-head">
                    <h2 class="gl-section-title">Flash Sales</h2>
                    <div class="gl-countdown" id="glCountdown" aria-label="Time remaining">
                        <em>Ends in</em>
                        <span id="glCdH">00</span><span id="glCdM">00</span><span id="glCdS">00</span>
                    </div>
                </div>
                <div class="gl-rail" id="glFlashRail"></div>
            </section>

            <section class="gl-section" id="glRecoSection" hidden>
                <div class="gl-section-head">
                    <h2 class="gl-section-title">Recommended for you</h2>
                </div>
                <div class="gl-rail" id="glRecoRail"></div>
            </section>
        `;
        main.insertBefore(holder, main.firstChild);

        const link = document.getElementById('glAllCatsLink');
        if (link) {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                // The hamburger drawer is the one categories surface.
                if (typeof window.openCategoryDrawer === 'function') {
                    window.openCategoryDrawer();
                } else {
                    const burger = document.getElementById('menuToggleBtn');
                    if (burger) burger.click();
                }
            });
        }
    }

    /* ── Circular category rail ───────────────────────────── */
    function renderCategoryRail() {
        const s = appState();
        const rail = document.getElementById('glCircleRail');
        const section = document.getElementById('glCategoryRail');
        if (!rail || !section || !s || !s.categories || s.categories.length === 0) return;

        rail.innerHTML = s.categories.slice(0, 12).map(c => {
            const id = c._id || c.sId;
            const active = s.selectedCategoryId === id ? 'active' : '';
            const thumb = c.image
                ? `<img src="${esc(c.image)}" alt="" loading="lazy" decoding="async"
                        onerror="this.onerror=null;this.replaceWith(Object.assign(document.createElement('span'),{className:'material-symbols-rounded',textContent:'category'}))">`
                : `<span class="material-symbols-rounded">category</span>`;
            return `
                <button class="gl-circle-item ${active}" type="button" data-cat="${esc(id)}">
                    <span class="gl-circle-thumb">${thumb}</span>
                    <span class="gl-circle-label">${esc(c.name || 'Category')}</span>
                </button>
            `;
        }).join('');

        rail.querySelectorAll('.gl-circle-item').forEach(btn => {
            btn.addEventListener('click', () => {
                if (window.haptic) window.haptic();
                if (typeof window.filterByCategory === 'function') {
                    // filterByCategory returns to the top itself. Scrolling the
                    // grid into view here as well fired a second, opposing
                    // smooth-scroll a beat later.
                    window.filterByCategory(btn.dataset.cat);
                }
            });
        });

        section.hidden = false;
    }

    /* ── Flash sales: the steepest genuine discounts ──────── */
    function renderFlashRail() {
        const s = appState();
        const rail = document.getElementById('glFlashRail');
        const section = document.getElementById('glFlashSection');
        if (!rail || !section || !s) return;

        const pool = (s.allProducts && s.allProducts.length ? s.allProducts : s.products) || [];
        const discounted = pool
            .filter(p => p.offerPrice && p.price && p.offerPrice < p.price)
            .map(p => ({ p, cut: (p.price - p.offerPrice) / p.price }))
            .sort((a, b) => b.cut - a.cut)
            .slice(0, 10)
            .map(x => x.p);

        if (discounted.length < 2) { section.hidden = true; return; }

        rail.innerHTML = discounted.map(p => createProductCardHTML(p)).join('');
        section.hidden = false;
    }

    /* ── Recommended rail ─────────────────────────────────── */
    function renderRecoRail() {
        const s = appState();
        const rail = document.getElementById('glRecoRail');
        const section = document.getElementById('glRecoSection');
        if (!rail || !section || !s) return;

        const recs = (s.recommendations || []).slice(0, 10);
        if (recs.length < 2) { section.hidden = true; return; }

        rail.innerHTML = recs.map(p => createProductCardHTML(p)).join('');
        section.hidden = false;
    }

    /* ── Services strip, above the footer ─────────────────── */
    function renderServices() {
        if (document.getElementById('glServices')) return;
        const footer = document.querySelector('.amazon-footer');
        if (!footer) return;

        const section = document.createElement('section');
        section.className = 'gl-section';
        section.id = 'glServices';
        section.innerHTML = `
            <div class="gl-section-head">
                <h2 class="gl-section-title">Why shop with Glomek</h2>
            </div>
            <div class="gl-services">
                <div class="gl-service">
                    <span class="material-symbols-rounded">local_shipping</span>
                    <span class="gl-service-copy"><strong>Fast delivery</strong><span>Nationwide, tracked</span></span>
                </div>
                <div class="gl-service">
                    <span class="material-symbols-rounded">lock</span>
                    <span class="gl-service-copy"><strong>Secure payment</strong><span>Mobile Money &amp; card</span></span>
                </div>
                <div class="gl-service">
                    <span class="material-symbols-rounded">undo</span>
                    <span class="gl-service-copy"><strong>Easy returns</strong><span>7-day window</span></span>
                </div>
                <div class="gl-service">
                    <span class="material-symbols-rounded">verified</span>
                    <span class="gl-service-copy"><strong>100% authentic</strong><span>Sourced direct</span></span>
                </div>
            </div>
        `;
        footer.parentNode.insertBefore(section, footer);
    }

    /* ── Flash-sale countdown ─────────────────────────────────
       Counts down to the next midnight so the timer is honest and
       consistent for every visitor, rather than resetting per session. */
    function startCountdown() {
        const h = document.getElementById('glCdH');
        const m = document.getElementById('glCdM');
        const sec = document.getElementById('glCdS');
        if (!h || !m || !sec) return;

        const pad = n => String(n).padStart(2, '0');

        function tick() {
            const now = new Date();
            const midnight = new Date(now);
            midnight.setHours(24, 0, 0, 0);

            let left = Math.max(0, Math.floor((midnight - now) / 1000));
            h.textContent = pad(Math.floor(left / 3600));
            m.textContent = pad(Math.floor((left % 3600) / 60));
            sec.textContent = pad(left % 60);
        }

        tick();
        setInterval(tick, 1000);
    }

    /**
     * Rebuilding three rails means three innerHTML writes and a full relayout.
     * `glomek:datachange` fires on every page of infinite scroll, so doing that
     * work eagerly stuttered the scroll. Instead: coalesce bursts into one
     * rAF-scheduled pass, and skip any rail whose contents would be identical.
     */
    let renderQueued = false;
    const lastSignature = { cats: '', flash: '', reco: '' };

    function signature(list) {
        return (list || []).map(p => p._id || p.sId || '').join(',');
    }

    /* ── Desktop rail arrows ──────────────────────────────────
       A horizontal rail is swipeable on touch, but with a mouse there is no
       way to reach what is scrolled off the right edge. These add prev/next
       buttons, shown only when the rail actually overflows, and hidden again
       at each end so they never sit there doing nothing. */
    function attachRailArrows(rail) {
        if (!rail || rail.dataset.arrows === 'on') return;
        rail.dataset.arrows = 'on';

        const wrap = document.createElement('div');
        wrap.className = 'gl-rail-wrap';
        rail.parentNode.insertBefore(wrap, rail);
        wrap.appendChild(rail);

        const mk = (dir, icon) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `gl-rail-arrow ${dir}`;
            b.setAttribute('aria-label', dir === 'prev' ? 'Scroll left' : 'Scroll right');
            b.innerHTML = `<span class="material-symbols-rounded">${icon}</span>`;
            b.addEventListener('click', () => {
                rail.scrollBy({ left: (dir === 'prev' ? -1 : 1) * rail.clientWidth * 0.85, behavior: 'smooth' });
            });
            wrap.appendChild(b);
            return b;
        };

        const prev = mk('prev', 'chevron_left');
        const next = mk('next', 'chevron_right');

        let queued = false;
        function sync() {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => {
                queued = false;
                const max = rail.scrollWidth - rail.clientWidth;
                const overflows = max > 4;
                wrap.classList.toggle('has-overflow', overflows);
                prev.hidden = !overflows || rail.scrollLeft <= 4;
                next.hidden = !overflows || rail.scrollLeft >= max - 4;
            });
        }

        rail.addEventListener('scroll', sync, { passive: true });
        window.addEventListener('resize', sync, { passive: true });
        rail._syncArrows = sync;
        sync();
    }

    function syncAllRailArrows() {
        document.querySelectorAll('.gl-rail, .gl-circle-rail').forEach(r => {
            attachRailArrows(r);
            if (r._syncArrows) r._syncArrows();
        });
    }

    function renderAll() {
        if (renderQueued) return;
        renderQueued = true;

        requestAnimationFrame(() => {
            renderQueued = false;
            const s = appState();
            if (!s) return;

            // During a search the merchandising rails must stand down. They
            // read `allProducts`, which while searching holds the *search
            // results* — so "Flash Sales" would quietly relabel the customer's
            // own results, and the rails push the real matches below the fold.
            // A category listing is a results view too — the rails belong to
            // the unfiltered homepage only.
            const searching = !!(
                (s.searchKeyword && s.searchKeyword.trim()) ||
                s.selectedCategoryId ||
                s.selectedSubCategoryId
            );
            ['glCategoryRail', 'glFlashSection', 'glRecoSection', 'glCallStrip'].forEach(id => {
                const el = document.getElementById(id);
                if (el && searching) el.hidden = true;
            });
            if (searching) {
                // Force a redraw when the search is cleared.
                lastSignature.cats = lastSignature.flash = lastSignature.reco = ' searching';
                return;
            }

            // Back to browsing. The rails below re-show themselves as they
            // render, but the call strip is static markup with nothing to
            // re-run, so it has to be restored explicitly.
            const callStrip = document.getElementById('glCallStrip');
            if (callStrip) callStrip.hidden = false;

            const catsSig = signature(s.categories) + '|' + (s.selectedCategoryId || '');
            if (catsSig !== lastSignature.cats) {
                lastSignature.cats = catsSig;
                renderCategoryRail();
            }

            const pool = (s.allProducts && s.allProducts.length ? s.allProducts : s.products) || [];
            const flashSig = signature(pool);
            if (flashSig !== lastSignature.flash) {
                lastSignature.flash = flashSig;
                renderFlashRail();
            }

            const recoSig = signature(s.recommendations);
            if (recoSig !== lastSignature.reco) {
                lastSignature.reco = recoSig;
                renderRecoRail();
            }

            syncAllRailArrows();
        });
    }

    function init() {
        buildScaffold();
        renderServices();
        startCountdown();
        renderAll();

        // app.js loads categories/products/recommendations asynchronously and
        // announces changes; re-render as each arrives.
        document.addEventListener('glomek:datachange', renderAll);
        // Belt and braces for the first paint before any event fires.
        setTimeout(renderAll, 1200);
        setTimeout(renderAll, 3000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
