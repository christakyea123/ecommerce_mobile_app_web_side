/**
 * A customer quoting their order number is the commonest support request
 * there is. The site showed the id truncated to 12 upper-case characters —
 * half of a 24-character database id — so an order placed on the website
 * could not be looked up in the admin panel at all. Worse, when the response
 * carried no data the receipt invented one ("ORD-" + a timestamp), handing
 * the customer a reference that existed nowhere.
 */
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(WEB, 'js', 'app.js'), 'utf8');
const ordersJs = fs.readFileSync(path.join(WEB, 'js', 'orders.js'), 'utf8');
const componentsCss = fs.readFileSync(path.join(WEB, 'css', 'components.css'), 'utf8');

describe('🔗 a shared link must not open a stub', () => {
    // A recently-viewed entry holds only { _id, name, price, image } - a single
    // image STRING, no images array, no description, no ratings. Opened as if
    // it were a product it renders a broken image, "No description provided"
    // and "0 ratings", with only the price right. That is what a shared link
    // showed whenever the visitor had viewed the item before, and it persists
    // in localStorage so it kept happening.
    test('only a full product satisfies the instant lookup', () => {
        expect(appJs).toMatch(/function isFullProduct/);
        expect(appJs).toMatch(/Array\.isArray\(p\.images\)/);
    });

    test('the cached sources are filtered through it', () => {
        const fn = appJs.slice(
            appJs.indexOf('window.openProductDetails = async function'),
            appJs.indexOf('showPdLoadingSkeleton()')
        );
        expect(fn).toMatch(/\.find\(isFullProduct\)/);
        // recentlyViewed may still be consulted - it just cannot win unless
        // the entry happens to be a complete product.
        expect(fn).toMatch(/recentlyViewed/);
    });

    test('a stub still falls through to the fetch path', () => {
        const fn = appJs.slice(
            appJs.indexOf('window.openProductDetails = async function'),
            appJs.indexOf('// Populate immediately with cached data')
        );
        expect(fn).toMatch(/if \(!product\)/);
        expect(fn).toMatch(/fetchProductById/);
    });

    test('recently-viewed entries are still only stubs, by design', () => {
        // If this ever changes to store full products the filter above stops
        // mattering - but until then it is the only thing standing between a
        // shared link and an empty product page.
        const tracker = appJs.slice(
            appJs.indexOf('function trackRecentlyViewed'),
            appJs.indexOf('renderRecentlyViewed();', appJs.indexOf('function trackRecentlyViewed'))
        );
        expect(tracker).toMatch(/const entry = \{/);
        expect(tracker).not.toMatch(/images:/);
    });
});

describe('🧾 the order id a customer can quote', () => {
    test('no invented order id survives anywhere', () => {
        // The fallback that produced an id no database row ever had.
        expect(appJs).not.toMatch(/'ORD-' \+ Date\.now\(\)/);
        expect(ordersJs).not.toMatch(/'ORD-' \+ Date\.now\(\)/);
    });

    test('the profile modal shows the full id too', () => {
        // It was truncated to 8 characters here — shorter still than the 12
        // elsewhere — so the orders page and the profile disagreed about what
        // a customer's own order number was.
        expect(appJs).not.toMatch(/Order #\$\{o\._id \? o\._id\.substring/);

        const card = appJs.slice(
            appJs.indexOf('<div class="order-card">'),
            appJs.indexOf('Download PDF')
        );
        expect(card).toMatch(/renderOrderIdValue\(o\._id\)/);
    });

    test('no order id anywhere is cut to 8 characters', () => {
        for (const src of [appJs, ordersJs]) {
            expect(src).not.toMatch(/substring\(0, 8\)/);
        }
    });

    test('the id shown to the customer is never truncated', () => {
        // Filenames may still be shortened — a .pdf name needs no full id —
        // so only the displayed values are checked here.
        const displayTruncations = [...appJs.matchAll(/substring\(0, 12\)/g)]
            .map((m) => appJs.slice(Math.max(0, m.index - 90), m.index + 30))
            .filter((ctx) => !ctx.includes('doc.save'));

        expect(displayTruncations).toEqual([]);

        const ordersTruncations = [...ordersJs.matchAll(/substring\(0, 12\)/g)]
            .map((m) => ordersJs.slice(Math.max(0, m.index - 90), m.index + 30))
            .filter((ctx) => !ctx.includes('doc.save'));

        expect(ordersTruncations).toEqual([]);
    });

    test('the receipt renders the full id with a copy button', () => {
        expect(appJs).toMatch(/function renderOrderIdValue/);
        expect(appJs).toMatch(/order-id-copy/);
        // Escaped, because it lands in an innerHTML sink.
        expect(appJs).toMatch(/escapeHtml\(id\)/);
    });

    test('a missing id says so rather than showing a broken reference', () => {
        expect(appJs).toMatch(/Not available/);
    });

    test('the orders page shows the full id and can copy it', () => {
        expect(ordersJs).toMatch(/class="order-id-text">\$\{escapeHtml\(order\._id/);
        expect(ordersJs).toMatch(/order-id-copy/);
    });

    test('the orders page carries its own copy helper', () => {
        // This page does not load app.js. Calling into it would throw and take
        // the whole orders list down — the same trap escapeHtml hit before.
        expect(ordersJs).toMatch(/async function copyOrderId/);
        expect(ordersJs).toMatch(/function alertCopied/);
    });

    test('both pages wire the button by delegation', () => {
        // Receipts and orders are rendered after load, so a direct listener
        // bound at startup would miss them.
        for (const src of [appJs, ordersJs]) {
            expect(src).toMatch(/addEventListener\('click'[\s\S]{0,160}order-id-copy/);
        }
    });

    test('the PDF receipts carry the full id too', () => {
        expect(appJs).toMatch(/\['Order ID', order\._id \|\| 'Not available'\]/);
        expect(ordersJs).toMatch(/\['Order ID', order\._id \|\| 'Not available'\]/);
    });

    test('a 24-character id is styled to wrap rather than widen the card', () => {
        expect(componentsCss).toMatch(/\.order-id-text/);
        expect(componentsCss).toMatch(/word-break: break-all/);
        // Selectable, so a copy still works if the clipboard API is refused.
        expect(componentsCss).toMatch(/user-select: all/);
    });

    test('the copy button is a real tap target', () => {
        const block = componentsCss.slice(
            componentsCss.indexOf('.order-id-copy'),
            componentsCss.indexOf('.order-id-copy:hover')
        );
        expect(block).toMatch(/min-height: 28px/);
    });
});
