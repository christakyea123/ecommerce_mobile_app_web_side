/**
 * ============================================================
 * SEARCH
 * ============================================================
 * Drives the real search UI: typing, the Search button, Enter,
 * clearing, empty results and searching twice in a row.
 * ============================================================
 */
const fs = require('fs');
const path = require('path');
const util = require('util');

global.TextEncoder = util.TextEncoder;
global.TextDecoder = util.TextDecoder;

const { JSDOM } = require('jsdom');

const ROOT = process.env.GLOMEK_ROOT
    ? path.resolve(__dirname, '..', process.env.GLOMEK_ROOT)
    : path.resolve(__dirname, '..');

jest.setTimeout(30000);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const CATALOGUE = [
    { _id: 'a1', name: 'Kente Backpack', price: 600, offerPrice: 450, images: [{ url: 'a.png' }] },
    { _id: 'a2', name: 'Office Chair', price: 1900, offerPrice: 1600, images: [{ url: 'b.png' }] },
    { _id: 'a3', name: 'Laptop Sleeve', price: 400, offerPrice: 300, images: [{ url: 'c.png' }] },
];

function boot() {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const dom = new JSDOM(html, { url: 'https://glomek.com/', runScripts: 'outside-only', pretendToBeVisual: true });
    const win = dom.window;

    const queries = [];
    const pages = [];
    const urls = [];
    win.fetch = async (url) => {
        const u = String(url);
        urls.push(u);
        if (u.includes('/products?')) {
            const term = decodeURIComponent((u.match(/search=([^&]*)/) || [])[1] || '');
            const page = parseInt((u.match(/page=(\d+)/) || [])[1], 10) || 1;
            const limit = parseInt((u.match(/limit=(\d+)/) || [])[1], 10) || 50;
            queries.push(term);
            pages.push(page);

            // `bigResult` simulates a set large enough to span several pages.
            if (term === 'bigresult') {
                const total = 260;
                const start = (page - 1) * limit;
                const data = Array.from(
                    { length: Math.max(0, Math.min(limit, total - start)) },
                    (_, i) => ({ _id: 'b' + (start + i), name: 'Bulk ' + (start + i), price: 100 })
                );
                return { ok: true, json: async () => ({ success: true, data, total, page, limit }) };
            }

            const data = term
                ? CATALOGUE.filter(p => p.name.toLowerCase().includes(term.toLowerCase()))
                : CATALOGUE;
            return {
                ok: true,
                json: async () => ({ success: true, data, total: data.length, page, limit })
            };
        }
        return { ok: true, json: async () => ({ success: true, data: [], total: 0 }) };
    };

    win.IntersectionObserver = class {
        constructor(cb) { this.cb = cb; }
        observe() { } unobserve() { } disconnect() { }
    };

    const scrolls = [];
    win.scrollTo = (opts) => scrolls.push(opts);
    win.navigator.vibrate = () => true;

    // Record any attempt to scroll an element into view — searching must not
    // drag the page down to the grid.
    const intoView = [];
    win.Element.prototype.scrollIntoView = function (opts) {
        intoView.push({ el: this.className || this.id, opts });
    };

    win.__scrolls = scrolls;
    win.__intoView = intoView;
    win.__pages = pages;
    win.__urls = urls;
    // The page size the app asks for, so tests derive expectations from it
    // rather than hardcoding a number that changes.
    win.__limit = () => {
        const u = urls.find(x => x.includes('/products?') && /limit=\d+/.test(x));
        return u ? parseInt(u.match(/limit=(\d+)/)[1], 10) : 40;
    };

    const files = ['js/api.js', 'js/app.js', 'js/modern-home.js'];
    const bundle = files.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n')
        + '\n;window.__state = state;'
        + 'window.renderCategories = renderCategories;';
    win.eval(bundle);

    return { win, doc: win.document, queries, pages };
}

async function search(win, doc, term) {
    doc.getElementById('searchInput').value = term;
    doc.getElementById('searchSubmitBtn').click();
    await sleep(500);
}

async function ready(win, doc) {
    doc.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
    await sleep(400);
}

describe('🔎 Search', () => {

    test('the Search button runs a search and renders the results', async () => {
        const { win, doc, queries } = boot();
        await ready(win, doc);

        doc.getElementById('searchInput').value = 'kente';
        doc.getElementById('searchSubmitBtn').click();
        await sleep(400);

        expect(queries).toContain('kente');
        expect(win.__state.products.map(p => p.name)).toEqual(['Kente Backpack']);
        expect(doc.getElementById('productGrid').children.length).toBe(1);
        expect(doc.getElementById('productGrid').textContent).toContain('Kente Backpack');
    });

    test('Enter in the field runs the same search', async () => {
        const { win, doc, queries } = boot();
        await ready(win, doc);

        const input = doc.getElementById('searchInput');
        input.value = 'chair';
        input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await sleep(400);

        expect(queries).toContain('chair');
        expect(win.__state.products.map(p => p.name)).toEqual(['Office Chair']);
    });

    test('a search with no matches shows the empty state, not a blank page', async () => {
        const { win, doc } = boot();
        await ready(win, doc);

        doc.getElementById('searchInput').value = 'zzzznothing';
        doc.getElementById('searchSubmitBtn').click();
        await sleep(400);

        expect(win.__state.products.length).toBe(0);
        expect(doc.getElementById('emptyState').hidden).toBe(false);
        expect(doc.getElementById('emptyMessage').textContent).toMatch(/zzzznothing/);
        expect(doc.getElementById('productGrid').hidden).toBe(true);
    });

    test('clearing the search restores the full catalogue', async () => {
        const { win, doc } = boot();
        await ready(win, doc);

        doc.getElementById('searchInput').value = 'kente';
        doc.getElementById('searchSubmitBtn').click();
        await sleep(400);
        expect(win.__state.products.length).toBe(1);

        doc.getElementById('clearSearchBtn').click();
        await sleep(400);

        expect(win.__state.searchKeyword).toBe('');
        expect(win.__state.products.length).toBe(CATALOGUE.length);
        expect(doc.getElementById('emptyState').hidden).toBe(true);
        expect(doc.getElementById('productGrid').hidden).toBe(false);
    });

    test('two searches in a row both work', async () => {
        // A stuck isLoading flag would make the second one silently do nothing.
        const { win, doc, queries } = boot();
        await ready(win, doc);

        doc.getElementById('searchInput').value = 'kente';
        doc.getElementById('searchSubmitBtn').click();
        await sleep(400);

        doc.getElementById('searchInput').value = 'laptop';
        doc.getElementById('searchSubmitBtn').click();
        await sleep(400);

        expect(queries).toContain('laptop');
        expect(win.__state.isLoading).toBe(false);
        expect(win.__state.products.map(p => p.name)).toEqual(['Laptop Sleeve']);
    });

    test('searching hides the hero and every home rail', async () => {
        const { win, doc } = boot();
        await ready(win, doc);

        // The rails must exist and be visible first, or this proves nothing.
        const rails = ['glCategoryRail', 'glFlashSection', 'glRecoSection', 'glCallStrip'];
        for (const id of rails) {
            expect(doc.getElementById(id)).not.toBeNull();
        }
        expect(doc.getElementById('glFlashSection').hidden).toBe(false);

        // "e" matches all three catalogue items, and all three are discounted,
        // so the Flash rail would happily render the search results under its
        // own heading. Searching for one item would hide it by accident.
        doc.getElementById('searchInput').value = 'e';
        doc.getElementById('searchSubmitBtn').click();
        await sleep(500);

        expect(win.__state.products.length).toBe(3);
        expect(doc.querySelector('.hero-wrapper').style.display).toBe('none');

        for (const id of rails) {
            expect({ id, hidden: doc.getElementById(id).hidden })
                .toEqual({ id, hidden: true });
        }
    });

    test('search results get a results header, not a bare grid', async () => {
        const { win, doc } = boot();
        await ready(win, doc);

        expect(doc.getElementById('searchResultsHead').hidden).toBe(true);

        doc.getElementById('searchInput').value = 'e';
        doc.getElementById('searchSubmitBtn').click();
        await sleep(500);

        const head = doc.getElementById('searchResultsHead');
        expect(head.hidden).toBe(false);
        expect(doc.getElementById('srhTerm').textContent).toContain('e');
        expect(doc.getElementById('srhCount').textContent).toBe('3 items');
        expect(doc.body.classList.contains('is-searching')).toBe(true);
        // The breadcrumb carries the way back, not a second header button.
        expect(doc.getElementById('breadcrumbNav').textContent).toContain('Home');
    });

    test('searching lands at the top instead of scrolling down to the grid', async () => {
        const { win, doc } = boot();
        await ready(win, doc);

        win.__scrolls.length = 0;
        win.__intoView.length = 0;

        doc.getElementById('searchInput').value = 'kente';
        doc.getElementById('searchSubmitBtn').click();
        await sleep(500);

        // Nothing may drag the viewport down to the products section.
        const draggedDown = win.__intoView.filter(s => String(s.el).includes('products-section'));
        expect(draggedDown).toEqual([]);

        // It should go to the top, and without an animation the customer has
        // to sit through.
        const toTop = win.__scrolls.filter(s => s && s.top === 0);
        expect(toTop.length).toBeGreaterThan(0);
        expect(toTop.some(s => s.behavior === 'smooth')).toBe(false);
    });

    test('the results header offers a way back to browsing', async () => {
        const { win, doc } = boot();
        await ready(win, doc);

        doc.getElementById('searchInput').value = 'kente';
        doc.getElementById('searchSubmitBtn').click();
        await sleep(400);
        expect(doc.getElementById('searchResultsHead').hidden).toBe(false);

        win.exitListing();
        await sleep(400);

        expect(win.__state.searchKeyword).toBe('');
        expect(doc.getElementById('searchResultsHead').hidden).toBe(true);
        expect(doc.body.classList.contains('is-searching')).toBe(false);
        expect(win.__state.products.length).toBe(CATALOGUE.length);
    });

    describe('pagination', () => {

        test('a multi-page result set gets numbered pages', async () => {
            const { win, doc } = boot();
            await ready(win, doc);
            await search(win, doc, 'bigresult');

            const nav = doc.getElementById('pagination');
            expect(nav.hidden).toBe(false);

            const lastPage = Math.ceil(260 / win.__limit());
            const numbers = [...nav.querySelectorAll('.pg-btn')]
                .map(b => b.textContent.trim())
                .filter(t => /^\d+$/.test(t));

            expect(numbers).toContain('1');
            expect(numbers).toContain(String(lastPage));
            // Never offers a page beyond the last one.
            expect(numbers.every(n => Number(n) <= lastPage)).toBe(true);

            // Page 1 is current, and Previous is unusable from here.
            expect(nav.querySelector('.pg-btn.active').textContent.trim()).toBe('1');
            expect(nav.querySelector('.pg-arrow').disabled).toBe(true);
        });

        test('clicking a page loads it and returns to the top', async () => {
            const { win, doc } = boot();
            await ready(win, doc);
            await search(win, doc, 'bigresult');

            win.__pages.length = 0;
            win.__scrolls.length = 0;

            const three = [...doc.querySelectorAll('#pagination .pg-btn')]
                .find(b => b.textContent.trim() === '3');
            expect(three).toBeTruthy();
            three.click();
            await sleep(500);

            const size = win.__limit();
            expect(win.__pages).toContain(3);
            expect(win.__state.currentPage).toBe(3);
            // The page replaces the results — it must never append.
            expect(win.__state.products.length).toBe(size);
            expect(doc.getElementById('productGrid').children.length).toBe(size);
            expect(win.__scrolls.some(s => s && s.top === 0)).toBe(true);

            expect(doc.querySelector('#pagination .pg-btn.active').textContent.trim()).toBe('3');
        });

        test('the last page disables Next', async () => {
            const { win, doc } = boot();
            await ready(win, doc);
            await search(win, doc, 'bigresult');

            const lastPage = String(Math.ceil(260 / win.__limit()));
            const last = [...doc.querySelectorAll('#pagination .pg-btn')]
                .find(b => b.textContent.trim() === lastPage);
            expect(last).toBeTruthy();
            last.click();
            await sleep(500);

            const arrows = doc.querySelectorAll('#pagination .pg-arrow');
            expect(arrows[0].disabled).toBe(false);            // Previous usable
            expect(arrows[arrows.length - 1].disabled).toBe(true); // Next is not
        });

        test('a single page of results shows no paginator', async () => {
            const { win, doc } = boot();
            await ready(win, doc);
            await search(win, doc, 'kente');

            expect(win.__state.products.length).toBe(1);
            expect(doc.getElementById('pagination').hidden).toBe(true);
        });

        test('the homepage is paginated too, so the DOM stays bounded', async () => {
            // Infinite scroll let the grid grow until scrolling degraded. The
            // catalogue is paged like a marketplace instead.
            const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
            const dom = new JSDOM(html, { url: 'https://glomek.com/', runScripts: 'outside-only', pretendToBeVisual: true });
            const win = dom.window;
            win.fetch = async (url) => {
                if (String(url).includes('/products?')) {
                    const limit = parseInt((String(url).match(/limit=(\d+)/) || [])[1], 10) || 40;
                    const data = Array.from({ length: limit }, (_, i) => ({ _id: 'h' + i, name: 'Item ' + i, price: 10 }));
                    return { ok: true, json: async () => ({ success: true, data, total: 500 }) };
                }
                return { ok: true, json: async () => ({ success: true, data: [], total: 0 }) };
            };
            win.IntersectionObserver = class { observe() { } unobserve() { } disconnect() { } };
            win.scrollTo = () => { };
            win.Element.prototype.scrollIntoView = () => { };
            win.eval(['js/api.js', 'js/app.js']
                .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n')
                + '\n;window.__state = state;');

            win.document.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
            await sleep(600);

            expect(win.__state.searchKeyword).toBe('');
            expect(win.document.getElementById('pagination').hidden).toBe(false);

            // One page of cards in the DOM, never the whole catalogue.
            expect(win.document.getElementById('productGrid').children.length).toBeLessThanOrEqual(40);
        });
    });

    describe('category listings behave like search results', () => {

        test('picking a category opens a results view with header and pages', async () => {
            const { win, doc, queries } = boot();
            await ready(win, doc);

            win.__state.categories = [{ _id: 'c1', name: 'Electronics' }];
            await win.filterByCategory('c1');
            await sleep(500);

            // Filtering must be asked of the server, not done on one page.
            expect(queries.some(q => q === '')).toBe(true);
            expect(win.__urls.some(u => u.includes('categoryId=c1'))).toBe(true);

            const head = doc.getElementById('searchResultsHead');
            expect(head.hidden).toBe(false);
            expect(doc.getElementById('srhLabel').textContent).toBe('Browsing');
            expect(doc.getElementById('srhTerm').textContent).toBe('Electronics');
            expect(doc.body.classList.contains('is-searching')).toBe(true);
        });

        test('clicking a circle in the category rail opens that category', async () => {
            const { win, doc } = boot();
            await ready(win, doc);

            // Give the rail real categories and let it draw.
            win.__state.categories = [
                { _id: 'c1', name: 'Fashion' },
                { _id: 'c2', name: 'Furniture' }
            ];
            win.renderCategories();
            await sleep(500);

            const circles = [...doc.querySelectorAll('#glCircleRail .gl-circle-item')];
            expect(circles.length).toBeGreaterThan(0);

            const furniture = circles.find(b => b.dataset.cat === 'c2');
            expect(furniture).toBeTruthy();

            win.__urls.length = 0;
            furniture.click();
            await sleep(600);

            // It must actually ask the server for that category and show it.
            expect(win.__state.selectedCategoryId).toBe('c2');
            expect(win.__urls.some(u => u.includes('categoryId=c2'))).toBe(true);
            expect(doc.getElementById('searchResultsHead').hidden).toBe(false);
            expect(doc.getElementById('srhTerm').textContent).toBe('Furniture');
            expect(doc.getElementById('productGrid').hidden).toBe(false);
            expect(win.__state.products.length).toBeGreaterThan(0);
        });

        test('still filters when the API ignores categoryId', async () => {
            // Reproduces the deployed API: it accepts the parameter and returns
            // the whole catalogue anyway. Without a fallback the customer picks
            // a category and sees everything.
            const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
            const dom = new JSDOM(html, { url: 'https://glomek.com/', runScripts: 'outside-only', pretendToBeVisual: true });
            const win = dom.window;

            const MIXED = [
                { _id: 'p1', name: 'Sofa', price: 900, proCategoryId: { _id: 'c2', name: 'Furniture' } },
                { _id: 'p2', name: 'Shirt', price: 90, proCategoryId: { _id: 'c1', name: 'Fashion' } },
                { _id: 'p3', name: 'Table', price: 500, proCategoryId: { _id: 'c2', name: 'Furniture' } },
            ];
            win.fetch = async (url) => {
                if (String(url).includes('/products?')) {
                    // Note: categoryId is deliberately ignored.
                    return { ok: true, json: async () => ({ success: true, data: MIXED, total: 999 }) };
                }
                return { ok: true, json: async () => ({ success: true, data: [], total: 0 }) };
            };
            win.IntersectionObserver = class { observe() { } unobserve() { } disconnect() { } };
            win.scrollTo = () => { };
            win.Element.prototype.scrollIntoView = () => { };
            win.eval(['js/api.js', 'js/app.js']
                .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n')
                + '\n;window.__state = state;');

            win.document.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
            await sleep(500);

            win.__state.categories = [{ _id: 'c2', name: 'Furniture' }];
            await win.filterByCategory('c2');
            await sleep(500);

            // The browser must narrow it instead of showing the whole catalogue.
            expect(win.__state.serverFilterUnavailable).toBe(true);
            expect(win.__state.products.map(p => p.name).sort()).toEqual(['Sofa', 'Table']);

            // And it must not print page numbers derived from a total of 999.
            expect(win.document.getElementById('pagination').hidden).toBe(true);
            expect(win.document.getElementById('srhCount').textContent).toBe('2 items');
        });

        test('a category listing hides the home rails', async () => {
            const { win, doc } = boot();
            await ready(win, doc);
            expect(doc.getElementById('glFlashSection').hidden).toBe(false);

            win.__state.categories = [{ _id: 'c1', name: 'Electronics' }];
            await win.filterByCategory('c1');
            await sleep(500);

            for (const id of ['glCategoryRail', 'glFlashSection', 'glRecoSection', 'glCallStrip']) {
                expect({ id, hidden: doc.getElementById(id).hidden })
                    .toEqual({ id, hidden: true });
            }
        });

        test('the back button leaves a category listing', async () => {
            const { win, doc } = boot();
            await ready(win, doc);

            win.__state.categories = [{ _id: 'c1', name: 'Electronics' }];
            await win.filterByCategory('c1');
            await sleep(500);
            expect(doc.getElementById('searchResultsHead').hidden).toBe(false);

            win.exitListing();
            await sleep(500);

            expect(win.__state.selectedCategoryId).toBeNull();
            expect(doc.getElementById('searchResultsHead').hidden).toBe(true);
            expect(doc.getElementById('glFlashSection').hidden).toBe(false);
        });
    });

    describe('suggestions', () => {

        test('typing never names a product from the catalogue', async () => {
            const LONG = 'Samsung Galaxy A51 SM-A515 16.5 cm (6.5") 4G USB Type-C 4GB 128GB Blue';
            const { win, doc } = boot();
            await ready(win, doc);

            win.__state.allProducts = [{ _id: 'x1', name: LONG, price: 100 }];

            const input = doc.getElementById('searchInput');
            input.value = 'samsung';
            input.dispatchEvent(new win.Event('input', { bubbles: true }));
            await sleep(200);

            // Neither the whole title nor any shortened form of it. The
            // dropdown must not be a window onto the product database.
            const box = doc.getElementById('searchSuggestions');
            expect(box.textContent).not.toContain(LONG);
            expect(box.textContent).not.toContain('Samsung Galaxy');
            expect(box.textContent).not.toContain('Products');
            expect(box.hidden).toBe(true);
        });

        test('products arrive only after the search is submitted', async () => {
            const LONG = 'HP 17.3-inch Prelude Backpack (12 pack)';
            const { win, doc, queries } = boot();
            await ready(win, doc);

            win.__state.allProducts = [{ _id: 'x2', name: LONG, price: 100 }];

            const input = doc.getElementById('searchInput');
            queries.length = 0;
            input.value = 'prelude';
            input.dispatchEvent(new win.Event('input', { bubbles: true }));
            await sleep(300);

            // Typing on its own asks the server for nothing.
            expect(queries).toEqual([]);

            doc.getElementById('searchSubmitBtn').dispatchEvent(
                new win.Event('click', { bubbles: true })
            );
            await sleep(400);

            expect(queries).toContain('prelude');
        });

        test('recent searches are still offered, and only those', async () => {
            const { win, doc } = boot();
            await ready(win, doc);

            win.localStorage.setItem(
                'glomek_search_history', JSON.stringify(['kente cloth'])
            );
            win.__state.allProducts = [{ _id: 'x3', name: 'Kente Wax Print Shirt', price: 60 }];

            const input = doc.getElementById('searchInput');
            input.value = 'kente';
            input.dispatchEvent(new win.Event('input', { bubbles: true }));
            await sleep(200);

            const box = doc.getElementById('searchSuggestions');
            expect(box.hidden).toBe(false);
            expect(box.textContent).toContain('kente cloth');
            expect(box.textContent).not.toContain('Wax Print Shirt');
        });
    });

    describe('the listing lives in the URL', () => {

        test('searching puts the term in the address bar', async () => {
            const { win, doc } = boot();
            await ready(win, doc);

            await search(win, doc, 'kente');

            expect(win.location.search).toContain('q=kente');
        });

        test('changing page puts the page number in the address bar', async () => {
            const { win, doc } = boot();
            await ready(win, doc);
            await search(win, doc, 'bigresult');

            const three = [...doc.querySelectorAll('#pagination .pg-btn')]
                .find(b => b.textContent.trim() === '3');
            three.click();
            await sleep(500);

            expect(win.location.search).toContain('page=3');
            expect(win.location.search).toContain('q=bigresult');
        });

        test('a category listing is addressable too', async () => {
            const { win } = boot();
            await ready(win, win.document);

            win.__state.categories = [{ _id: 'c1', name: 'Electronics' }];
            await win.filterByCategory('c1');
            await sleep(500);

            expect(win.location.search).toContain('cat=c1');
        });

        test('Back escapes a listing in one press, not many', async () => {
            // Restoring a listing used to push a fresh history entry, so every
            // Back press consumed one and immediately created another — the
            // customer had to hammer Back and never got out.
            const { win, doc } = boot();
            await ready(win, doc);

            const start = win.history.length;
            await search(win, doc, 'kente');
            expect(win.location.search).toContain('q=kente');

            const afterSearch = win.history.length;
            expect(afterSearch).toBeGreaterThan(start); // the search pushed once

            win.history.back();
            await sleep(700);

            // One Back leaves the listing, and it must not have grown the stack.
            expect(win.location.search).not.toContain('q=kente');
            expect(win.__state.searchKeyword).toBe('');
            expect(win.history.length).toBeLessThanOrEqual(afterSearch);
        });

        test('opening a shared results link lands on those results', async () => {
            // Boot straight onto a results URL, the way a shared link arrives.
            const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
            const dom = new JSDOM(html, {
                url: 'https://glomek.com/?q=kente',
                runScripts: 'outside-only',
                pretendToBeVisual: true
            });
            const win = dom.window;
            const seen = [];
            win.fetch = async (url) => {
                const u = String(url);
                if (u.includes('/products?')) {
                    const term = decodeURIComponent((u.match(/search=([^&]*)/) || [])[1] || '');
                    seen.push(term);
                    const data = CATALOGUE.filter(p => p.name.toLowerCase().includes(term.toLowerCase()));
                    return { ok: true, json: async () => ({ success: true, data, total: data.length }) };
                }
                return { ok: true, json: async () => ({ success: true, data: [], total: 0 }) };
            };
            win.IntersectionObserver = class { observe() { } unobserve() { } disconnect() { } };
            win.scrollTo = () => { };
            win.Element.prototype.scrollIntoView = () => { };
            win.eval(['js/api.js', 'js/app.js']
                .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n')
                + '\n;window.__state = state;');

            win.document.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
            await sleep(600);

            // The very first product request already carries the term.
            expect(seen[0]).toBe('kente');
            expect(win.__state.searchKeyword).toBe('kente');
            expect(win.document.getElementById('searchInput').value).toBe('kente');
            expect(win.__state.products.map(p => p.name)).toEqual(['Kente Backpack']);
        });
    });

    test('clearing a search brings the home rails back', async () => {
        const { win, doc } = boot();
        await ready(win, doc);

        doc.getElementById('searchInput').value = 'e';
        doc.getElementById('searchSubmitBtn').click();
        await sleep(500);
        expect(doc.getElementById('glFlashSection').hidden).toBe(true);

        doc.getElementById('clearSearchBtn').click();
        await sleep(500);

        expect(win.__state.searchKeyword).toBe('');
        expect(doc.getElementById('glFlashSection').hidden).toBe(false);
        expect(doc.getElementById('glCallStrip').hidden).toBe(false);
        expect(doc.querySelector('.hero-wrapper').style.display).not.toBe('none');
    });
});
