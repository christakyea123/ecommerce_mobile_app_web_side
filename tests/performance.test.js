/**
 * ============================================================
 * SCROLL PERFORMANCE GUARDS
 * ============================================================
 * Every assertion here corresponds to a real cause of scroll
 * stutter that was measured and fixed. They are cheap static
 * checks, but they stop the specific regressions from creeping
 * back in unnoticed.
 * ============================================================
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/**
 * These are static checks on the authored source, not behaviour checks, so
 * they deliberately do not run against dist/. The minifier legitimately
 * rewrites the very things they read — `{ passive: true }` becomes
 * `{passive:!0}`, quotes and whitespace change — and asserting on that would
 * be testing esbuild, not the site. The behavioural suites cover dist/.
 */
const describeSource = process.env.GLOMEK_ROOT ? describe.skip : describe;

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** Comments describe the old problem; they must not count as the problem. */
const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const css = () => fs.readdirSync(path.join(ROOT, 'css'))
    .map(f => read('css/' + f)).join('\n');

describeSource('⚡ Scroll performance', () => {

    test('every scroll listener is passive', () => {
        // A non-passive scroll/touch listener forces the browser to wait for
        // JavaScript before it may scroll — the classic cause of mobile lag.
        const sources = ['js/app.js', 'js/mobile-app.js', 'js/modern-home.js']
            .filter(f => fs.existsSync(path.join(ROOT, f)));

        const offenders = [];
        for (const f of sources) {
            const src = stripComments(read(f));
            const re = /addEventListener\(\s*['"](scroll|touchmove|touchstart|wheel)['"]/g;
            let m;
            while ((m = re.exec(src)) !== null) {
                // Look from this registration up to the next one; the options
                // object lives on the closing line of the handler.
                const rest = src.slice(m.index + 1);
                const nextCall = rest.search(/addEventListener\(\s*['"]/);
                const body = nextCall === -1 ? rest : rest.slice(0, nextCall);

                if (!/passive\s*:\s*true/.test(body)) {
                    offenders.push(`${f}: ${m[1]} listener is not passive`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    test('infinite scroll uses IntersectionObserver, not a layout read', () => {
        const src = stripComments(read('js/app.js'));
        expect(src).toMatch(/new IntersectionObserver/);

        // document.body.offsetHeight inside a scroll handler forces a
        // synchronous reflow on every event.
        expect(src).not.toMatch(/document\.body\.offsetHeight/);
    });

    test('the scroll sentinel is actually rendered', () => {
        // An observer target that is display:none never fires. The previous
        // sentinel was the [hidden] loader, which silently did nothing.
        const html = read('index.html');
        expect(html).toMatch(/id="scrollSentinel"/);

        const sentinel = html.match(/<div id="scrollSentinel"[^>]*>/)[0];
        // The bare `hidden` attribute, not aria-hidden.
        expect(sentinel).not.toMatch(/(^|\s)hidden(\s|=|>)/);
        expect(read('js/app.js')).toMatch(/getElementById\('scrollSentinel'\)/);
    });

    test('no infinite animation drives a layout property', () => {
        // Animating left/top/width/height runs layout every frame, forever.
        const all = css();

        // Brace-balanced extraction: a regex stops at the first "\n}" and
        // would swallow the following rule's declarations into this block.
        function keyframeBlocks(src) {
            const out = [];
            const re = /@keyframes\s+([\w-]+)\s*\{/g;
            let m;
            while ((m = re.exec(src)) !== null) {
                let depth = 1;
                let i = re.lastIndex;
                while (i < src.length && depth > 0) {
                    if (src[i] === '{') depth++;
                    else if (src[i] === '}') depth--;
                    i++;
                }
                out.push({ name: m[1], body: src.slice(re.lastIndex, i - 1) });
            }
            return out;
        }

        const offenders = [];
        for (const { name, body } of keyframeBlocks(all)) {
            if (!/(^|[{;\s])(left|top|right|bottom|width|height)\s*:/.test(body)) continue;
            // Only a problem for animations that loop forever.
            if (new RegExp(`animation:[^;]*\\b${name}\\b[^;]*infinite`).test(all)) {
                offenders.push(name);
            }
        }
        expect(offenders).toEqual([]);
    });

    test('backdrop-filter is not left on permanently hidden panels', () => {
        // An off-screen translucent panel with a blur is still composited
        // every frame. The blur belongs on the .open state.
        const all = css();

        const closedSidebar = all.match(/\.cart-sidebar\s*\{[\s\S]*?\n\}/);
        expect(closedSidebar).not.toBeNull();
        expect(closedSidebar[0]).not.toMatch(/backdrop-filter/);

        const closedWishlist = all.match(/\.wishlist-sidebar\s*\{[\s\S]*?\n\}/);
        expect(closedWishlist).not.toBeNull();
        expect(closedWishlist[0]).not.toMatch(/backdrop-filter/);
    });

    test('no permanent compositor layers on panels that are usually closed', () => {
        // `will-change: transform` on the drawer / sidebars held three
        // full-height GPU layers alive at all times. A transform transition
        // promotes the layer while it animates, which is when it is needed.
        const all = css();
        const offenders = [];

        for (const sel of ['.cat-drawer', '.cart-sidebar', '.wishlist-sidebar']) {
            const rule = all.match(new RegExp(`\\${sel}\\s*\\{[\\s\\S]*?\\n\\}`));
            if (rule && /will-change/.test(rule[0])) offenders.push(sel);
        }
        expect(offenders).toEqual([]);
    });

    test('the hero zoom is composited rather than re-rasterised', () => {
        // An 8s scale on a large photo repaints every frame unless the image
        // is promoted to its own layer.
        const hero = css().match(/\.poster-slide \.poster-image\s*\{[\s\S]*?\n\}/);
        expect(hero).not.toBeNull();
        expect(hero[0]).toMatch(/translateZ\(0\)/);
    });

    test('the search field can shrink, so the Search button is never clipped', () => {
        // .search-bar-wrapper is overflow:hidden. An <input> will not shrink
        // below its intrinsic width (~180px) without min-width:0, which pushed
        // the Search button outside the wrapper and hid it on narrow screens.
        const rule = css().match(/\.search-input\s*\{[^}]*min-width:\s*0[^}]*\}/);
        expect(rule).not.toBeNull();

        const btn = css().match(/\.search-submit-btn\s*\{[^}]*\}/g) || [];
        expect(btn.some(r => /flex-shrink:\s*0/.test(r))).toBe(true);
    });

    test('a stuck scroll lock can always release itself', () => {
        // If the body is left with overflow:hidden and nothing open, the page
        // stops scrolling with no way back short of a reload.
        const src = read('js/app.js');
        expect(src).toMatch(/releaseStuckScrollLock/);
        // The drawer must count as "open", or closing a modal unlocks the page
        // while the drawer is still covering it.
        expect(src).toMatch(/\.cat-drawer\.open/);
    });

    test('the sort/price bar scrolls away instead of covering results', () => {
        // It was sticky, and modern.css gives that row a transparent
        // background — so it hung over the product grid with the cards
        // visible straight through it.
        const all = css();
        const rules = all.match(/[^{}]*sort-filter-bar[^{}]*\{[^}]*\}/g) || [];
        const pinned = rules.filter(r => /position:\s*(sticky|fixed)/.test(r));
        expect(pinned).toEqual([]);
    });

    test('the [hidden] attribute actually hides', () => {
        // An author `display` rule outranks the UA's `[hidden]{display:none}`,
        // so closed modals stayed in the render tree — seven full-viewport
        // fixed layers with backdrop blurs, composited over every page.
        const all = css();

        const rule = all.match(/\[hidden\][^{]*\{[^}]*display:\s*none\s*!important[^}]*\}/);
        expect(rule).not.toBeNull();

        // It must out-specify rules that force display with !important, or it
        // ties and loses on source order.
        expect(all).toMatch(/\[hidden\]\[hidden\]/);

        // And no closed overlay should be carrying a blur.
        const base = all.match(/\.modal-overlay\s*\{[^}]*\}/);
        expect(base).not.toBeNull();
        expect(base[0]).not.toMatch(/backdrop-filter/);
    });

    test('nothing can stop the page scrolling', () => {
        const all = css();

        // 1. overflow-x:hidden on the document root makes it a scroll
        //    container in both axes. Paired with overscroll suppression it can
        //    leave a touch device unable to scroll the page at all.
        const rootRules = all.match(/(^|\})\s*(html|body)[^{}]*\{[^}]*\}/g) || [];
        for (const rule of rootRules) {
            if (!/overflow-x/.test(rule)) continue;
            // `hidden` may remain only as a fallback immediately followed by `clip`.
            expect(rule).toMatch(/overflow-x:\s*clip/);
        }

        // 2. Never suppress vertical overscroll on the root itself.
        for (const rule of rootRules) {
            expect(rule).not.toMatch(/overscroll-behavior(-y)?:\s*none/);
        }

        // 3. The only hard scroll lock must be the overlay one, and it must be
        //    releasable.
        const locks = all.match(/[^{}]*\{[^}]*overflow:\s*hidden[^}]*\}/g) || [];
        const rootLocks = locks.filter(r => /(^|[\s,])(html|body)\s*\{/.test(r));
        expect(rootLocks).toEqual([]);

        const src = read('js/app.js');
        expect(src).toMatch(/releaseStuckScrollLock/);
        expect(src).toMatch(/setInterval\(releaseStuckScrollLock/);
    });

    test('no empty section reserves space it does not need', () => {
        // .categories-section holds subcategory pills, which only exist once a
        // category is chosen. Its margin used to apply unconditionally, so an
        // empty element left a wide band above the breadcrumb.
        const html = read('index.html');
        const section = html.match(/<section class="categories-section"[^>]*>/)[0];
        expect(section).not.toMatch(/margin-bottom/);

        const all = css();
        const rule = all.match(/\.categories-section\s*\{[^}]*margin-bottom:\s*0[^}]*\}/);
        expect(rule).not.toBeNull();

        // The spacing must live with the pills, so it appears only with them.
        expect(all).toMatch(/\.subcategory-list:not\(\[hidden\]\)\s*\{[^}]*margin-bottom/);
    });

    test('horizontal rails are reachable without a touchscreen', () => {
        // A mouse cannot swipe; without arrows the overflow is unreachable.
        expect(read('js/modern-home.js')).toMatch(/gl-rail-arrow/);
        expect(css()).toMatch(/\.gl-rail-arrow/);
    });

    test('home rails coalesce redraws instead of rebuilding per page', () => {
        const src = read('js/modern-home.js');
        expect(src).toMatch(/requestAnimationFrame/);
        expect(src).toMatch(/lastSignature/);
    });
});
