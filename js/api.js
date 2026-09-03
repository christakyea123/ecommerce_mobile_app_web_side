const BASE_URL = 'https://api.glomek.com'; // Base URL for all API calls

class ApiService {
    static async fetchProducts(page = 1, limit = 10, search = '', categoryId = '', subCategoryId = '') {
        try {
            let url = `${BASE_URL}/products?page=${page}&limit=${limit}`;
            if (search) url += `&search=${encodeURIComponent(search)}`;
            if (categoryId) url += `&categoryId=${encodeURIComponent(categoryId)}`;
            if (subCategoryId) url += `&subcategoryId=${encodeURIComponent(subCategoryId)}`;
            
            const req = await fetch(url);
            const res = await req.json();
            if (!res.success) return { items: [], total: 0, page, limit };

            // The API reports `total` for the whole matching set; the UI needs
            // it to render real page numbers rather than guessing.
            return {
                items: res.data || [],
                total: typeof res.total === 'number' ? res.total : (res.data || []).length,
                page: res.page || page,
                limit: res.limit || limit
            };
        } catch (e) {
            console.error('Error fetching products:', e);
            return { items: [], total: 0, page, limit };
        }
    }

    /**
     * Follows a paginated collection to the end, instead of taking the first
     * page and hoping it was all of it.
     *
     * Every reference list here was a single fixed fetch — categories at
     * limit=20, posters at limit=5, subCategories at the default limit=10,
     * brands at 50. Nothing read `total`, so the moment the catalogue outgrew
     * a hardcoded number the extras simply stopped existing on the site, with
     * no error anywhere. subCategories was one short of that: 7 of a limit of
     * 10. Verified against production, which honours both page and limit and
     * reports total:
     *
     *     posters?page=1&limit=2 -> 2 items, total 3
     *     posters?page=2&limit=2 -> 1 item,  total 3
     *     posters?page=3&limit=2 -> 0 items
     *
     * maxPages is a guard, not a limit: if a server ever ignored `page` and
     * returned the same rows forever, the total check below stops after one
     * pass anyway — this is purely so a misbehaving endpoint cannot spin.
     */
    static async _fetchAllPages(endpoint, label, pageSize = 50, maxPages = 20) {
        const out = [];
        try {
            for (let page = 1; page <= maxPages; page++) {
                const req = await fetch(`${BASE_URL}/${endpoint}?page=${page}&limit=${pageSize}`);
                const res = await req.json();
                if (!res || !res.success || !Array.isArray(res.data)) break;

                out.push(...res.data);

                // A short page is the last page.
                if (res.data.length < pageSize) break;
                // And stop as soon as we hold everything the server says exists.
                const total = typeof res.total === 'number' ? res.total : out.length;
                if (out.length >= total) break;
            }
        } catch (e) {
            console.error(`Error fetching ${label}:`, e);
        }
        return out;
    }

    static async fetchCategories() {
        return this._fetchAllPages('categories', 'categories');
    }

    static async fetchPosters() {
        return this._fetchAllPages('posters', 'posters', 20);
    }

    static async fetchRecommendations(userId = '') {
        try {
            const url = userId ? `${BASE_URL}/recommendations/${userId}` : `${BASE_URL}/recommendations`;
            const req = await fetch(url);
            const res = await req.json();
            return res.success ? res.data : [];
        } catch (e) {
            console.error('Error fetching recommendations:', e);
            return [];
        }
    }

    // --- NEW FULL BACKEND APIS --- //

    // The old page/limit arguments are accepted and ignored: both callers
    // wanted "all of them", and passing a number was how they got truncated.
    static async fetchSubCategories() {
        return this._fetchAllPages('subCategories', 'subcategories');
    }

    static async fetchBrands() {
        return this._fetchAllPages('brands', 'brands');
    }

    // --- AUTHENTICATION --- //
    static async login(email, password) {
        return this._post('users/login-user', { name: email.toLowerCase(), password });
    }

    static async register(name, email, password) {
        return this._post('users/register', { name: name.toLowerCase(), email: email.toLowerCase(), password });
    }

    static async logout() {
        return this._post('users/logout', {});
    }

    static async googleLogin(email, name) {
        return this._post('users/google-login', { email: email.toLowerCase(), name });
    }

    /**
     * Does the HttpOnly cookie alone authenticate us?
     *
     * Deliberately sends NO Authorization header, so the only credential in
     * play is the cookie the server set at login. The API reads a cookie named
     * `token` — verified against production:
     *
     *     Cookie: token=bogus        -> {"message":"Invalid token"}   (read)
     *     Cookie: glomek_token=bogus -> {"message":"No token provided"} (ignored)
     *     Authorization: Bearer ...  -> {"message":"Invalid token"}   (read)
     *
     * A plain 200 means the cookie carried the request on its own, and the
     * copy the page is holding in sessionStorage is dead weight.
     */
    static async cookieAuthWorks(userId) {
        try {
            const req = await fetch(`${BASE_URL}/orders/orderByUserId/${userId}?page=1&limit=1`, {
                credentials: "include"
            });
            return req.status === 200;
        } catch (e) {
            return false;
        }
    }

    static async forgotPassword(email) {
        return this._post('users/forgot-password', { email });
    }

    static async resetPassword(email, code, newPassword) {
        return this._post('users/reset-password', { email, code, newPassword });
    }

    // --- CHECKOUT & ORDERS --- //
    static async checkCoupon(couponCode, purchaseAmount, productIds) {
        return this._post('couponCodes/check-coupon', { couponCode, purchaseAmount, productIds });
    }

    static async createOrder(orderData, token) {
        return this._post('orders', orderData, token);
    }

    /**
     * Returns { orders, unauthorized }.
     *
     * The distinction matters: this used to answer [] for a 401 exactly as it
     * did for a customer with no orders, so a signed-out page cheerfully said
     * "You haven't placed any orders yet." It also sent the literal header
     * "Bearer null" when no token was available, which is worse than sending
     * none — some proxies reject a malformed header outright.
     */
    static async fetchUserOrders(userId, token, page = 1) {
        try {
            const headers = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const req = await fetch(`${BASE_URL}/orders/orderByUserId/${userId}?page=${page}&limit=10`, {
                headers,
                credentials: 'include'
            });
            if (req.status === 401 || req.status === 403) {
                return { orders: [], unauthorized: true };
            }
            const res = await req.json();
            return { orders: (res && res.success && Array.isArray(res.data)) ? res.data : [], unauthorized: false };
        } catch (e) {
            console.error('Error fetching orders:', e);
            return { orders: [], unauthorized: false, error: true };
        }
    }

    // --- PAYSTACK PAYMENT --- //
    // Paystack is the only gateway: it fronts both mobile money (MTN, Telecel,
    // AirtelTigo) and card. There is no direct MoMo call and no cash on delivery.

    /**
     * Opens a transaction server-side. Used as the fallback when the inline
     * popup script is unavailable — the customer is sent to authorization_url.
     * @param {string[]} channels e.g. ['mobile_money'] or ['card']
     */
    static async initiatePaystackPayment(amount, email, reference, channels, callbackUrl, token) {
        return this._post('payment/paystack/initiate', {
            amount,
            email,
            reference,
            ...(channels && channels.length ? { channels } : {}),
            ...(callbackUrl ? { callback_url: callbackUrl } : {})
        }, token);
    }

    static async verifyPaystackPayment(reference, token) {
        return this._post('payment/paystack/verify', { reference }, token);
    }

    // --- PRODUCT RATINGS --- //
    static async rateProduct(productId, rating, review, token) {
        return this._post('products/rate', { productId, rating, review }, token);
    }

    /**
     * One retry, because this is what a shared product link depends on.
     *
     * A single dropped request used to be indistinguishable from a deleted
     * product: both returned null and both said "Product not found". On a
     * phone — patchy signal, a radio waking up, a backgrounded tab — the
     * dropped request is by far the likelier of the two, and it is the one
     * worth trying again. A real 404 is not, so it short-circuits.
     */
    static async fetchProductById(productId, attempts = 2) {
        for (let i = 0; i < attempts; i++) {
            try {
                const req = await fetch(`${BASE_URL}/products/${productId}`);
                if (req.status === 404) return null;
                const res = await req.json();
                return (res && res.success) ? res.data : null;
            } catch (e) {
                if (i === attempts - 1) {
                    console.error("Error fetching product " + productId + ":", e);
                    return null;
                }
                await new Promise(r => setTimeout(r, 400));
            }
        }
        return null;
    }

    // --- UTILS --- //
    static async _post(endpoint, data, token = null) {
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const req = await fetch(`${BASE_URL}/${endpoint}`, {
                method: 'POST',
                headers,
                credentials: 'include',
                body: JSON.stringify(data)
            });
            return await req.json();
        } catch(e) {
            console.error(`POST ${endpoint} error:`, e);
            return { success: false, message: e.message };
        }
    }
}
