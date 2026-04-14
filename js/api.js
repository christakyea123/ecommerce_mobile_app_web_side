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
            return res.success ? res.data : [];
        } catch (e) {
            console.error('Error fetching products:', e);
            return [];
        }
    }

    static async fetchCategories() {
        try {
            const req = await fetch(`${BASE_URL}/categories?page=1&limit=20`);
            const res = await req.json();
            return res.success ? res.data : [];
        } catch (e) {
            console.error('Error fetching categories:', e);
            return [];
        }
    }

    static async fetchPosters() {
        try {
            const req = await fetch(`${BASE_URL}/posters?page=1&limit=5`);
            const res = await req.json();
            return res.success ? res.data : [];
        } catch (e) {
            console.error('Error fetching posters:', e);
            return [];
        }
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

    static async fetchSubCategories(page = 1, limit = 10) {
        try {
            const req = await fetch(`${BASE_URL}/subCategories?page=${page}&limit=${limit}`);
            const res = await req.json();
            return res.success ? res.data : [];
        } catch (e) { return []; }
    }

    static async fetchBrands(page = 1, limit = 10) {
        try {
            const req = await fetch(`${BASE_URL}/brands?page=${page}&limit=${limit}`);
            const res = await req.json();
            return res.success ? res.data : [];
        } catch (e) { return []; }
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

    static async fetchUserOrders(userId, token, page = 1) {
        try {
            const req = await fetch(`${BASE_URL}/orders/orderByUserId/${userId}?page=${page}&limit=10`, {
                headers: { 'Authorization': `Bearer ${token}` },
                credentials: 'include'
            });
            const res = await req.json();
            return res.success ? res.data : [];
        } catch(e) { return []; }
    }

    // --- MOMO PAYMENT --- //
    static async initiateMomoPayment(amount, externalId, phoneNumber, token) {
        return this._post('payment/momo', { 
            amount: amount.toString(), 
            currency: "EUR", 
            externalId, 
            phoneNumber 
        }, token);
    }

    static async checkMomoStatus(referenceId, token) {
        try {
            const req = await fetch(`${BASE_URL}/payment/momo/status/${referenceId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
                credentials: 'include'
            });
            return await req.json();
        } catch(e) { return null; }
    }

    // --- PAYSTACK PAYMENT --- //
    static async verifyPaystackPayment(reference, token) {
        return this._post('payment/paystack/verify', { reference }, token);
    }

    // --- PRODUCT RATINGS --- //
    static async rateProduct(productId, rating, review, token) {
        return this._post('products/rate', { productId, rating, review }, token);
    }

    static async fetchProductById(productId) {
        try {
            const req = await fetch(`${BASE_URL}/products/${productId}`);
            const res = await req.json();
            return res.success ? res.data : null;
        } catch(e) { return null; }
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
