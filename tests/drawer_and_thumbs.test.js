/**
 * The drawer is injected by mobile-app.js into EVERY page, but its styles used
 * to live in modern.css, which only index.html loaded. On the other twelve
 * pages it rendered as an unstyled list dumped at the bottom of the document.
 *
 * These lock in the pairing: inject the drawer, load the drawer's styles.
 */
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..');

function htmlPages() {
    const roots = [WEB, path.join(WEB, 'pages')];
    const out = [];
    for (const dir of roots) {
        for (const f of fs.readdirSync(dir)) {
            if (f.endsWith('.html')) out.push({ name: f, file: path.join(dir, f) });
        }
    }
    return out;
}

describe('🗂  category drawer styling', () => {
    const pages = htmlPages().map((p) => ({ ...p, html: fs.readFileSync(p.file, 'utf8') }));

    test('there are pages to check', () => {
        expect(pages.length).toBeGreaterThan(5);
    });

    test('every page that injects the drawer also loads drawer.css', () => {
        const broken = pages
            .filter((p) => /mobile-app\.js/.test(p.html))
            .filter((p) => !/css\/drawer\.css/.test(p.html))
            .map((p) => p.name);

        expect(broken).toEqual([]);
    });

    test('the drawer rules live in exactly one stylesheet', () => {
        const cssDir = path.join(WEB, 'css');
        const owners = fs.readdirSync(cssDir)
            .filter((f) => f.endsWith('.css'))
            .filter((f) => {
                const text = fs.readFileSync(path.join(cssDir, f), 'utf8');
                // A rule that positions the drawer, not a passing mention.
                return /\.cat-drawer\s*\{/.test(text) || /\.drawer-scrim\s*\{/.test(text);
            });

        expect(owners).toEqual(['drawer.css']);
    });

    test('drawer.css actually contains the panel and its scrim', () => {
        const css = fs.readFileSync(path.join(WEB, 'css', 'drawer.css'), 'utf8');
        expect(css).toMatch(/\.drawer-scrim\s*\{/);
        expect(css).toMatch(/\.cat-drawer\s*\{/);
        // Balanced braces — the extraction must not have truncated a rule.
        expect((css.match(/\{/g) || []).length).toBe((css.match(/\}/g) || []).length);
    });

    test('modern.css survived the extraction intact', () => {
        const css = fs.readFileSync(path.join(WEB, 'css', 'modern.css'), 'utf8');
        expect((css.match(/\{/g) || []).length).toBe((css.match(/\}/g) || []).length);
        // Homepage pieces that must not have been carried off with the drawer.
        expect(css).toMatch(/\.premium-hero/);
        expect(css).toMatch(/\.gl-rail/);
    });
});

describe('🖼  browsing-history thumbnails', () => {
    const appJs = fs.readFileSync(path.join(WEB, 'js', 'app.js'), 'utf8');
    const componentsCss = fs.readFileSync(path.join(WEB, 'css', 'components.css'), 'utf8');

    const renderer = appJs.slice(
        appJs.indexOf('function renderRecentlyViewed'),
        appJs.indexOf('// ====== WISHLIST SYSTEM')
    );

    test('each thumbnail is wrapped in a shimmer box', () => {
        expect(renderer).toMatch(/class="rv-thumb"/);
    });

    test('the shimmer is cleared on load AND on error', () => {
        expect(renderer).toMatch(/onload="[^"]*is-loaded/);
        expect(renderer).toMatch(/onerror="[^"]*is-loaded/);
        // The fallback still applies when the image genuinely fails.
        expect(renderer).toMatch(/FALLBACK_IMAGE/);
    });

    test('an already-cached image does not shimmer forever', () => {
        expect(renderer).toMatch(/img\.complete/);
        expect(renderer).toMatch(/naturalWidth/);
    });

    test('the shimmer is defined self-contained, not borrowed from hero.css', () => {
        expect(componentsCss).toMatch(/@keyframes rv-shimmer/);
        expect(componentsCss).toMatch(/\.rv-card \.rv-thumb::before/);
        // hero.css is not loaded by the content pages, so relying on its
        // `shimmer` keyframe would silently do nothing there.
        const hero = fs.readFileSync(path.join(WEB, 'css', 'hero.css'), 'utf8');
        expect(hero).toMatch(/@keyframes shimmer/); // still there, still separate
    });

    test('the image fills its box rather than being shrunk by responsive rules', () => {
        expect(componentsCss).toMatch(/\.rv-card \.rv-thumb img/);
        expect(componentsCss).toMatch(/aspect-ratio/);
    });

    test('reduced-motion users get no animation', () => {
        expect(componentsCss).toMatch(/prefers-reduced-motion[\s\S]{0,220}rv-thumb/);
    });
});
