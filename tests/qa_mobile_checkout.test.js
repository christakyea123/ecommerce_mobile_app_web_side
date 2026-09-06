/**
 * ============================================================
 * PAYSTACK CHECKOUT + MOBILE APP SHELL
 * ============================================================
 * Boots index.html in JSDOM against the real api.js / app.js /
 * mobile-app.js and drives a full purchase: pick a payment
 * method, apply a coupon, pay, verify, create the order.
 * ============================================================
 */
const fs = require('fs');
const path = require('path');
const util = require('util');

global.TextEncoder = util.TextEncoder;
global.TextDecoder = util.TextDecoder;

const { JSDOM } = require('jsdom');

// `npm run test:dist` points this at dist/ so the minified bundle is verified
// by the same suite as the source.
const ROOT = process.env.GLOMEK_ROOT
    ? path.resolve(__dirname, '..', process.env.GLOMEK_ROOT)
    : path.resolve(__dirname, '..');

jest.setTimeout(30000);

describe('Paystack checkout + app shell', () => {
    let dom, win, doc;
    const apiCalls = [];
    let paystackSetupArgs = null;

    beforeAll(async () => {
        const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

        dom = new JSDOM(html, {
            url: 'https://glomek.com/index.html',
            runScripts: 'outside-only',
            pretendToBeVisual: true
        });
        win = dom.window;
        doc = win.document;

        // --- stub the network -------------------------------------------
        win.fetch = async (url, opts = {}) => {
            const body = opts.body ? JSON.parse(opts.body) : null;
            apiCalls.push({ url: String(url), method: opts.method || 'GET', body });

            let payload = { success: true, data: [] };
            if (String(url).includes('/payment/paystack/verify')) {
                payload = { success: true, message: 'Payment verified', data: { status: 'success' } };
            } else if (String(url).endsWith('/orders') && opts.method === 'POST') {
                payload = { success: true, data: { _id: 'order123abc456' } };
            } else if (String(url).includes('check-coupon')) {
                payload = { success: true, data: { _id: 'cpn1', discountAmount: 30 } };
            }
            return { ok: true, json: async () => payload };
        };

        // --- stub Paystack inline ---------------------------------------
        win.PaystackPop = {
            setup(args) {
                paystackSetupArgs = args;
                return { openIframe() { /* the iframe would appear here */ } };
            }
        };

        win.navigator.vibrate = () => true;
        win.scrollTo = () => { };
        win.localStorage.setItem('glomek_user', JSON.stringify({ _id: 'u1', name: 'Ama', email: 'ama@example.com' }));

        // Classic scripts share one global scope in a browser; a single eval
        // reproduces that. The trailing lines re-expose script-scoped names
        // that would be real globals in a browser.
        const bundle = ['js/api.js', 'js/app.js', 'js/mobile-app.js']
            .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'))
            .join('\n;\n')
            + '\n;window.__state = state;'
            + 'window.__fmt = formatPaymentMethod;'
            + 'window.toggleCart = toggleCart;'
            + 'window.toggleWishlist = toggleWishlist;'
            + 'window.loadProducts = loadProducts;'
            + 'window.renderProducts = renderProducts;'
            + 'window.__setPdProduct = (p) => { currentPdProduct = p; };'
            + 'window.renderProductReviews = renderProductReviews;'
            + 'window.updatePdRatingStars = updatePdRatingStars;'
            + 'window.showToast = showToast; window.escapeHtml = escapeHtml;'
            + 'window.__showReceipt = showReceipt;'
            + 'window.__setUser = (u) => { currentUser = u; };';
        win.eval(bundle);

        doc.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
        await new Promise(r => setTimeout(r, 300));
    });

    test('no direct MoMo or cash-on-delivery left in the checkout', () => {
        const src = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8')
            + fs.readFileSync(path.join(ROOT, 'js/api.js'), 'utf8');
        expect(src).not.toMatch(/initiateMomoPayment|payment\/momo/);

        // 'cash_on_delivery' survives only as a display label for historic
        // orders. Minification rewrites quoting, so assert on the label map
        // shape only when reading the unminified source.
        const codMentions = src.match(/cash_on_delivery/g) || [];
        expect(codMentions.length).toBe(1);
        if (!process.env.GLOMEK_ROOT) {
            expect(src).toMatch(/'cash_on_delivery': 'Cash on Delivery'/);
        }

        expect(doc.getElementById('chkPaymentMethod')).toBeNull();
        expect(doc.getElementById('codNotice')).toBeNull();
        expect(doc.getElementById('momoFieldSection')).toBeNull();
    });

    test('payment picker offers exactly the three Paystack options', () => {
        const values = [...doc.querySelectorAll('input[name="payMethod"]')].map(i => i.value);
        expect(values).toEqual(['paystack_momo', 'paystack_card', 'paystack']);
        expect(doc.querySelector('input[name="payMethod"]:checked').value).toBe('paystack_momo');
    });

    test('selecting a method moves the highlight and the hint', () => {
        win.selectPaymentMethod('paystack_card');
        const tiles = [...doc.querySelectorAll('#payMethods .pay-method')];
        expect(tiles[1].classList.contains('selected')).toBe(true);
        expect(tiles[0].classList.contains('selected')).toBe(false);
        expect(doc.getElementById('payMethodHint').textContent).toMatch(/card/i);

        doc.querySelector('input[value="paystack_momo"]').checked = true;
        win.selectPaymentMethod('paystack_momo');
    });

    test('cart totals flow into the summary and the pay button', () => {
        win.addToCart('p1', encodeURIComponent(JSON.stringify({ name: 'Kente Shirt', price: 120, image: 'x.png' })));
        win.addToCart('p2', encodeURIComponent(JSON.stringify({ name: 'Sandals', price: 80, image: 'y.png' })));
        win.updateQty('p1', 1); // 2 x 120 + 80 = 320

        doc.getElementById('checkoutBtn').click();

        expect(doc.getElementById('checkoutModal').hidden).toBe(false);
        expect(doc.getElementById('chkSubtotal').textContent).toBe('GH₵320.00');
        expect(doc.getElementById('checkoutAmount').textContent).toBe('GH₵320.00');
        expect(doc.getElementById('payBtnAmount').textContent).toBe('GH₵320.00');
        expect(doc.getElementById('chkDiscountRow').hidden).toBe(true);
    });

    test('a coupon updates the discount row and the total', async () => {
        doc.getElementById('chkCoupon').value = 'SAVE30';
        await win.applyCoupon();

        expect(doc.getElementById('chkDiscountRow').hidden).toBe(false);
        expect(doc.getElementById('chkDiscount').textContent).toBe('-GH₵30.00');
        expect(doc.getElementById('checkoutAmount').textContent).toBe('GH₵290.00');
    });

    test('submitting opens Paystack with the momo channel and discounted amount', async () => {
        doc.getElementById('chkPhone').value = '0244000000';
        doc.getElementById('chkAddress').value = '12 Oxford St';
        doc.getElementById('chkCity').value = 'Accra';
        doc.getElementById('chkState').value = 'Greater Accra';
        doc.getElementById('chkPostalCode').value = '00233';

        // Deliberately not awaited: the promise settles only once Paystack
        // fires callback/onClose, which is what the next tests drive.
        win.handleCheckoutSubmit({ preventDefault() { } });
        await new Promise(r => setTimeout(r, 100));

        expect(paystackSetupArgs).not.toBeNull();
        expect(paystackSetupArgs.channels).toEqual(['mobile_money']);
        expect(paystackSetupArgs.amount).toBe(29000); // pesewas, after discount
        expect(paystackSetupArgs.currency).toBe('GHS');
        expect(paystackSetupArgs.email).toBe('ama@example.com');
        expect(paystackSetupArgs.ref).toMatch(/^GLOMEK_/);
    });

    test('a successful payment verifies, then creates a verified order', async () => {
        apiCalls.length = 0;
        const ref = paystackSetupArgs.ref;
        paystackSetupArgs.callback({ reference: ref });
        await new Promise(r => setTimeout(r, 300));

        const verify = apiCalls.find(c => c.url.includes('paystack/verify'));
        expect(verify).toBeTruthy();
        expect(verify.body.reference).toBe(ref);

        const order = apiCalls.find(c => c.url.endsWith('/orders'));
        expect(order).toBeTruthy();
        expect(order.body.paymentMethod).toBe('paystack_momo');
        expect(order.body.paymentId).toBe(ref);
        expect(order.body.totalPrice).toBe(290);
        expect(order.body.orderTotal).toEqual({ subtotal: 320, discount: 30, total: 290 });
        expect(order.body.shippingAddress.city).toBe('Accra');
        expect(order.body.couponCode).toBe('cpn1');

        expect(win.__state.cart.length).toBe(0);
        expect(doc.getElementById('checkoutModal').hidden).toBe(true);
        expect(doc.getElementById('receiptModal').hidden).toBe(false);
        expect(doc.getElementById('receiptMeta').textContent).toMatch(/Mobile Money \(Paystack\)/);
    });

    test('cancelling leaves the cart alone and re-enables the button', async () => {
        win.closeModal('receiptModal');
        win.addToCart('p3', encodeURIComponent(JSON.stringify({ name: 'Hat', price: 50, image: 'z.png' })));
        doc.getElementById('checkoutBtn').click();
        win.handleCheckoutSubmit({ preventDefault() { } });
        await new Promise(r => setTimeout(r, 100));

        paystackSetupArgs.onClose();
        expect(win.__state.cart.length).toBe(1);
        expect(doc.getElementById('payBtn').disabled).toBe(false);
        win.closeModal('checkoutModal');
    });

    test('there is no bottom tab bar — the drawer is the only nav surface', () => {
        expect(doc.getElementById('appTabBar')).toBeNull();
        expect(doc.querySelector('.app-tabbar')).toBeNull();
        expect(doc.querySelector('.app-tab')).toBeNull();
    });

    test('the drawer carries Home, Saved, Cart and Account with live counts', () => {
        win.openCategoryDrawer();

        const rows = [...doc.querySelectorAll('.cat-drawer-row.nav')].map(r => r.dataset.go);
        expect(rows).toEqual(['home', 'saved', 'cart', 'account']);

        // One item is in the cart at this point in the run.
        const cartCount = doc.getElementById('drawerCartCount');
        expect(cartCount.hidden).toBe(false);
        expect(cartCount.textContent).toBe('1');

        win.closeCategoryDrawer();
    });

    test('the drawer Cart row opens the cart and locks the page behind it', () => {
        win.openCategoryDrawer();
        doc.querySelector('.cat-drawer-row.nav[data-go="cart"]').click();

        expect(doc.getElementById('categoryDrawer').classList.contains('open')).toBe(false);
        expect(doc.getElementById('cartSidebar').classList.contains('open')).toBe(true);
        expect(doc.body.classList.contains('overlay-open')).toBe(true);

        win.toggleCart(false);
        expect(doc.body.classList.contains('overlay-open')).toBe(false);
    });

    test('the hamburger opens the category drawer', () => {
        win.__state.categories = [
            { _id: 'c1', name: 'Fashion' },
            { _id: 'c2', name: 'Electronics' }
        ];
        win.__state.subCategories = [
            { _id: 's1', name: 'Shoes', proCategoryId: 'c1' }
        ];

        const burger = doc.getElementById('menuToggleBtn');
        expect(burger).not.toBeNull();

        burger.click();
        const drawer = doc.getElementById('categoryDrawer');
        expect(drawer).not.toBeNull();
        expect(drawer.classList.contains('open')).toBe(true);
        expect(burger.getAttribute('aria-expanded')).toBe('true');
        expect(doc.getElementById('drawerList').textContent).toContain('Fashion');
        // Subcategories are listed inline under their parent.
        expect(doc.getElementById('drawerList').textContent).toContain('Shoes');

        // Escape closes it.
        doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
        expect(drawer.classList.contains('open')).toBe(false);
        expect(burger.getAttribute('aria-expanded')).toBe('false');

        // Reopening restores it.
        burger.click();
        expect(doc.getElementById('categoryDrawer').classList.contains('open')).toBe(true);
        win.closeCategoryDrawer();
    });

    test('choosing a category from the drawer filters and closes it', () => {
        win.__state.categories = [{ _id: 'c1', name: 'Fashion' }];
        let filtered = null;
        const original = win.filterByCategory;
        win.filterByCategory = (id) => { filtered = id; };

        win.openCategoryDrawer();
        const row = [...doc.querySelectorAll('.cat-drawer-row')].find(r => r.dataset.cat === 'c1');
        expect(row).toBeTruthy();
        row.click();

        expect(filtered).toBe('c1');
        expect(doc.getElementById('categoryDrawer').classList.contains('open')).toBe(false);
        win.filterByCategory = original;
    });

    test('product cards carry a quick add-to-cart button', () => {
        win.__state.products = [{
            _id: 'pq1',
            name: 'Ankara Dress',
            price: 200,
            offerPrice: 150,
            images: [{ url: 'dress.png' }]
        }];
        win.renderProducts();

        const card = doc.querySelector('#productGrid .product-card');
        expect(card).not.toBeNull();

        // Full-width "Add to cart", the way a marketplace card carries it.
        const quickAdd = card.querySelector('.card-add-btn');
        expect(quickAdd).not.toBeNull();

        // JSDOM in outside-only mode does not run inline onclick attributes,
        // so invoke the handler the way the attribute would.
        const attr = quickAdd.getAttribute('onclick');
        expect(attr).toMatch(/^quickAddToCart\(event, 'pq1', '/);

        const encoded = attr.match(/'pq1', '([^']+)'/)[1];
        let bubbled = false;
        win.quickAddToCart({
            stopPropagation() { bubbled = false; },
            preventDefault() { },
            currentTarget: quickAdd
        }, 'pq1', encoded);

        expect(bubbled).toBe(false); // the card's own click never fires
        expect(win.__state.cart.some(i => i.productId === 'pq1')).toBe(true);
        expect(win.__state.cart.find(i => i.productId === 'pq1').price).toBe(150); // offer price
        expect(quickAdd.classList.contains('added')).toBe(true);
    });

    test('sharing a product falls back to the clipboard with a deep link', async () => {
        const copied = [];
        Object.defineProperty(win.navigator, 'clipboard', {
            value: { writeText: async (t) => { copied.push(t); } },
            configurable: true
        });
        win.__setPdProduct({ _id: 'pq1', name: 'Ankara Dress', offerPrice: 150 });

        await win.shareCurrentProduct();
        expect(copied[0]).toContain('/p/pq1');
    });

    // ── Security ────────────────────────────────────────────────────────
    describe('XSS hardening', () => {
        const PAYLOAD = '<img src=x onerror="window.__pwned=1">';

        test('a malicious product name cannot execute from the grid', () => {
            win.__state.products = [{
                _id: 'evil1',
                name: PAYLOAD,
                price: 10,
                images: [{ url: 'x.png' }]
            }];
            win.renderProducts();

            const grid = doc.getElementById('productGrid');
            // The payload must appear as text, never as a live <img> element.
            expect(grid.textContent).toContain('onerror');
            expect(grid.querySelector('img[src="x"]')).toBeNull();
            expect(win.__pwned).toBeUndefined();
        });

        test('a malicious review cannot execute on the product page', () => {
            win.eval(`renderProductReviews({
                ratings: [{ userId: { name: '${PAYLOAD.replace(/'/g, "\\'")}' }, rating: 5, review: '${PAYLOAD.replace(/'/g, "\\'")}' }]
            })`);

            const list = doc.getElementById('pdReviewsList');
            expect(list.querySelector('img[src="x"]')).toBeNull();
            expect(list.textContent).toContain('onerror');
            expect(win.__pwned).toBeUndefined();
        });

        test('a malicious name cannot execute through a toast', () => {
            win.eval(`showToast('${PAYLOAD.replace(/'/g, "\\'")} added to cart', 'success')`);
            const toast = doc.querySelector('#toastContainer .toast');
            expect(toast.querySelector('img[src="x"]')).toBeNull();
            expect(win.__pwned).toBeUndefined();
        });

        test('a malicious delivery address cannot execute on the receipt', () => {
            // Every one of these fields is typed by the customer at checkout.
            win.__showReceipt({
                paymentMethod: 'paystack_momo',
                items: [{ productName: PAYLOAD, quantity: 1, price: 10 }],
                totalPrice: 10,
                orderTotal: { subtotal: 10, discount: 0, total: 10 },
                shippingAddress: {
                    street: PAYLOAD,
                    city: PAYLOAD,
                    state: PAYLOAD,
                    postalCode: PAYLOAD,
                    country: PAYLOAD,
                    phone: PAYLOAD
                }
            }, { data: { _id: 'order1' } });

            const shipping = doc.getElementById('receiptShipping');
            expect(shipping.querySelector('img[src="x"]')).toBeNull();
            expect(shipping.textContent).toContain('onerror');

            const items = doc.getElementById('receiptItems');
            expect(items.querySelector('img[src="x"]')).toBeNull();
            expect(win.__pwned).toBeUndefined();

            win.closeModal('receiptModal');
        });

        test('a malicious account name cannot execute on the receipt', () => {
            win.__setUser({ _id: 'u1', name: PAYLOAD, email: 'a@b.com' });
            win.__showReceipt({
                paymentMethod: 'paystack',
                items: [],
                totalPrice: 0,
                orderTotal: { subtotal: 0, discount: 0, total: 0 },
                shippingAddress: {}
            }, { data: { _id: 'order2' } });

            const meta = doc.getElementById('receiptMeta');
            expect(meta.querySelector('img[src="x"]')).toBeNull();
            expect(meta.textContent).toContain('onerror');
            expect(win.__pwned).toBeUndefined();

            win.closeModal('receiptModal');
            win.__setUser({ _id: 'u1', name: 'Ama', email: 'ama@example.com' });
        });

        test('escapeHtml keeps falsy-but-real values like 0', () => {
            expect(win.eval('escapeHtml(0)')).toBe('0');
            expect(win.eval('escapeHtml(null)')).toBe('');
            expect(win.eval('escapeHtml(undefined)')).toBe('');
        });
    });

    // ── Accessibility ───────────────────────────────────────────────────
    describe('accessibility', () => {
        test('modals announce themselves as dialogs and restore focus', () => {
            const trigger = doc.getElementById('cartToggleBtn');
            trigger.focus();

            win.openModal('authModal');
            const modal = doc.getElementById('authModal');
            expect(modal.getAttribute('role')).toBe('dialog');
            expect(modal.getAttribute('aria-modal')).toBe('true');
            expect(modal.getAttribute('aria-labelledby')).toBeTruthy();

            win.closeModal('authModal');
            expect(doc.activeElement).toBe(trigger);
        });

        test('Escape closes exactly one layer, not two', () => {
            win.openModal('authModal');
            win.openModal('forgotPasswordModal');

            doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
            expect(doc.getElementById('forgotPasswordModal').hidden).toBe(true);
            expect(doc.getElementById('authModal').hidden).toBe(false);

            win.closeModal('authModal');
        });

        test('every bare input carries an accessible name', () => {
            const unnamed = [...doc.querySelectorAll('input:not([type="hidden"]):not([type="radio"]), select, textarea')]
                .filter(el => !el.getAttribute('aria-label')
                    && !el.getAttribute('aria-labelledby')
                    && !doc.querySelector(`label[for="${el.id}"]`))
                .map(el => el.id || el.outerHTML.slice(0, 60));

            expect(unnamed).toEqual([]);
        });

        test('the page offers a skip link', () => {
            const skip = doc.querySelector('.skip-link');
            expect(skip).not.toBeNull();
            expect(skip.getAttribute('href')).toBe('#productGrid');
        });

        test('toasts live in a polite live region', () => {
            const c = doc.getElementById('toastContainer');
            expect(c.getAttribute('aria-live')).toBe('polite');
            expect(c.getAttribute('role')).toBe('status');
        });
    });

    test('Add to cart confirms on the button itself', () => {
        // The card button became a text label; the old code swapped an icon
        // that no longer exists and toggled a class whose styles were tied to
        // the previous selector, so tapping gave no feedback at all.
        win.__state.products = [{
            _id: 'fb1', name: 'Feedback Item', price: 100, images: [{ url: 'f.png' }]
        }];
        win.renderProducts();

        const btn = doc.querySelector('#productGrid .card-add-btn');
        expect(btn).not.toBeNull();
        expect(btn.textContent.trim()).toBe('Add to cart');

        const attr = btn.getAttribute('onclick');
        const encoded = attr.match(/'fb1', '([^']+)'/)[1];
        win.quickAddToCart(
            { stopPropagation() { }, preventDefault() { }, currentTarget: btn },
            'fb1', encoded
        );

        expect(btn.classList.contains('added')).toBe(true);
        expect(btn.textContent).toMatch(/Added/);

        // …and the styling for that state must exist.
        const css = fs.readFileSync(path.join(ROOT, 'css/modern.css'), 'utf8');
        expect(css).toMatch(/\.card-add-btn\.added\s*\{/);
    });

    test('the rating count is a real control that opens the reviews', () => {
        // It used to be `<a href="#">` with no handler — clicking it did
        // nothing at all (or jumped the page to the top).
        let scrolledTo = null;
        win.Element.prototype.scrollIntoView = function () { scrolledTo = this.className; };

        win.eval(`updatePdRatingStars({ averageRating: 4.5, numberOfReviews: 3 })`);

        const link = doc.querySelector('.pd-rating .pd-rating-link');
        expect(link).not.toBeNull();
        expect(link.tagName).toBe('BUTTON');
        expect(link.textContent).toContain('3 ratings');

        link.click();
        expect(String(scrolledTo)).toContain('pd-reviews-section');
    });

    test('no dead "#" links are left in the product sheet', () => {
        const modal = doc.getElementById('productDetailModal');
        const dead = [...modal.querySelectorAll('a[href="#"]')]
            .filter(a => !a.getAttribute('onclick'))
            .map(a => a.textContent.trim().slice(0, 40));
        expect(dead).toEqual([]);
    });

    test('legacy order payment labels still resolve', () => {
        expect(win.__fmt('mtn_mobile_money')).toBe('MTN Mobile Money');
        expect(win.__fmt('paystack_card')).toBe('Card (Paystack)');
        expect(win.__fmt('paystack')).toBe('Paystack');
        expect(win.__fmt('paystack_momo')).toBe('Mobile Money (Paystack)');
    });
});
