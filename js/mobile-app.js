/* ==========================================================================
   MOBILE APP SHELL — Glomek
   Bottom tab bar, swipe-to-dismiss sheets, pull-to-refresh, collapsing
   header, haptics and the install prompt. Everything here degrades quietly:
   if app.js is missing (static content pages) the tabs just navigate home.
   ========================================================================== */
(function () {
    'use strict';

    const IS_PAGES = window.location.pathname.includes('/pages/');
    const HOME = IS_PAGES ? '../index.html' : 'index.html';
    const ROOT = IS_PAGES ? '../' : '';

    // app.js declares `state` with `let`, so it lives in the shared global
    // lexical scope rather than on `window` — reach it defensively.
    function appState() {
        try { return typeof state !== 'undefined' ? state : null; } catch { return null; }
    }

    function has(fn) {
        return typeof window[fn] === 'function';
    }

    /* ── Haptics ─────────────────────────────────────────── */
    window.haptic = function (pattern) {
        try {
            if (navigator.vibrate) navigator.vibrate(pattern || 8);
        } catch { /* unsupported */ }
    };

    /* ======================================================================
       NAVIGATION
       There is no bottom tab bar. The hamburger drawer is the single
       navigation surface: Home, Saved, Cart, Account and every category all
       live inside it. These helpers are what the drawer rows call.
       ====================================================================== */
    function goTo(destination) {
        window.haptic();

        // On the static content pages there is no catalogue to open — go home
        // and let the index pick the intent back up from the hash.
        if (IS_PAGES && destination !== 'home') {
            window.location.href = `${HOME}#${destination}`;
            return;
        }

        switch (destination) {
            case 'home':
                if (IS_PAGES) { window.location.href = HOME; return; }
                closeEverything();
                if (has('filterByCategory') && appState() && appState().selectedCategoryId) {
                    window.filterByCategory(null);
                }
                window.scrollTo({ top: 0, behavior: 'smooth' });
                break;

            case 'categories':
                openCategoryDrawer();
                break;

            case 'saved':
                closeEverything();
                if (has('toggleWishlist')) window.toggleWishlist(true);
                break;

            case 'cart':
                closeEverything();
                if (has('toggleCart')) window.toggleCart(true);
                break;

            case 'account': {
                closeEverything();
                const userBtn = document.querySelector('.user-btn');
                if (userBtn) userBtn.click();
                break;
            }
        }
    }

    function closeEverything() {
        if (has('toggleCart')) window.toggleCart(false);
        if (has('toggleWishlist')) window.toggleWishlist(false);
        closeCategoryDrawer();
    }

    /** Counts shown on the drawer's Cart / Saved rows, read from the header badges. */
    function currentCounts() {
        const read = (id) => {
            const el = document.getElementById(id);
            if (!el || el.hidden) return 0;
            return parseInt(el.textContent, 10) || 0;
        };
        return { cart: read('cartBadge'), saved: read('wishlistBadge') };
    }

    // Keep the drawer's counts live while it is open.
    document.addEventListener('glomek:statechange', () => {
        const drawer = document.getElementById('categoryDrawer');
        if (drawer && drawer.classList.contains('open')) renderDrawerCounts();
    });

    function renderDrawerCounts() {
        const { cart, saved } = currentCounts();
        const set = (sel, n) => {
            const el = document.querySelector(sel);
            if (!el) return;
            el.textContent = n;
            el.hidden = n === 0;
        };
        set('#drawerCartCount', cart);
        set('#drawerSavedCount', saved);
    }

    /* ======================================================================
       CATEGORY DRAWER
       One categories surface, reachable two ways: the header hamburger and
       the Categories tab in the bottom bar. Slides in from the left, the way
       the big marketplaces do it, and lists subcategories inline.
       ====================================================================== */
    function buildCategoryDrawer() {
        if (document.getElementById('categoryDrawer')) return;

        const scrim = document.createElement('div');
        scrim.className = 'drawer-scrim';
        scrim.id = 'drawerScrim';

        const drawer = document.createElement('aside');
        drawer.className = 'cat-drawer';
        drawer.id = 'categoryDrawer';
        drawer.setAttribute('aria-label', 'Categories');
        drawer.setAttribute('aria-hidden', 'true');
        drawer.innerHTML = `
            <div class="cat-drawer-head">
                <span class="cat-drawer-title">Browse Glomek</span>
                <button class="cat-drawer-close" type="button" aria-label="Close menu">
                    <span class="material-symbols-rounded">close</span>
                </button>
            </div>
            <div class="cat-drawer-account" id="drawerAccount"></div>

            <nav class="cat-drawer-main" aria-label="Main">
                <button class="cat-drawer-row nav" type="button" data-go="home">
                    <span class="material-symbols-rounded">home</span>
                    <span class="cat-drawer-name">Home</span>
                </button>
                <button class="cat-drawer-row nav" type="button" data-go="saved">
                    <span class="material-symbols-rounded">favorite</span>
                    <span class="cat-drawer-name">Saved Items</span>
                    <span class="cat-drawer-count" id="drawerSavedCount" hidden>0</span>
                </button>
                <button class="cat-drawer-row nav" type="button" data-go="cart">
                    <span class="material-symbols-rounded">shopping_cart</span>
                    <span class="cat-drawer-name">Your Cart</span>
                    <span class="cat-drawer-count" id="drawerCartCount" hidden>0</span>
                </button>
                <button class="cat-drawer-row nav" type="button" data-go="account">
                    <span class="material-symbols-rounded">person</span>
                    <span class="cat-drawer-name">My Account</span>
                </button>
            </nav>

            <div class="cat-drawer-sectionlabel">Shop by category</div>
            <nav class="cat-drawer-list" id="drawerList" aria-label="Categories"></nav>

            <div class="cat-drawer-foot">
                <a href="${ROOT}pages/help.html"><span class="material-symbols-rounded">help</span> Help Centre</a>
                <a href="${ROOT}pages/orders.html"><span class="material-symbols-rounded">receipt_long</span> Your Orders</a>
            </div>
        `;

        document.body.appendChild(scrim);
        document.body.appendChild(drawer);

        scrim.addEventListener('click', closeCategoryDrawer);
        drawer.querySelector('.cat-drawer-close').addEventListener('click', closeCategoryDrawer);

        // Home / Saved / Cart / Account rows
        drawer.querySelectorAll('.cat-drawer-row.nav').forEach(row => {
            row.addEventListener('click', () => {
                const dest = row.dataset.go;
                // 'categories' is already this drawer, so never re-open it.
                closeCategoryDrawer();
                goTo(dest);
            });
        });

        const burger = document.getElementById('menuToggleBtn');
        if (burger) burger.addEventListener('click', openCategoryDrawer);

        // Escape closes it, matching every other overlay on the site.
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && drawer.classList.contains('open')) closeCategoryDrawer();
        });
    }

    function renderDrawer() {
        const s = appState();
        const list = document.getElementById('drawerList');
        const account = document.getElementById('drawerAccount');
        if (!list) return;

        // Account row
        if (account) {
            const user = (() => {
                try { return typeof currentUser !== 'undefined' ? currentUser : null; } catch { return null; }
            })();
            account.innerHTML = user
                ? `<span class="material-symbols-rounded">account_circle</span>
                   <span class="cat-drawer-hello">Hi, <strong>${escapeText(user.name || 'there')}</strong></span>`
                : `<span class="material-symbols-rounded">account_circle</span>
                   <button class="cat-drawer-signin" type="button">Sign in / Register</button>`;

            const signin = account.querySelector('.cat-drawer-signin');
            if (signin) signin.addEventListener('click', () => {
                closeCategoryDrawer();
                const b = document.querySelector('.user-btn');
                if (b) b.click();
            });
        }

        const categories = (s && s.categories) || [];
        const subs = (s && s.subCategories) || [];
        const selected = s ? s.selectedCategoryId : null;

        if (categories.length === 0) {
            list.innerHTML = `<p class="cat-drawer-empty">Categories are still loading…</p>`;
            return;
        }

        list.innerHTML = `
            <button class="cat-drawer-row ${!selected ? 'active' : ''}" data-cat="" type="button">
                <span class="material-symbols-rounded">storefront</span>
                <span class="cat-drawer-name">All Products</span>
            </button>
        ` + categories.map(c => {
            const id = c._id || c.sId;
            const kids = subs.filter(sc => {
                const parent = sc.proCategoryId;
                const parentId = parent && typeof parent === 'object' ? parent._id : parent;
                return parentId === id;
            });

            const thumb = c.image
                ? `<img src="${escapeText(c.image)}" alt="" loading="lazy" decoding="async">`
                : `<span class="material-symbols-rounded">category</span>`;

            const children = kids.length
                ? `<div class="cat-drawer-subs">` + kids.slice(0, 8).map(sc =>
                    `<button class="cat-drawer-sub" type="button" data-sub="${escapeText(sc._id || sc.sId)}">${escapeText(sc.name || '')}</button>`
                ).join('') + `</div>`
                : '';

            return `
                <button class="cat-drawer-row ${selected === id ? 'active' : ''}" data-cat="${escapeText(id)}" type="button">
                    ${thumb}
                    <span class="cat-drawer-name">${escapeText(c.name || 'Category')}</span>
                    <span class="material-symbols-rounded cat-drawer-chev">chevron_right</span>
                </button>
                ${children}
            `;
        }).join('');

        list.querySelectorAll('.cat-drawer-row').forEach(row => {
            row.addEventListener('click', () => {
                window.haptic();
                closeCategoryDrawer();
                if (has('filterByCategory')) window.filterByCategory(row.dataset.cat || null);
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        });

        list.querySelectorAll('.cat-drawer-sub').forEach(btn => {
            btn.addEventListener('click', () => {
                window.haptic();
                closeCategoryDrawer();
                if (has('filterBySubCategory')) window.filterBySubCategory(btn.dataset.sub);
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        });
    }

    function openCategoryDrawer() {
        // On the static pages there is no catalogue to filter — go home first.
        if (IS_PAGES) { window.location.href = `${HOME}#categories`; return; }

        buildCategoryDrawer();
        renderDrawer();

        const drawer = document.getElementById('categoryDrawer');
        const scrim = document.getElementById('drawerScrim');
        if (!drawer) return;

        drawer.classList.add('open');
        drawer.setAttribute('aria-hidden', 'false');
        if (scrim) scrim.classList.add('active');
        document.body.classList.add('overlay-open');
        document.body.style.overflow = 'hidden';

        const burger = document.getElementById('menuToggleBtn');
        if (burger) burger.setAttribute('aria-expanded', 'true');

        renderDrawerCounts();
        window.haptic();
    }

    function closeCategoryDrawer() {
        const drawer = document.getElementById('categoryDrawer');
        const scrim = document.getElementById('drawerScrim');
        if (drawer) {
            drawer.classList.remove('open');
            drawer.setAttribute('aria-hidden', 'true');
        }
        if (scrim) scrim.classList.remove('active');

        const burger = document.getElementById('menuToggleBtn');
        if (burger) burger.setAttribute('aria-expanded', 'false');

        // Other overlays may still be open — let the shared helper decide.
        if (has('syncBodyScrollLock')) window.syncBodyScrollLock();
        else { document.body.classList.remove('overlay-open'); document.body.style.overflow = ''; }
    }

    window.openCategoryDrawer = openCategoryDrawer;
    window.closeCategoryDrawer = closeCategoryDrawer;

    function escapeText(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    /* ======================================================================
       SWIPE-DOWN TO DISMISS SHEETS
       ====================================================================== */
    function setupSheetSwipe() {
        let startY = 0;
        let currentY = 0;
        let dragging = false;
        let sheet = null;
        let overlayId = null;

        document.addEventListener('touchstart', (e) => {
            if (window.innerWidth > 900) return;
            const content = e.target.closest('.sheet-content');
            if (!content) return;

            const body = content.querySelector('.sheet-body');
            // Only start a drag from the handle/header, or when the body is
            // already scrolled to the top — otherwise the customer is scrolling.
            const fromGrip = !!e.target.closest('.sheet-handle, .sheet-head');
            if (!fromGrip && body && body.scrollTop > 0) return;

            sheet = content;
            overlayId = content.parentElement ? content.parentElement.id : null;
            startY = e.touches[0].clientY;
            currentY = startY;
            dragging = true;
        }, { passive: true });

        document.addEventListener('touchmove', (e) => {
            if (!dragging || !sheet) return;
            currentY = e.touches[0].clientY;
            const delta = currentY - startY;
            if (delta <= 0) {
                sheet.style.transform = '';
                return;
            }
            sheet.style.transition = 'none';
            sheet.style.transform = `translateY(${delta}px)`;
        }, { passive: true });

        document.addEventListener('touchend', () => {
            if (!dragging || !sheet) return;
            const delta = currentY - startY;
            sheet.style.transition = '';
            sheet.style.transform = '';

            if (delta > 110 && overlayId && has('closeModal')) {
                window.haptic();
                window.closeModal(overlayId);
            }
            dragging = false;
            sheet = null;
            overlayId = null;
        });
    }

    /* ======================================================================
       COLLAPSING HEADER
       ====================================================================== */

    // The header height used to be published as --navbar-h so a sticky
    // sort bar could sit beneath it. Nothing is sticky any more, so measuring
    // it was five forced layout reads (load, resize, orientation, and two
    // timers) buying nothing.

    function setupHeaderCollapse() {
        let lastY = window.scrollY;
        let ticking = false;

        window.addEventListener('scroll', () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(() => {
                const y = window.scrollY;
                if (window.innerWidth <= 900 && !document.body.classList.contains('overlay-open')) {
                    if (y > lastY + 8 && y > 160) {
                        document.body.classList.add('nav-hidden');
                    } else if (y < lastY - 8) {
                        document.body.classList.remove('nav-hidden');
                    }
                } else {
                    document.body.classList.remove('nav-hidden');
                }
                lastY = y;
                ticking = false;
            });
        }, { passive: true });
    }

    /* ======================================================================
       PULL TO REFRESH
       ====================================================================== */
    function setupPullToRefresh() {
        if (IS_PAGES) return;

        const indicator = document.createElement('div');
        indicator.className = 'ptr-indicator';
        indicator.innerHTML = `<span class="material-symbols-rounded">arrow_downward</span>`;
        document.body.appendChild(indicator);

        const THRESHOLD = 78;
        let startY = 0;
        let pulling = false;
        let armed = false;

        document.addEventListener('touchstart', (e) => {
            if (window.innerWidth > 900) return;
            if (window.scrollY > 0) return;
            if (document.body.classList.contains('overlay-open')) return;
            if (e.target.closest('.sheet-content, .cart-sidebar, .wishlist-sidebar')) return;
            startY = e.touches[0].clientY;
            pulling = true;
            armed = false;
        }, { passive: true });

        // Style writes are batched into one rAF per frame instead of firing on
        // every touchmove — a finger produces far more move events than the
        // screen has frames, and each write here would otherwise be wasted.
        let moveQueued = false;
        let pendingDelta = 0;

        document.addEventListener('touchmove', (e) => {
            if (!pulling) return;
            pendingDelta = e.touches[0].clientY - startY;

            // Scrolling up out of the gesture — stop tracking entirely so the
            // rest of the scroll costs nothing.
            if (pendingDelta <= 0) {
                if (indicator.style.opacity !== '0') indicator.style.opacity = '0';
                pulling = false;
                return;
            }

            if (moveQueued) return;
            moveQueued = true;
            requestAnimationFrame(() => {
                moveQueued = false;
                if (!pulling) return;

                const ratio = Math.min(pendingDelta / THRESHOLD, 1);
                const pull = Math.min(pendingDelta, THRESHOLD * 1.5);
                indicator.style.opacity = String(ratio);
                indicator.style.transform = `translateY(${pull * 0.45}px) scale(${0.8 + ratio * 0.2})`;

                const nowArmed = pendingDelta >= THRESHOLD;
                if (nowArmed !== armed) {
                    armed = nowArmed;
                    indicator.classList.toggle('armed', armed);
                    if (armed) window.haptic(10);
                }
            });
        }, { passive: true });

        document.addEventListener('touchend', () => {
            if (!pulling) return;
            pulling = false;

            if (!armed) {
                indicator.style.opacity = '0';
                indicator.style.transform = '';
                return;
            }

            indicator.classList.remove('armed');
            indicator.classList.add('spinning');
            indicator.style.opacity = '1';
            window.haptic([10, 30, 10]);

            const s = appState();
            if (s && has('loadProducts')) {
                s.currentPage = 1;
                Promise.resolve(window.loadProducts()).finally(finish);
            } else {
                setTimeout(finish, 600);
            }

            function finish() {
                indicator.classList.remove('spinning');
                indicator.style.opacity = '0';
                indicator.style.transform = '';
                armed = false;
            }
        });
    }

    /* ======================================================================
       DEEP LINKS FROM THE CONTENT PAGES  (index.html#cart etc.)
       ====================================================================== */
    function handleEntryHash() {
        const hash = (window.location.hash || '').replace('#', '');
        if (!hash) return;
        if (!['cart', 'saved', 'account', 'categories'].includes(hash)) return;

        history.replaceState(null, '', window.location.pathname + window.location.search);
        // Let app.js finish its first render before opening a surface.
        setTimeout(() => goTo(hash), 350);
    }

    /* ======================================================================
       SERVICE WORKER CLEANUP
       The site used to register a service worker. Deleting sw.js is not
       enough: a worker already installed in someone's browser keeps running
       and keeps serving its cache, so they would be stuck on the old build
       indefinitely. This actively unregisters any survivor and clears the
       caches it left behind. Safe to remove once traffic has cycled through.
       ====================================================================== */
    function removeLegacyServiceWorker() {
        if (!('serviceWorker' in navigator)) return;

        navigator.serviceWorker.getRegistrations()
            .then(regs => regs.forEach(r => r.unregister()))
            .catch(() => { /* nothing registered */ });

        if (window.caches && caches.keys) {
            caches.keys()
                .then(keys => keys.filter(k => k.startsWith('glomek-')).forEach(k => caches.delete(k)))
                .catch(() => { /* no cache storage */ });
        }
    }

    /* ── Boot ────────────────────────────────────────────── */
    function init() {
        buildCategoryDrawer();
        setupSheetSwipe();
        setupHeaderCollapse();
        setupPullToRefresh();
        removeLegacyServiceWorker();
        handleEntryHash();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
