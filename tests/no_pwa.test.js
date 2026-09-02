/**
 * ============================================================
 * PWA REMOVED
 * ============================================================
 * The Progressive Web App layer was deliberately removed. A
 * stray manifest link or a re-registered service worker would
 * quietly bring back install prompts and cache-serving, so this
 * locks the decision in.
 * ============================================================
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.GLOMEK_ROOT
    ? path.resolve(__dirname, '..', process.env.GLOMEK_ROOT)
    : path.resolve(__dirname, '..');

const PAGES = ['index.html', ...fs.readdirSync(path.join(ROOT, 'pages'))
    .filter(f => f.endsWith('.html')).map(f => 'pages/' + f)];

describe('🚫 PWA removed', () => {

    test('the manifest and service worker files are gone', () => {
        expect(fs.existsSync(path.join(ROOT, 'manifest.json'))).toBe(false);
        expect(fs.existsSync(path.join(ROOT, 'sw.js'))).toBe(false);
    });

    test('no page links a manifest or declares web-app capability', () => {
        const offenders = [];
        for (const p of PAGES) {
            const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
            if (/rel=["']manifest["']/.test(html)) offenders.push(`${p}: manifest link`);
            if (/mobile-web-app-capable/.test(html)) offenders.push(`${p}: web-app-capable meta`);
            if (/apple-mobile-web-app/.test(html)) offenders.push(`${p}: apple web-app meta`);
        }
        expect(offenders).toEqual([]);
    });

    test('nothing registers a service worker or prompts to install', () => {
        const js = ['js/app.js', 'js/mobile-app.js', 'js/modern-home.js', 'js/orders.js', 'js/api.js']
            .filter(f => fs.existsSync(path.join(ROOT, f)))
            .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'))
            .join('\n');

        expect(js).not.toMatch(/serviceWorker\s*\.\s*register/);
        expect(js).not.toMatch(/beforeinstallprompt/);
        expect(js).not.toMatch(/app-install-banner/);
    });

    test('but it still cleans up a worker left on returning visitors', () => {
        // Deleting the files is not enough — an already-installed worker keeps
        // serving its cache until something unregisters it.
        const src = fs.readFileSync(path.join(ROOT, 'js/mobile-app.js'), 'utf8');
        expect(src).toMatch(/getRegistrations/);
        expect(src).toMatch(/unregister\(\)/);
    });
});
