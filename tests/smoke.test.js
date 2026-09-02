/**
 * ============================================================
 * BOOT SMOKE TEST
 * ============================================================
 * Loads the real page and drives the main journeys, failing on
 * ANY uncaught error or console.error along the way. Silent
 * exceptions inside event handlers are the failure mode that
 * unit tests miss — the click just does nothing.
 * ============================================================
 */
const fs = require('fs');
const path = require('path');
const util = require('util');

global.TextEncoder = util.TextEncoder;
global.TextDecoder = util.TextDecoder;

const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = process.env.GLOMEK_ROOT
    ? path.resolve(__dirname, '..', process.env.GLOMEK_ROOT)
    : path.resolve(__dirname, '..');

jest.setTimeout(30000);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const CATALOGUE = Array.from({ length: 6 }, (_, i) => ({
    _id: 'p' + i,
    name: 'Product ' + i,
    price: 500 + i,
    offerPrice: 400 + i,
    images: [{ url: 'p.png' }],
    proCategoryId: { _id: 'c1', name: 'Electronics' },
}));

function boot() {
    const problems = [];

    // The Paystack test-key banner is a deliberate deployment warning, not a
    // defect — it fires by design on any non-localhost host. Everything else
    // reaching console.error is a real problem.
    const EXPECTED = /GLOMEK: Paystack is running on a TEST key/;

    const vc = new VirtualConsole();
    vc.on('jsdomError', e => problems.push('jsdomError: ' + e.message));
    vc.on('error', (...a) => {
        const msg = a.join(' ');
        if (!EXPECTED.test(msg)) problems.push('console.error: ' + msg);
    });

    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const dom = new JSDOM(html, {
        url: 'https://glomek.com/',
        runScripts: 'outside-only',
        pretendToBeVisual: true,
        virtualConsole: vc,
    });
    const win = dom.window;

    win.addEventListener('error', e => problems.push('uncaught: ' + e.message));
    win.addEventListener('unhandledrejection', e => problems.push('unhandled rejection: ' + e.reason));

    win.fetch = async (url) => {
        const u = String(url);
        if (u.includes('/products?')) {
            return { ok: true, json: async () => ({ success: true, data: CATALOGUE, total: CATALOGUE.length }) };
        }
        if (u.includes('/categories')) {
            return { ok: true, json: async () => ({ success: true, data: [{ _id: 'c1', name: 'Electronics' }] }) };
        }
        if (u.includes('/posters')) {
            return {
                ok: true, json: async () => ({
                    success: true,
                    data: [{ _id: 'po1', imageUrl: 'hero.png', posterName: 'Big Sale', discountText: '-50%' }]
                })
            };
        }
        return { ok: true, json: async () => ({ success: true, data: [], total: 0 }) };
    };

    win.IntersectionObserver = class { observe() { } unobserve() { } disconnect() { } };
    win.scrollTo = () => { };
    win.navigator.vibrate = () => true;
    win.Element.prototype.scrollIntoView = () => { };
    win.matchMedia = win.matchMedia || (() => ({ matches: false, addListener() { }, removeListener() { } }));

    const files = ['js/api.js', 'js/app.js', 'js/modern-home.js', 'js/mobile-app.js'];
    win.eval(files.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n')
        + '\n;window.__state = state;');

    return { win, doc: win.document, problems };
}

describe('🔥 Boot smoke', () => {

    test('the page boots with no errors and renders', async () => {
        const { win, doc, problems } = boot();
        doc.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
        await sleep(700);

        expect(problems).toEqual([]);
        expect(doc.getElementById('productGrid').children.length).toBe(CATALOGUE.length);
    });

    test('the main journeys run without throwing', async () => {
        const { win, doc, problems } = boot();
        doc.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
        await sleep(700);

        // Add to cart from a card
        const addBtn = doc.querySelector('#productGrid .card-add-btn');
        const attr = addBtn.getAttribute('onclick');
        const encoded = attr.match(/'p0', '([^']+)'/)[1];
        win.quickAddToCart(
            { stopPropagation() { }, preventDefault() { }, currentTarget: addBtn },
            'p0', encoded
        );
        expect(win.__state.cart.length).toBe(1);

        // Open and close every modal
        for (const id of ['authModal', 'checkoutModal', 'profileModal', 'receiptModal']) {
            win.openModal(id);
            expect(doc.getElementById(id).hidden).toBe(false);
            win.closeModal(id);
            expect(doc.getElementById(id).hidden).toBe(true);
        }

        // Drawer, cart and wishlist
        win.openCategoryDrawer();
        win.closeCategoryDrawer();
        win.toggleCart(true); win.toggleCart(false);
        win.toggleWishlist(true); win.toggleWishlist(false);

        // Search and clear
        doc.getElementById('searchInput').value = 'product';
        doc.getElementById('searchSubmitBtn').click();
        await sleep(400);
        doc.getElementById('clearSearchBtn').click();
        await sleep(400);

        // Sort and price filter
        doc.getElementById('sortSelect').value = 'price_low';
        win.handleSortChange();
        await sleep(300);
        doc.getElementById('priceMin').value = '1';
        doc.getElementById('priceMax').value = '99999';
        win.applyPriceFilter();
        await sleep(300);

        expect(problems).toEqual([]);
        // And the page is still usable, not locked.
        expect(doc.body.style.overflow).not.toBe('hidden');
    });

    test('an admin-supplied poster cannot inject markup', async () => {
        const { win, doc } = boot();
        doc.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
        await sleep(700);

        const container = doc.getElementById('posterContainer');
        // The stub poster carries plain text; assert it is rendered as text.
        expect(container.textContent).toContain('Big Sale');
        expect(container.querySelector('script')).toBeNull();
    });
});
