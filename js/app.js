document.addEventListener('DOMContentLoaded', () => {
    // initApp() is async and was called bare, so anything it threw became an
    // unhandled rejection: silent in production, and with no sign of which
    // step gave up. The rest of the boot must still run either way.
    initApp().catch(err => console.error('Glomek failed to start:', err));
    setupAccessibility();
    setupOfflineDetection();
});

let state = {
    products: [],
    categories: [],
    subCategories: [],
    brands: [],
    selectedCategoryId: null,
    posters: [],
    recommendations: [],
    cart: [],
    searchKeyword: '',
    currentPage: 1,
    isLoading: false,
    hasMore: true,
    allProducts: [],
    initialLoadComplete: false,
    totalResults: 0,
    // Set when the API ignores categoryId, so the browser narrows instead.
    serverFilterUnavailable: false,
    selectedSubCategoryId: null,
    sortBy: 'featured',
    priceMin: null,
    priceMax: null,
    wishlist: JSON.parse(localStorage.getItem('glomek_wishlist') || '[]'),
    recentlyViewed: JSON.parse(localStorage.getItem('glomek_recently_viewed') || '[]')
};

// ====== UTILS ====== //
// Shown when a product image 404s or the network drops mid-load, so the grid
// never collapses into broken-image icons. Inline so it always resolves.
window.FALLBACK_IMAGE = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
        <rect width="200" height="200" fill="#f0f2f2"/>
        <path d="M60 130h80L118 96l-18 24-12-14z" fill="#c7cdcd"/>
        <circle cx="78" cy="76" r="10" fill="#c7cdcd"/>
    </svg>`.replace(/\s+/g, ' ')
);

// Results per page. Keeping this modest matters for more than tidiness: with
// infinite scroll the grid grew without bound, so after a few pages the browser
// was laying out and painting hundreds of image cards on every frame and the
// scroll got progressively worse. A page is a fixed, bounded amount of DOM.
const PAGE_SIZE = 40;

/**
 * A "listing" is any narrowed set of results — a search, a category, or a
 * sub-category. Listings are presented the way a marketplace presents them:
 * a results header and numbered pages, rather than an endless feed. Only the
 * unfiltered homepage keeps its infinite scroll.
 */
function isListingView() {
    return !!(
        (state.searchKeyword && state.searchKeyword.trim()) ||
        state.selectedCategoryId ||
        state.selectedSubCategoryId
    );
}

/**
 * Everything is paginated — homepage browsing included, the way a marketplace
 * catalogue works. That keeps the DOM to one page of cards instead of letting
 * it grow until scrolling degrades.
 *
 * The one exception: if the API ignored `categoryId` we are narrowing in the
 * browser, so `total` describes the whole catalogue and page numbers built
 * from it would be a lie. That case keeps infinite scroll until the API
 * change is deployed.
 */
function isPaginatedView() {
    if (state.serverFilterUnavailable && !state.searchKeyword) return false;
    return true;
}

/* ── Listing state lives in the URL ──────────────────────────────────────
   Jumia's results are a real address: /catalog/?q=food&page=2. That is what
   makes them feel solid — refreshing keeps you on the same page of results,
   the browser Back button steps back through them, and a link can be shared.
   Holding all of it in memory instead loses the lot on reload. */

function listingUrl() {
    const p = new URLSearchParams();
    if (state.searchKeyword) p.set('q', state.searchKeyword);
    if (state.selectedCategoryId) p.set('cat', state.selectedCategoryId);
    if (state.selectedSubCategoryId) p.set('sub', state.selectedSubCategoryId);
    if (state.currentPage > 1) p.set('page', String(state.currentPage));

    // A shared ?product= that has not been opened yet has to survive this.
    // The query is rebuilt from q/cat/sub/page alone, so any other parameter
    // was silently dropped the first time a listing synced — which on this
    // page happens during the very first load. The id vanished from the
    // address bar mid-boot, and a refresh could no longer retry it.
    // openSharedProductLink() removes it itself once the sheet is actually up.
    const pendingProduct = new URLSearchParams(window.location.search).get('product');
    if (pendingProduct) p.set('product', pendingProduct);

    const qs = p.toString();
    return window.location.pathname + (qs ? `?${qs}` : '');
}

// Set while a load is being driven *by* the history (Back/Forward), so that
// restoring a listing never writes a fresh entry back into the history.
let suppressUrlSync = false;

function syncListingUrl() {
    if (suppressUrlSync) return;
    const next = listingUrl();
    if (next === window.location.pathname + window.location.search) return;
    try {
        history.pushState({ glomekListing: true }, '', next);
    } catch { /* history unavailable */ }
}

/** Restores search / category / page from the address bar. */
function applyListingFromUrl() {
    const p = new URLSearchParams(window.location.search);
    state.searchKeyword = p.get('q') || '';
    state.selectedCategoryId = p.get('cat') || null;
    state.selectedSubCategoryId = p.get('sub') || null;
    state.currentPage = Math.max(1, parseInt(p.get('page'), 10) || 1);

    if (UI.searchInput) UI.searchInput.value = state.searchKeyword;
    if (UI.clearSearchBtn) UI.clearSearchBtn.hidden = !state.searchKeyword;
}
window.applyListingFromUrl = applyListingFromUrl;

/** What the results header should call the current listing. */
function currentListingLabel() {
    const term = (state.searchKeyword || '').trim();
    if (term) return { label: 'Results for', title: `"${term}"` };

    if (state.selectedSubCategoryId) {
        const sub = (state.subCategories || []).find(s => s._id === state.selectedSubCategoryId);
        if (sub) return { label: 'Browsing', title: sub.name };
    }
    if (state.selectedCategoryId) {
        const cat = (state.categories || []).find(c => c._id === state.selectedCategoryId);
        if (cat) return { label: 'Browsing', title: cat.name };
    }
    return null;
}

/** localStorage can hold anything; a bad entry must not kill the script. */
function readStoredUser() {
    try { return JSON.parse(localStorage.getItem('glomek_user') || 'null'); }
    catch { return null; }
}

function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    return unsafe
         .toString()
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

// Google Client ID — replace with your Web OAuth Client ID from Google Cloud Console
const GOOGLE_CLIENT_ID = '838499932642-cefp9vil64rradgm25erogct7cqcu1j3.apps.googleusercontent.com';

const UI = {
    posterContainer: document.getElementById('posterContainer'),
    categoryList: document.getElementById('categoryList'),
    subcategoryList: document.getElementById('subcategoryList'),
    productGrid: document.getElementById('productGrid'),
    searchInput: document.getElementById('searchInput'),
    clearSearchBtn: document.getElementById('clearSearchBtn'),
    productSectionTitle: document.getElementById('productSectionTitle'),
    emptyState: document.getElementById('emptyState'),
    emptyMessage: document.getElementById('emptyMessage'),
    loadingMore: document.getElementById('loadingMore'),
    cartBadge: document.getElementById('cartBadge'),
    pdCartBadge: document.getElementById('pdCartBadge'),
    cartOverlay: document.getElementById('cartOverlay'),
    cartSidebar: document.getElementById('cartSidebar'),
    cartItemsContainer: document.getElementById('cartItems'),
    cartTotal: document.getElementById('cartTotal'),
    cartToggleBtn: document.getElementById('cartToggleBtn'),
    closeCartBtn: document.getElementById('closeCartBtn'),
    checkoutBtn: document.getElementById('checkoutBtn'),
};

// ===== SEARCH LOADING INDICATOR ===== //
function showSearchLoading() {
    const searchBar = document.querySelector('.search-bar-wrapper');
    const searchBtn = document.querySelector('.search-submit-btn');
    const progressBar = document.getElementById('searchProgressBar');
    if (searchBar) searchBar.classList.add('searching');
    if (searchBtn) {
        searchBtn.classList.add('loading');
        searchBtn.setAttribute('data-original-text', searchBtn.textContent);
    }
    if (progressBar) progressBar.classList.add('active');
}

function hideSearchLoading() {
    const searchBar = document.querySelector('.search-bar-wrapper');
    const searchBtn = document.querySelector('.search-submit-btn');
    const progressBar = document.getElementById('searchProgressBar');
    if (searchBar) searchBar.classList.remove('searching');
    if (searchBtn) {
        searchBtn.classList.remove('loading');
        const originalText = searchBtn.getAttribute('data-original-text');
        if (originalText) searchBtn.textContent = originalText;
    }
    if (progressBar) progressBar.classList.remove('active');
}

// ===== TOAST NOTIFICATION SYSTEM ===== //
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) { alert(message); return; }

    const iconMap = { success: 'check_circle', error: 'error', info: 'info', warning: 'warning' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="material-symbols-rounded toast-icon">${iconMap[type] || 'info'}</span>
        <span class="toast-msg">${escapeHtml(message)}</span>
        <button class="toast-close" onclick="this.parentElement.classList.add('removing'); setTimeout(()=>this.parentElement.remove(), 350)">
            <span class="material-symbols-rounded">close</span>
        </button>
    `;
    container.appendChild(toast);
    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.add('removing');
            setTimeout(() => toast.remove(), 350);
        }
    }, 4500);
}

/**
 * The product id from a shared link, read once while the script parses.
 *
 * Read here rather than later because everything that follows can rewrite the
 * address bar — syncListingUrl() rebuilds it from q/cat/sub/page alone and
 * would drop ?product= on the way past.
 */
const SHARED_PRODUCT_ID = (() => {
    try { return new URLSearchParams(window.location.search).get('product'); }
    catch { return null; }
})();

async function initApp() {
    setupEventListeners();
    // Read ?q= / ?cat= / ?page= before the first fetch, so a shared or
    // refreshed link lands on exactly the results it describes.
    applyListingFromUrl();

    // A shared product link is the only reason this visitor is here, so it is
    // opened FIRST and independently of everything else.
    //
    // It used to be the last statement in this function, behind
    // `await loadInitialData()`. That made it hostage to the entire homepage
    // loading first: any throw in categories, posters, brands or the product
    // grid meant initApp() rejected and this line was simply never reached —
    // the visitor landed on the homepage with no product and no error. A
    // phone on mobile data hits that far more often than a desktop on wifi,
    // which is exactly the difference reported: the link opens on desktop and
    // just shows the site on a phone.
    //
    // Nothing here needs the catalogue: openProductDetails() falls back to
    // fetching the one product by id, which is the right data anyway.
    const sharedProduct = openSharedProductLink();

    await loadInitialData();
    // The Google button is deliberately NOT rendered here — the auth modal is
    // still [hidden] at this point and Google cannot size a button into a box
    // that measures 0x0. openModal() draws it instead.
    // Finish any order the customer left mid-payment on Paystack's hosted page,
    // then re-attempt anything that was paid for but never saved.
    resumePendingPayment()
        .catch(err => console.error('Resuming pending payment failed:', err))
        .then(retryParkedOrders)
        .then(preferCookieAuth);

    await sharedProduct;
}

/**
 * Opens the product behind a shared ?product=<id> link.
 *
 * The address is only cleaned once the sheet is actually up. It used to be
 * cleaned first, which threw the id away before it had been used — so if the
 * fetch failed (a phone losing its connection mid-request), the id was gone
 * and even a refresh could not recover it. Now a failed open leaves the link
 * intact and pulling to refresh tries again.
 */
async function openSharedProductLink() {
    const id = SHARED_PRODUCT_ID;
    if (!id) return;

    let opened = false;
    try {
        opened = await openProductDetails(id);
    } catch (err) {
        console.error('Could not open shared product ' + id + ':', err);
    }

    if (!opened) return; // keep ?product= so a refresh retries

    // Clean the URL so a refresh does not reopen the sheet.
    const clean = window.location.pathname + window.location.hash;
    try { history.replaceState(null, '', clean); } catch { /* history unavailable */ }
}

/**
 * Resolves once Google Identity Services has actually parsed.
 *
 * The GSI tag is <script async defer>, so window.google is not there on a
 * predictable tick — it lost the race against initApp() on any connection
 * where the Google CDN was slower than our own JSON, and the code then took
 * the "no Google available" branch and never looked again.
 */
function whenGoogleReady(timeoutMs = 8000) {
    return new Promise((resolve) => {
        const ready = () => !!(window.google && window.google.accounts && window.google.accounts.id);
        if (ready()) return resolve(true);

        const started = Date.now();
        const timer = setInterval(() => {
            if (ready()) { clearInterval(timer); resolve(true); }
            else if (Date.now() - started > timeoutMs) { clearInterval(timer); resolve(false); }
        }, 100);
    });
}

// Rendered once per page load. `pending` covers the window between asking
// Google to draw the button and finding out whether it did — without it, a
// customer who closes and reopens the modal inside three seconds starts a
// second render into the same container.
let googleButtonRendered = false;
let googleButtonPending = false;

/**
 * Draws the real Google Sign-In button into the auth modal.
 *
 * This must run while the modal is OPEN, which is why openModal() calls it and
 * initApp() no longer does. Google renders the button into an iframe and sizes
 * it from the container's box; #googleSignInBtnContainer lives inside
 * #authModal, which carries [hidden] until the customer asks to log in. Called
 * at page load it therefore measured 0x0 — so the "did the button render?"
 * check (container.offsetHeight === 0) was true every single time, and after
 * 2.5s the working Google button was thrown away and replaced by the fallback.
 * That is what "sign in with Google stopped working" looked like from outside.
 */
async function renderGoogleButton() {
    const container = document.getElementById("googleSignInBtnContainer");
    if (!container || googleButtonRendered || googleButtonPending) return;
    googleButtonPending = true;

    if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.startsWith('YOUR_')) {
        return renderGoogleUnavailable(container, 'no Client ID is configured');
    }

    // A modest placeholder so the modal does not jump when the button lands.
    container.style.minHeight = '44px';

    const available = await whenGoogleReady();
    if (!available) {
        return renderGoogleUnavailable(container, 'the Google script did not load');
    }

    try {
        window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleGoogleCredentialResponse,
            auto_select: false,
            cancel_on_tap_outside: true,
            // Chrome is removing third-party cookies, which is what the old
            // GSI iframe relied on. FedCM is the supported path now.
            use_fedcm_for_prompt: true,
            itp_support: true
        });

        // Google reads the width off the container, which is only measurable
        // now that the modal is open. Cap it at Google's 400px maximum.
        const width = Math.min(400, Math.max(200, Math.round(container.getBoundingClientRect().width) || 320));

        window.google.accounts.id.renderButton(container, {
            theme: 'outline',
            size: 'large',
            type: 'standard',
            shape: 'rectangular',
            text: 'signin_with',
            logo_alignment: 'left',
            width
        });
    } catch (err) {
        console.error('GLOMEK: google.accounts.id failed to initialise.', err);
        return renderGoogleUnavailable(container, 'Google rejected this client');
    }

    // Only now — with the modal open and the container measurable — is a zero
    // height real. It means the origin is missing from the OAuth client's
    // authorised list, which is a configuration problem, not a runtime one.
    setTimeout(() => {
        googleButtonPending = false;

        // If the customer closed the modal in the meantime the container is
        // display:none again and measures 0 — which is exactly the mistake
        // this whole function exists to avoid. Leave the button alone and let
        // the next open re-check it.
        const modal = document.getElementById('authModal');
        if (modal && modal.hidden) return;

        if (container.childElementCount === 0 || container.offsetHeight === 0) {
            console.warn(
                'GLOMEK: the Google button did not render. Add "' + window.location.origin +
                '" to Authorised JavaScript origins for OAuth client ' + GOOGLE_CLIENT_ID +
                ' in Google Cloud Console.'
            );
            renderGoogleUnavailable(container, 'this site is not an authorised origin for the OAuth client');
        } else {
            googleButtonRendered = true;
        }
    }, 3000);
}

/**
 * What the modal shows when Google genuinely cannot be offered.
 *
 * This used to be a button that called prompt() for an email address and
 * logged the visitor in as whoever they typed. That is not a fallback for
 * Google Sign-In — it is a way to sign in as any customer on the site by
 * knowing their email, so it is gone. Email and password are right above it.
 */
function renderGoogleUnavailable(container, reason) {
    googleButtonPending = false;
    console.warn('GLOMEK: Google Sign-In unavailable — ' + reason + '.');
    container.innerHTML = `
        <p class="google-unavailable" role="status">
            <span class="material-symbols-rounded">info</span>
            Google Sign-In isn't available right now. Please use your email and
            password above.
        </p>
    `;
}

async function handleGoogleCredentialResponse(response) {
    if (!response || !response.credential) return;
    // `credential` IS Google's signed ID token. It used to be unpacked here
    // and only the email posted onward, which meant the server was trusting a
    // browser's word about who was signing in. Send the token itself and let
    // the server verify Google's signature.
    await performGoogleLogin(response.credential);
}

async function performGoogleLogin(idToken) {
    const btn = document.getElementById('authSubmitBtn');
    if (btn) { btn.textContent = "Please wait..."; btn.disabled = true; }
    try {
        const res = await ApiService.googleLogin(idToken);
        if (res && res.success) {
            currentUser = res.data;
            if (res.token) setUserToken(res.token);
            localStorage.setItem('glomek_user', JSON.stringify(currentUser));
            closeModal('authModal');
            updateUserUI();
            preferCookieAuth();
            showToast("Google login successful!", "success");

            // Recommendations are a nicety. They used to sit inside the same
            // try block, so a hiccup fetching them told a customer who was
            // already signed in that their login had failed.
            try {
                state.recommendations = await ApiService.fetchRecommendations(currentUser._id);
            } catch { /* the session is valid either way */ }
        } else {
            showToast((res && res.message) || "Google Login failed.", "error");
        }
    } catch (err) {
        console.error('Google login error:', err);
        showToast("Unable to complete Google Auth.", "error");
    }
    if (btn) { btn.textContent = "Login"; btn.disabled = false; }
}

function setupEventListeners() {
    // ========== AMAZON-STYLE SEARCH (no search-on-type) ========== //
    const suggestionsBox = document.getElementById('searchSuggestions');
    let suggestionIndex = -1; // keyboard nav index
    let suggestionsVisible = false;

    // Load search history from localStorage
    function getSearchHistory() {
        try {
            return JSON.parse(localStorage.getItem('glomek_search_history') || '[]');
        } catch { return []; }
    }

    function saveSearchHistory(term) {
        if (!term || term.length < 2) return;
        let history = getSearchHistory();
        // Remove duplicates (case-insensitive)
        history = history.filter(h => h.toLowerCase() !== term.toLowerCase());
        history.unshift(term); // newest first
        if (history.length > 10) history = history.slice(0, 10);
        localStorage.setItem('glomek_search_history', JSON.stringify(history));
    }

    function removeSearchHistoryItem(term) {
        let history = getSearchHistory();
        history = history.filter(h => h.toLowerCase() !== term.toLowerCase());
        localStorage.setItem('glomek_search_history', JSON.stringify(history));
    }

    // Build suggestions from history + local product/category data
    function buildSuggestions(query) {
        const suggestions = [];
        const q = query.toLowerCase().trim();
        const history = getSearchHistory();

        // 1) Search history matches
        const historyMatches = q.length === 0
            ? history.slice(0, 6)
            : history.filter(h => h.toLowerCase().includes(q)).slice(0, 4);

        historyMatches.forEach(h => {
            suggestions.push({ type: 'history', text: h, icon: 'history' });
        });

        // 2) Category matches. Categories are navigation, not catalogue — the
        //    same handful of names is already printed on the home page, so
        //    offering them here gives nothing away about the product database.
        if (q.length >= 2) {
            state.categories.forEach(cat => {
                if (cat.name && cat.name.toLowerCase().includes(q) && suggestions.length < 10) {
                    // Avoid duplicates
                    if (!suggestions.some(s => s.text.toLowerCase() === cat.name.toLowerCase())) {
                        suggestions.push({ type: 'category', text: cat.name, icon: 'category', category: 'in Categories' });
                    }
                }
            });
        }

        // Deliberately no product suggestions. Typing must not turn the search
        // box into a live window onto the catalogue: "Sam" used to list
        // "Samsung Galaxy A51 SM-A515 16.5", which reads product names straight
        // out of the database before the customer has asked for anything.
        // Jumia works the other way round — you type, you press search, and the
        // results page is the first thing that names a product. So does this.
        return suggestions;
    }

    // Render suggestions dropdown
    function showSuggestions(query) {
        const suggestions = buildSuggestions(query);
        if (suggestions.length === 0) {
            hideSuggestions();
            return;
        }

        suggestionIndex = -1;
        const q = query.toLowerCase().trim();

        let html = '';
        let lastType = '';

        suggestions.forEach((s, idx) => {
            // Section dividers
            if (s.type !== lastType) {
                if (s.type === 'history' && q.length === 0) {
                    html += `<div class="search-suggestions-divider">Recent Searches</div>`;
                } else if (s.type === 'category') {
                    html += `<div class="search-suggestions-divider">Categories</div>`;
                }
                lastType = s.type;
            }

            // Highlight matching text
            let displayText = escapeHtml(s.text);
            if (q.length > 0) {
                const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
                displayText = displayText.replace(regex, '<strong>$1</strong>');
            }

            const deleteBtn = s.type === 'history'
                ? `<span class="suggestion-fill" onclick="event.stopPropagation(); window._removeSearchHistory('${escapeHtml(s.text)}', ${idx})" title="Remove"><span class="material-symbols-rounded" style="font-size:16px;">close</span></span>`
                : `<span class="suggestion-fill"><span class="material-symbols-rounded" style="font-size:16px;">north_west</span></span>`;

            html += `
                <div class="search-suggestion-item" data-index="${idx}" data-text="${escapeHtml(s.text)}"
                     onclick="window._selectSuggestion('${escapeHtml(s.text)}')">
                    <span class="suggestion-icon material-symbols-rounded">${s.icon}</span>
                    <span class="suggestion-text">${displayText}</span>
                    ${s.category ? `<span class="suggestion-category">${escapeHtml(s.category)}</span>` : ''}
                    ${deleteBtn}
                </div>
            `;
        });

        suggestionsBox.innerHTML = html;
        suggestionsBox.hidden = false;
        suggestionsVisible = true;
    }

    function hideSuggestions() {
        if (suggestionsBox) {
            suggestionsBox.hidden = true;
            suggestionsBox.innerHTML = '';
        }
        suggestionsVisible = false;
        suggestionIndex = -1;
    }

    // Perform the actual search
    function performSearch(keyword) {
        const term = (keyword || '').trim();
        if (term.length > 0) {
            saveSearchHistory(term);
        }
        hideSuggestions();
        state.searchKeyword = term;
        state.currentPage = 1;
        UI.searchInput.value = term;
        UI.clearSearchBtn.hidden = term.length === 0;
        loadProducts();
        UI.searchInput.blur();
    }

    // Global handlers for onclick in suggestion HTML
    window._selectSuggestion = function (text) {
        performSearch(text);
    };

    window._removeSearchHistory = function (text, idx) {
        removeSearchHistoryItem(text);
        // Re-render suggestions
        showSuggestions(UI.searchInput.value.trim());
    };

    // INPUT: Show/hide clear button + show suggestions (NO search on type)
    UI.searchInput.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        UI.clearSearchBtn.hidden = val.length === 0;
        // Show suggestions dropdown (lightweight, no API calls)
        showSuggestions(val);
    });

    // FOCUS: Show suggestions when focusing search input
    UI.searchInput.addEventListener('focus', () => {
        const val = UI.searchInput.value.trim();
        showSuggestions(val);
    });

    // Search submit button — performs actual search
    const searchSubmitBtn = document.getElementById('searchSubmitBtn');
    if (searchSubmitBtn) {
        searchSubmitBtn.addEventListener('click', () => {
            performSearch(UI.searchInput.value.trim());
        });
    }

    // Enter key — performs actual search
    UI.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (suggestionIndex >= 0 && suggestionsVisible) {
                // Select highlighted suggestion
                const items = suggestionsBox.querySelectorAll('.search-suggestion-item');
                if (items[suggestionIndex]) {
                    const text = items[suggestionIndex].getAttribute('data-text');
                    performSearch(text);
                }
            } else {
                performSearch(UI.searchInput.value.trim());
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (suggestionsVisible) {
                const items = suggestionsBox.querySelectorAll('.search-suggestion-item');
                items.forEach(i => i.classList.remove('active'));
                suggestionIndex = (suggestionIndex + 1) % items.length;
                items[suggestionIndex].classList.add('active');
                items[suggestionIndex].scrollIntoView({ block: 'nearest' });
                // Fill input with suggestion text
                UI.searchInput.value = items[suggestionIndex].getAttribute('data-text');
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (suggestionsVisible) {
                const items = suggestionsBox.querySelectorAll('.search-suggestion-item');
                items.forEach(i => i.classList.remove('active'));
                suggestionIndex = (suggestionIndex - 1 + items.length) % items.length;
                items[suggestionIndex].classList.add('active');
                items[suggestionIndex].scrollIntoView({ block: 'nearest' });
                UI.searchInput.value = items[suggestionIndex].getAttribute('data-text');
            }
        } else if (e.key === 'Escape') {
            hideSuggestions();
        }
    });

    // Close suggestions when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) {
            hideSuggestions();
        }
    });

    UI.clearSearchBtn.addEventListener('click', () => {
        UI.searchInput.value = '';
        UI.clearSearchBtn.hidden = true;
        hideSuggestions();
        state.searchKeyword = '';
        state.currentPage = 1;
        loadProducts();
    });

    // Cart Sidebar Interactions
    UI.cartToggleBtn.addEventListener('click', () => toggleCart(true));
    UI.closeCartBtn.addEventListener('click', () => toggleCart(false));
    UI.cartOverlay.addEventListener('click', () => toggleCart(false));

    // Wishlist Sidebar Interactions
    const wishlistToggleBtn = document.getElementById('wishlistToggleBtn');
    const closeWishlistBtn = document.getElementById('closeWishlistBtn');
    if (wishlistToggleBtn) wishlistToggleBtn.addEventListener('click', () => toggleWishlist(true));
    if (closeWishlistBtn) closeWishlistBtn.addEventListener('click', () => toggleWishlist(false));
    UI.cartOverlay.addEventListener('click', () => toggleWishlist(false));

    // ── Infinite scroll ─────────────────────────────────────────────────
    // Driven by IntersectionObserver watching the loader at the end of the
    // grid. The old version ran on every scroll event and read
    // document.body.offsetHeight, which forces a synchronous layout — dozens
    // of full reflows a second while scrolling, which is what made it stutter.
    // The observer costs nothing until the sentinel actually comes into view.
    const sentinel = document.getElementById('scrollSentinel');
    if (sentinel && 'IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
            if (!entries[0].isIntersecting) return;

            // An observer always delivers one callback for a newly observed
            // target, and it arrives while the very first page is still being
            // fetched — with an empty grid the sentinel is on screen. That
            // advanced currentPage to 2 and ran a *pagination* load before any
            // full load had happened, which then made the real first load a
            // no-op. Result: an empty grid and nothing to scroll.
            // Never paginate until a full load has actually completed.
            if (!state.initialLoadComplete) return;
            // Search results use numbered pages. Auto-appending underneath a
            // paginator would fight it and make the page numbers meaningless.
            if (isPaginatedView()) return;
            if (state.isLoading || !state.hasMore) return;
            if (!state.products || state.products.length === 0) return;

            state.currentPage++;
            loadProducts(true);
        }, { rootMargin: '600px 0px' }); // start fetching before it is reached
        io.observe(sentinel);
    }

    // ── Back-to-top button ──────────────────────────────────────────────
    // Passive + rAF-throttled, and the class is only touched when the state
    // actually flips, so scrolling never triggers a needless style recalc.
    const fab = document.getElementById('backToTopFab');
    if (fab) {
        let fabTicking = false;
        let fabVisible = false;
        window.addEventListener('scroll', () => {
            if (fabTicking) return;
            fabTicking = true;
            requestAnimationFrame(() => {
                const shouldShow = window.scrollY > 600;
                if (shouldShow !== fabVisible) {
                    fabVisible = shouldShow;
                    fab.classList.toggle('visible', shouldShow);
                }
                fabTicking = false;
            });
        }, { passive: true });
    }

    const savedCart = localStorage.getItem('glomek_cart');
    if (savedCart) {
        state.cart = JSON.parse(savedCart);
        updateCartUI();
    }
    updateWishlistBadge();
    renderRecentlyViewed();
    updatePageTitle();
    
    setupPdImageSwipe();
}

async function loadInitialData() {
    renderShimmerCategory();
    renderShimmerGrid();

    const [categories, subCats, posters, brands] = await Promise.all([
        ApiService.fetchCategories(),
        ApiService.fetchSubCategories ? ApiService.fetchSubCategories() : [],
        ApiService.fetchPosters(),
        ApiService.fetchBrands ? ApiService.fetchBrands(1, 50) : []
    ]);

    state.categories = categories;
    state.subCategories = subCats;
    state.posters = posters;
    state.brands = brands;
    state.allProducts = [];

    renderCategories();
    renderPosters();
    await loadProducts();
}

/**
 * Wrapper that guarantees the in-flight flag is always cleared.
 *
 * Previously `state.isLoading = true` was set here and cleared at each exit
 * point. Any exception in between left it stuck true, and because the very
 * first line is `if (state.isLoading) return`, every later load became a
 * silent no-op — the grid just sat at "Showing 0 products" forever. A single
 * `finally` makes that failure mode impossible.
 */
async function loadProducts(isPagination = false) {
    if (state.isLoading) return;
    state.isLoading = true;
    try {
        await loadProductsInner(isPagination);
    } catch (err) {
        console.error('Product load failed:', err);
        showNetworkError();
    } finally {
        state.isLoading = false;
        state.initialLoadComplete = true;
        hideSearchLoading();
    }
}

async function loadProductsInner(isPagination = false) {
    showSearchLoading();

    if (!isPagination) {
        state.products = [];
        renderShimmerGrid();
        UI.productSectionTitle.textContent = state.searchKeyword ? `Search Results for "${state.searchKeyword}"` : "Featured Products";
        UI.emptyState.hidden = true;
        UI.productGrid.hidden = false;

        // Hide hero/posters and category nav when searching (Amazon-style)
        const heroWrapper = document.querySelector('.hero-wrapper');
        const categoryNavWrapper = document.querySelector('.category-nav-wrapper');
        const recentlyViewed = document.getElementById('recentlyViewedSection');
        if (state.searchKeyword) {
            if (heroWrapper) heroWrapper.style.display = 'none';
            if (categoryNavWrapper) categoryNavWrapper.style.display = 'none';
            if (recentlyViewed) recentlyViewed.style.display = 'none';
        } else {
            if (heroWrapper) heroWrapper.style.display = '';
            if (categoryNavWrapper) categoryNavWrapper.style.display = '';
            if (recentlyViewed) recentlyViewed.style.display = '';
        }
        // .main-content is pulled up 120px to tuck under the hero. With the
        // hero gone that margin drags the breadcrumb under the header, over
        // the search box — so the layout needs to know the hero is absent.
        document.body.classList.toggle('hero-hidden', !!state.searchKeyword);

        const oldRecs = document.getElementById('recsGrid');
        if (oldRecs) oldRecs.remove();
        const oldTitle = document.querySelector('.recommendations-title');
        if (oldTitle) oldTitle.style.display = 'none';
    } else {
        UI.loadingMore.hidden = false;
    }

    // Category and sub-category are filtered by the server so that `total` —
    // and therefore the page numbers — describe the actual listing.
    const pageResult = await ApiService.fetchProducts(
        state.currentPage,
        PAGE_SIZE,
        state.searchKeyword,
        state.searchKeyword ? '' : (state.selectedCategoryId || ''),
        state.searchKeyword ? '' : (state.selectedSubCategoryId || '')
    );
    const fetchedProducts = pageResult.items;
    state.totalResults = pageResult.total;

    // Network error check — show retry UI if offline and no results
    if (!fetchedProducts || (fetchedProducts.length === 0 && !navigator.onLine)) {
        showNetworkError();
        state.isLoading = false;
        hideSearchLoading();
        return;
    }

    if (isPagination) {
        // `allProducts` starts undefined, so spreading it before any full load
        // has run throws and (previously) wedged isLoading true for good.
        state.allProducts = [...(state.allProducts || []), ...fetchedProducts];
    } else {
        state.allProducts = fetchedProducts;
    }

    let filteredList = state.allProducts;

    // ── Does this API actually honour categoryId? ───────────────────────
    // The server-side filter is a recent addition. Until it is deployed the
    // live API ignores the parameter and returns the whole catalogue — and if
    // the client trusted it, picking a category would silently show everything.
    // Detect it from the response and fall back rather than break.
    if (state.selectedCategoryId && !state.searchKeyword && fetchedProducts.length) {
        const catIdOf = (p) => {
            const c = p.proCategoryId;
            return c && typeof c === 'object' ? c._id : c;
        };
        // Only products that actually carry a category can answer the question.
        // If none do, we cannot tell — and must not assume failure, or the
        // browser filter would discard every result.
        const answerable = fetchedProducts.filter(p => !!catIdOf(p));
        if (answerable.length) {
            state.serverFilterUnavailable =
                !answerable.every(p => catIdOf(p) === state.selectedCategoryId);
        }
    } else if (!state.selectedCategoryId) {
        state.serverFilterUnavailable = false;
    }

    // Narrow in the browser when the query is doing the server-side work (a
    // refine chip during a search), or when the server did not filter for us.
    const narrowHere = !!state.searchKeyword || state.serverFilterUnavailable;

    if (state.selectedCategoryId && narrowHere) {
        const cat = state.categories.find(c => c._id === state.selectedCategoryId);
        if (cat) {
            filteredList = filteredList.filter(p => p.proCategoryId && (p.proCategoryId.name === cat.name || p.proCategoryId._id === cat._id));
        }
    }

    if (state.selectedSubCategoryId && narrowHere) {
        const subCat = state.subCategories.find(s => s._id === state.selectedSubCategoryId);
        if (subCat) {
            filteredList = filteredList.filter(p => p.proSubCategoryId && (p.proSubCategoryId.name === subCat.name || p.proSubCategoryId._id === subCat._id));
        }
    }

    // Apply price range filter
    if (state.priceMin !== null) {
        filteredList = filteredList.filter(p => (p.offerPrice || p.price || 0) >= state.priceMin);
    }
    if (state.priceMax !== null) {
        filteredList = filteredList.filter(p => (p.offerPrice || p.price || 0) <= state.priceMax);
    }

    // Apply sorting
    filteredList = applySorting(filteredList, state.sortBy);

    state.products = filteredList;
    // Against PAGE_SIZE, not a hardcoded 50. PAGE_SIZE is 40, so a full page
    // returns 40 and "40 >= 50" was false every single time — hasMore was
    // stuck false after the first load. Pagination hid it, because the
    // numbered pages do not consult hasMore; the infinite-scroll fallback
    // does, and that path (used when the server cannot filter by category)
    // could never load a second page.
    state.hasMore = fetchedProducts.length >= PAGE_SIZE && (state.currentPage * PAGE_SIZE) < (state.totalResults || 0);

    // Update product count text
    updateProductCount();
    // Update breadcrumbs
    updateBreadcrumbs();
    // Search results get their own header, refine chips and sticky controls
    renderSearchResultsHead();
    renderPagination();
    // Reflect the listing in the address bar so refresh and Back both work.
    if (!isPagination) syncListingUrl();

    if (state.products.length === 0 && !isPagination) {
        await showEmptySearchState();
    } else {
        UI.productGrid.hidden = false;
        UI.productSectionTitle.style.display = 'block';
        renderProducts();
    }

    UI.loadingMore.hidden = true;
    state.isLoading = false;
    hideSearchLoading();

    // A search is a new page of results, so it starts at the top — the way
    // every marketplace behaves. The old code smooth-scrolled the page *down*
    // to the grid after each search, which yanked the view away from the
    // customer and hid the results header they had just triggered.
    if (state.searchKeyword && !isPagination) {
        window.scrollTo({ top: 0, behavior: 'auto' });
    }

    // Update page title with context
    updatePageTitle();
}

/**
 * Numbered pagination for search results.
 *
 * Builds a window of pages around the current one with ellipses, plus prev and
 * next arrows, e.g.  ‹ 1 … 4 [5] 6 … 12 ›
 */
function paginationWindow(current, totalPages) {
    if (totalPages <= 7) {
        return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const pages = new Set([1, totalPages, current]);
    if (current - 1 > 1) pages.add(current - 1);
    if (current + 1 < totalPages) pages.add(current + 1);
    // Keep the row a stable width near the ends.
    if (current <= 3) { pages.add(2); pages.add(3); pages.add(4); }
    if (current >= totalPages - 2) {
        pages.add(totalPages - 1); pages.add(totalPages - 2); pages.add(totalPages - 3);
    }

    const sorted = [...pages].filter(p => p >= 1 && p <= totalPages).sort((a, b) => a - b);

    const out = [];
    let previous = 0;
    for (const p of sorted) {
        if (previous && p - previous > 1) out.push('…');
        out.push(p);
        previous = p;
    }
    return out;
}

function renderPagination() {
    const nav = document.getElementById('pagination');
    if (!nav) return;

    const totalPages = Math.max(1, Math.ceil((state.totalResults || 0) / PAGE_SIZE));

    // A paginator only where the numbers are honest, and only when there is
    // more than one page to move between.
    if (!isPaginatedView() || totalPages <= 1) {
        nav.hidden = true;
        nav.innerHTML = '';
        return;
    }

    const current = Math.min(state.currentPage, totalPages);
    const items = paginationWindow(current, totalPages);

    nav.hidden = false;
    nav.innerHTML = `
        <button class="pg-btn pg-arrow" type="button" data-page="${current - 1}"
                ${current === 1 ? 'disabled' : ''} aria-label="Previous page">
            <span class="material-symbols-rounded">chevron_left</span>
        </button>
        ${items.map(p => p === '…'
        ? `<span class="pg-gap" aria-hidden="true">…</span>`
        : `<button class="pg-btn ${p === current ? 'active' : ''}" type="button" data-page="${p}"
                     ${p === current ? 'aria-current="page"' : ''}>${p}</button>`
    ).join('')}
        <button class="pg-btn pg-arrow" type="button" data-page="${current + 1}"
                ${current === totalPages ? 'disabled' : ''} aria-label="Next page">
            <span class="material-symbols-rounded">chevron_right</span>
        </button>
    `;

    nav.querySelectorAll('.pg-btn[data-page]').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = parseInt(btn.dataset.page, 10);
            if (!target || target < 1 || target > totalPages || target === current) return;
            state.currentPage = target;
            // A page change replaces the results; it never appends.
            loadProducts();
            window.scrollTo({ top: 0, behavior: 'auto' });
        });
    });
}

/**
 * Turns a search into a results *view* rather than a bare grid: the term being
 * searched, how many matches there are, a way back, and chips to narrow by the
 * categories actually present in the results.
 */
function renderSearchResultsHead() {
    const head = document.getElementById('searchResultsHead');
    if (!head) return;

    const listing = currentListingLabel();
    document.body.classList.toggle('is-searching', !!listing);

    if (!listing) {
        head.hidden = true;
        return;
    }

    head.hidden = false;

    const labelEl = document.getElementById('srhLabel');
    const termEl = document.getElementById('srhTerm');
    const countEl = document.getElementById('srhCount');
    if (labelEl) labelEl.textContent = listing.label;
    if (termEl) termEl.textContent = listing.title;
    if (countEl) {
        // Only trust `total` when the server did the filtering. Otherwise it
        // counts the whole catalogue, so report what is actually on screen.
        const trustTotal = !state.searchKeyword && !state.serverFilterUnavailable;
        const n = trustTotal ? (state.totalResults || state.products.length) : state.products.length;
        countEl.textContent = n === 1 ? '1 item' : `${n} items`;
    }

    // Refine chips: the categories represented in the current results, so the
    // customer can narrow without starting a new search.
    const chips = document.getElementById('srhChips');
    if (!chips) return;

    const counts = new Map();
    (state.products || []).forEach(p => {
        const cat = p.proCategoryId;
        if (!cat) return;
        const id = typeof cat === 'object' ? cat._id : cat;
        const name = typeof cat === 'object' ? cat.name : null;
        if (!id || !name) return;
        const entry = counts.get(id) || { id, name, n: 0 };
        entry.n++;
        counts.set(id, entry);
    });

    const list = [...counts.values()].sort((a, b) => b.n - a.n);
    if (list.length < 2) {
        chips.hidden = true;
        chips.innerHTML = '';
        return;
    }

    chips.hidden = false;
    chips.innerHTML = list.map(c => `
        <button class="srh-chip ${state.selectedCategoryId === c.id ? 'active' : ''}"
                type="button" data-cat="${escapeHtml(c.id)}">
            ${escapeHtml(c.name)} <em>${c.n}</em>
        </button>
    `).join('');

    chips.querySelectorAll('.srh-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.cat;
            // Toggle the refinement off if it is already the active one.
            state.selectedCategoryId = (state.selectedCategoryId === id) ? null : id;
            state.currentPage = 1;
            loadProducts();
        });
    });
}

/**
 * Leaves the current listing entirely, whether it came from the search box or
 * from picking a category. The breadcrumb's "Home" is the visible way back —
 * this is what it calls.
 */
window.exitListing = function exitListing() {
    if (state.searchKeyword) {
        const clear = document.getElementById('clearSearchBtn');
        if (clear) { clear.click(); window.scrollTo({ top: 0, behavior: 'auto' }); return; }
    }
    filterByCategory(null);
}

async function showEmptySearchState() {
    UI.productGrid.hidden = true;
    UI.productSectionTitle.textContent = "";
    UI.emptyMessage.textContent = `No results found for '${state.searchKeyword}'`;
    UI.emptyState.hidden = false;

    if (state.recommendations.length === 0) {
        state.recommendations = await ApiService.fetchRecommendations();
    }

    const gridHtml = state.recommendations.map(p => createProductCardHTML(p)).join('');
    const recsGrid = document.createElement('div');
    recsGrid.id = 'recsGrid';
    recsGrid.className = 'product-grid';
    recsGrid.style.marginTop = '2rem';
    recsGrid.innerHTML = gridHtml;

    UI.emptyState.appendChild(recsGrid);
    document.querySelector('.recommendations-title').style.display = 'block';
}

window.filterByCategory = async function (catId) {
    state.selectedCategoryId = catId;
    state.selectedSubCategoryId = null;
    renderCategories();

    if (catId) {
        UI.subcategoryList.hidden = false;
        const matchingSubs = state.subCategories.filter(s => s.categoryId && s.categoryId._id === catId);
        UI.subcategoryList.innerHTML = matchingSubs.length > 0 ?
            `<div class="subcategory-pill active" onclick="filterBySubCategory(null, event)">All</div>` +
            matchingSubs.map(s => `<div class="subcategory-pill" onclick="filterBySubCategory('${s._id}', event)">${escapeHtml(s.name)}</div>`).join('') :
            '<span style="color:var(--text-secondary);font-size:0.9rem;padding:0.5rem 1rem;">No subcategories found</span>';
    } else {
        UI.subcategoryList.hidden = true;
        UI.subcategoryList.innerHTML = '';
    }

    state.currentPage = 1;
    await loadProducts();

    // Picking a category is a fresh listing — start it at the top, like a
    // category page. This also removes a genuine conflict: the drawer already
    // scrolls to top on selection, and the old scrollIntoView here fired a
    // second, opposing smooth-scroll a beat later.
    window.scrollTo({ top: 0, behavior: 'auto' });
}

window.filterBySubCategory = async function (subCatId, event) {
    document.querySelectorAll('.subcategory-pill').forEach(el => el.classList.remove('active'));
    if (event && event.target) event.target.classList.add('active');

    state.selectedSubCategoryId = subCatId;
    state.currentPage = 1;
    await loadProducts();

    window.scrollTo({ top: 0, behavior: 'auto' });
}

function renderCategories() {
    UI.categoryList.innerHTML = `<div class="category-pill ${!state.selectedCategoryId ? 'active' : ''}" onclick="filterByCategory(null)">All Products</div>` +
        state.categories.map(c => `<div class="category-pill ${state.selectedCategoryId === c._id ? 'active' : ''}" onclick="filterByCategory('${c._id}')">${escapeHtml(c.name)}</div>`).join('');
    document.dispatchEvent(new CustomEvent('glomek:datachange'));
}

let currentPosterIndex = 0;
let posterInterval = null;

function renderPosters() {
    if (state.posters.length > 0) {
        let validPosters = state.posters.filter(p => p.imageUrl || (p.image && p.image.url));
        if (validPosters.length === 0) { UI.posterContainer.style.display = 'none'; return; }

        let htmlSnippet = '';
        validPosters.forEach((p, idx) => {
            let imgUrl = p.imageUrl || (p.image && p.image.url);
            const hasTarget = p.targetType && p.targetType !== 'none' && p.targetValue;
            htmlSnippet += `
                <div class="poster-slide" id="posterSlide-${idx}" style="opacity:${idx === 0 ? '1' : '0'}; z-index:${idx === 0 ? '2' : '1'};" onclick="handlePosterClick(${idx})">
                    <img src="${escapeHtml(imgUrl)}" class="poster-image" alt="${escapeHtml(p.posterName || 'Promotion')}" loading="eager" decoding="async" />
                    <div class="poster-overlay-gradient"></div>
                    <div class="poster-overlay-content">
                        ${p.posterName ? `<h2 class="poster-title">${escapeHtml(p.posterName)}</h2>` : ''}
                        ${p.discountText ? `<span class="poster-discount-tag">${escapeHtml(p.discountText)}</span>` : ''}
                        ${hasTarget ? `<button class="poster-shop-btn" onclick="handlePosterClick(${idx}); event.stopPropagation();">Shop Now</button>` : ''}
                    </div>
                </div>
            `;
        });

        htmlSnippet += `<div class="hero-gradient-overlay"></div>`;

        if (validPosters.length > 1) {
            htmlSnippet += `
                <button class="poster-carousel-btn poster-prev-btn" onclick="prevPoster(event)"><span class="material-symbols-rounded">chevron_left</span></button>
                <button class="poster-carousel-btn poster-next-btn" onclick="nextPoster(event)"><span class="material-symbols-rounded">chevron_right</span></button>
                <div class="poster-dots" id="posterDots">
                    ${validPosters.map((_, i) => `<div class="poster-dot ${i === 0 ? 'active' : ''}" onclick="setPoster(${i}, event)"></div>`).join('')}
                </div>
            `;
        }

        UI.posterContainer.innerHTML = htmlSnippet;

        // Touch swipe support
        setupPosterSwipe();

        if (validPosters.length > 1) {
            if (posterInterval) clearInterval(posterInterval);
            posterInterval = setInterval(() => { nextPoster() }, 5000);
        }
    } else {
        UI.posterContainer.style.display = 'none';
    }
}

function setupPosterSwipe() {
    let touchStartX = 0, touchEndX = 0;
    const container = UI.posterContainer;
    if (!container) return;

    container.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
        if (posterInterval) clearInterval(posterInterval);
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        const diff = touchStartX - touchEndX;
        if (Math.abs(diff) > 50) {
            if (diff > 0) nextPoster();
            else prevPoster();
        }
        // Resume autoplay after 8s
        posterInterval = setInterval(() => { nextPoster() }, 5000);
    }, { passive: true });
}

function transitionPoster(newIndex) {
    let validPosters = state.posters.filter(p => p.imageUrl || (p.image && p.image.url));
    if (validPosters.length <= 1 || newIndex === currentPosterIndex) return;
    const oldSlide = document.getElementById(`posterSlide-${currentPosterIndex}`);
    const newSlide = document.getElementById(`posterSlide-${newIndex}`);
    if (oldSlide) { oldSlide.style.opacity = '0'; oldSlide.style.zIndex = '1'; }
    if (newSlide) { newSlide.style.opacity = '1'; newSlide.style.zIndex = '2'; }
    document.querySelectorAll('#posterDots .poster-dot').forEach((d, i) => d.classList.toggle('active', i === newIndex));
    currentPosterIndex = newIndex;
}

window.nextPoster = function (e) {
    if (e) { e.preventDefault(); clearInterval(posterInterval); }
    let validPosters = state.posters.filter(p => p.imageUrl || (p.image && p.image.url));
    if (validPosters.length <= 1) return;
    transitionPoster((currentPosterIndex + 1) % validPosters.length);
}

window.prevPoster = function (e) {
    if (e) { e.preventDefault(); clearInterval(posterInterval); }
    let validPosters = state.posters.filter(p => p.imageUrl || (p.image && p.image.url));
    if (validPosters.length <= 1) return;
    transitionPoster((currentPosterIndex - 1 + validPosters.length) % validPosters.length);
}

window.setPoster = function (idx, e) {
    if (e) { e.preventDefault(); clearInterval(posterInterval); }
    transitionPoster(idx);
}

window.handlePosterClick = function (idx) {
    const validPosters = state.posters.filter(p => p.imageUrl || (p.image && p.image.url));
    const p = validPosters[idx];
    if (!p) return;
    const type = p.targetType || 'none';
    const val = p.targetValue;
    if (!val || type === 'none') return;

    if (type === 'category') {
        // Mobile sends category NAME — find the category by name
        const cat = state.categories.find(c => c.name && c.name.toLowerCase() === val.toLowerCase());
        if (cat) { filterByCategory(cat._id); }
        else {
            // Fallback: search by category name
            UI.searchInput.value = val;
            state.searchKeyword = val;
            state.currentPage = 1;
            loadProducts();
        }
    } else if (type === 'subcategory') {
        // Mobile sends subcategory NAME — find by name
        const subCat = state.subCategories.find(s => s.name && s.name.toLowerCase() === val.toLowerCase());
        if (subCat) {
            // Also select the parent category
            if (subCat.categoryId) {
                const parentCatId = typeof subCat.categoryId === 'object' ? subCat.categoryId._id : subCat.categoryId;
                state.selectedCategoryId = parentCatId;
                renderCategories();
            }
            filterBySubCategory(subCat._id);
        } else {
            UI.searchInput.value = val;
            state.searchKeyword = val;
            state.currentPage = 1;
            loadProducts();
        }
    } else if (type === 'brand' || type === 'search') {
        UI.searchInput.value = val;
        UI.clearSearchBtn.hidden = false;
        state.searchKeyword = val;
        state.currentPage = 1;
        loadProducts();
    }

    // Same rule as search and category: a new listing starts at the top.
    window.scrollTo({ top: 0, behavior: 'auto' });
}

function renderProducts() {
    UI.productGrid.innerHTML = state.products.map(p => createProductCardHTML(p)).join('');
    // Lets the home rails (modern-home.js) rebuild from the freshest data.
    document.dispatchEvent(new CustomEvent('glomek:datachange'));
}

function formatPrice(amount) {
    return `GH₵${parseFloat(amount).toFixed(2)}`;
}

function createProductCardHTML(product) {
    const defaultImage = product.images && product.images.length > 0 ? product.images[0].url : '';
    const price = product.offerPrice || product.price || 0;
    const productId = product._id || product.sId;
    const safeProductObj = { _id: productId, name: product.name, price: price, image: defaultImage };
    const prodJson = encodeURIComponent(JSON.stringify(safeProductObj));
    const isWishlisted = state.wishlist.some(w => w._id === productId);

    let discountHTML = '';
    let oldPriceHTML = '';
    if (product.offerPrice && product.price && product.offerPrice < product.price) {
        const pct = Math.round(((product.price - product.offerPrice) / product.price) * 100);
        discountHTML = `<span class="jumia-discount-tag">-${pct}%</span>`;
        oldPriceHTML = `<span class="jumia-old-price">${formatPrice(product.price)}</span>`;
    }

    // Low-stock urgency, the way the big marketplaces surface it.
    let stockHTML = '';
    if (typeof product.quantity === 'number' && product.quantity > 0 && product.quantity <= 5) {
        stockHTML = `<div class="card-stock-left">Only ${product.quantity} left</div>`;
    }

    return `
        <div class="product-card jumia-card" onclick="openProductDetails('${productId}')">
            <div class="product-image-container jumia-img-container">
                <button class="wishlist-heart-btn ${isWishlisted ? 'active' : ''}" onclick="toggleWishlistItem(event, '${productId}', '${encodeURIComponent(product.name)}', ${price}, '${encodeURIComponent(defaultImage)}')" title="${isWishlisted ? 'Remove from Saved' : 'Save for Later'}">
                    <span class="material-symbols-rounded">${isWishlisted ? 'favorite' : 'favorite_border'}</span>
                </button>
                <img src="${escapeHtml(defaultImage)}" alt="${escapeHtml(product.name)}" class="product-image" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=FALLBACK_IMAGE;">
                ${discountHTML}
            </div>
            <div class="product-info jumia-info">
                <h3 class="product-title jumia-title" title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</h3>
                ${renderCardRating(product)}
                <div class="product-price-row">
                    <div class="price-stack">
                        <div class="product-price jumia-price">${formatPrice(price)}</div>
                        <div class="jumia-price-was">${oldPriceHTML}</div>
                    </div>
                </div>
                ${stockHTML}
                <button class="card-add-btn" type="button"
                    onclick="quickAddToCart(event, '${productId}', '${prodJson}')">
                    Add to cart
                </button>
            </div>
        </div>
    `;
}

/**
 * Compact star rating for a product card: one filled star, the score, then the
 * review count in brackets — the pattern shoppers already read on every major
 * marketplace. Renders nothing when a product has no reviews yet, rather than
 * showing a misleading zero.
 */
function renderCardRating(product) {
    const avg = Number(product.averageRating) || 0;
    const count = Number(product.numberOfReviews) || 0;
    if (count === 0 || avg <= 0) return '';

    return `
        <div class="card-rating" aria-label="Rated ${avg.toFixed(1)} out of 5 from ${count} review${count === 1 ? '' : 's'}">
            <span class="material-symbols-rounded card-rating-star">star</span>
            <span class="card-rating-score">${avg.toFixed(1)}</span>
            <span class="card-rating-count">(${count})</span>
        </div>
    `;
}

/** Add straight from the grid without opening the product — the pattern
 *  shoppers expect from Jumia/Temu on a phone. */
window.quickAddToCart = function (event, productId, encodedProduct) {
    event.stopPropagation();
    event.preventDefault();

    // The card button is now a full-width label, not an icon disc. This used
    // to swap a `.material-symbols-rounded` child that no longer exists and
    // toggle a class whose styles were tied to the old selector — so tapping
    // Add to cart gave no feedback on the button at all.
    const btn = event.currentTarget;
    if (!btn.dataset.label) btn.dataset.label = btn.textContent.trim();
    btn.classList.add('added');
    btn.textContent = 'Added ✓';
    setTimeout(() => {
        btn.classList.remove('added');
        btn.textContent = btn.dataset.label;
    }, 900);

    if (window.haptic) window.haptic(12);
    addToCart(productId, encodedProduct);
}


// ====== CART LOGIC ====== //

window.addToCart = function (id, encodedProduct) {
    const product = JSON.parse(decodeURIComponent(encodedProduct));
    const existing = state.cart.find(i => i.productId === id);
    if (existing) {
        existing.quantity += 1;
    } else {
        state.cart.push({ productId: id, name: product.name, price: product.price, image: product.image, quantity: 1 });
    }
    updateCartUI();

    // Cart badge pulse animation
    if (UI.cartBadge) {
        UI.cartBadge.classList.remove('pulse');
        void UI.cartBadge.offsetWidth;
        UI.cartBadge.classList.add('pulse');
    }
    if (UI.pdCartBadge) {
        UI.pdCartBadge.classList.remove('pulse');
        void UI.pdCartBadge.offsetWidth;
        UI.pdCartBadge.classList.add('pulse');
    }

    // Animate the navbar cart icon
    if (UI.cartToggleBtn) {
        UI.cartToggleBtn.classList.add('cart-bounce');
        setTimeout(() => UI.cartToggleBtn.classList.remove('cart-bounce'), 600);
    }

    // Show floating cart FAB on mobile
    showMobileCartFab();

    showToast(`${product.name} added to cart`, "success");
}

window.updateQty = function (id, change) {
    const item = state.cart.find(i => i.productId === id);
    if (item) {
        item.quantity += change;
        if (item.quantity <= 0) { deleteFromCart(id); }
        else { updateCartUI(); }
    }
}

window.setQty = function (id, value) {
    const qty = parseInt(value, 10);
    if (isNaN(qty) || qty <= 0) { deleteFromCart(id); return; }
    const item = state.cart.find(i => i.productId === id);
    if (item) {
        item.quantity = qty;
        updateCartUI();
    }
}

window.deleteFromCart = function (id) {
    state.cart = state.cart.filter(i => i.productId !== id);
    updateCartUI();
}

function updateCartUI() {
    localStorage.setItem('glomek_cart', JSON.stringify(state.cart));
    const count = state.cart.length;
    if (count > 0) {
        UI.cartBadge.textContent = count;
        UI.cartBadge.hidden = false;
        if (UI.pdCartBadge) {
            UI.pdCartBadge.textContent = count;
            UI.pdCartBadge.hidden = false;
        }
        UI.checkoutBtn.disabled = false;
    } else {
        UI.cartBadge.hidden = true;
        if (UI.pdCartBadge) {
            UI.pdCartBadge.hidden = true;
        }
        UI.checkoutBtn.disabled = true;
    }

    let total = 0;
    if (count === 0) {
        UI.cartItemsContainer.innerHTML = `
            <div class="empty-cart-message" style="display:flex;">
                <span class="material-symbols-rounded">shopping_bag</span>
                <p>Your cart is empty.</p>
            </div>
        `;
    } else {
        const itemsHtml = state.cart.map(item => {
            total += (item.price * item.quantity);
            return `
                <div class="cart-item">
                    <img src="${escapeHtml(item.image)}" class="cart-item-img" alt="${escapeHtml(item.name)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=FALLBACK_IMAGE;">
                    <div class="cart-item-details">
                        <div class="cart-item-title">${escapeHtml(item.name)}</div>
                        <div class="cart-item-price">${formatPrice(item.price)}</div>
                        <div class="cart-item-actions">
                            <div class="qty-controls">
                                <button class="qty-btn" onclick="updateQty('${item.productId}', -1)" aria-label="Decrease quantity of ${escapeHtml(item.name)}"><span class="material-symbols-rounded" style="font-size:16px;">remove</span></button>
                                <input type="number" class="qty-input" name="qty-${item.productId}" value="${item.quantity}" min="1" autocomplete="off" aria-label="Quantity of ${escapeHtml(item.name)}" onchange="setQty('${item.productId}', this.value)" onkeydown="if(event.key==='Enter'){this.blur()}">
                                <button class="qty-btn" onclick="updateQty('${item.productId}', 1)" aria-label="Increase quantity of ${escapeHtml(item.name)}"><span class="material-symbols-rounded" style="font-size:16px;">add</span></button>
                            </div>
                            <button class="delete-btn" onclick="deleteFromCart('${item.productId}')" title="Remove" aria-label="Remove ${escapeHtml(item.name)} from cart"><span class="material-symbols-rounded">delete</span></button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        UI.cartItemsContainer.innerHTML = itemsHtml;
    }
    UI.cartTotal.textContent = formatPrice(total);

    // Update mobile floating cart FAB
    showMobileCartFab();
    // Update page title with cart count
    updatePageTitle();
    // Let the mobile tab bar refresh its badges
    document.dispatchEvent(new CustomEvent('glomek:statechange'));
}

function toggleCart(show) {
    if (show) {
        UI.cartSidebar.classList.add('open');
        UI.cartOverlay.classList.add('active');
    } else {
        UI.cartSidebar.classList.remove('open');
        UI.cartOverlay.classList.remove('active');
    }
    if (window.syncBodyScrollLock) window.syncBodyScrollLock();
    document.dispatchEvent(new CustomEvent('glomek:statechange'));
}


// ====== MOBILE FLOATING CART FAB ====== //
function showMobileCartFab() {
    const count = state.cart.length;
    let fab = document.getElementById('mobileCartFab');

    if (count === 0) {
        if (fab) fab.classList.remove('visible');
        return;
    }

    if (!fab) {
        fab = document.createElement('button');
        fab.id = 'mobileCartFab';
        fab.className = 'mobile-cart-fab';
        fab.innerHTML = `
            <span class="material-symbols-rounded">shopping_cart</span>
            <span class="mobile-cart-fab-badge" id="mobileCartFabBadge">${count}</span>
        `;
        fab.addEventListener('click', () => toggleCart(true));
        document.body.appendChild(fab);
        // Trigger entrance animation on next frame
        requestAnimationFrame(() => fab.classList.add('visible'));
    } else {
        const badge = document.getElementById('mobileCartFabBadge');
        if (badge) badge.textContent = count;
        fab.classList.add('visible');
        // Pop animation on update
        fab.classList.remove('fab-pop');
        void fab.offsetWidth;
        fab.classList.add('fab-pop');
    }
}


// ====== SHIMMER SKELETON LOADERS ====== //

function renderShimmerCategory() {
    UI.categoryList.innerHTML = Array(6).fill('<div class="shimmer-pill shimmer-wrapper"></div>').join('');
}

function renderShimmerGrid() {
    UI.productGrid.innerHTML = Array(10).fill(`
        <div class="shimmer-card shimmer-wrapper">
            <div class="shimmer-img"></div>
            <div class="shimmer-lines">
                <div class="shimmer-line"></div>
                <div class="shimmer-line short"></div>
                <div class="shimmer-line price"></div>
            </div>
        </div>
    `).join('');
}

// ====== AUTHENTICATION & PROFILE ====== //
/**
 * Where the JWT lives, and why.
 *
 * The API authenticates on the Authorization header, not on the cookie — an
 * unauthenticated POST /orders answers {"message":"No token provided"}. So the
 * token has to be reachable from JS on every page and after every navigation,
 * not just for as long as one document stays loaded.
 *
 * It used to be a plain variable, which quietly broke the two journeys that
 * leave the page:
 *
 *   • pages/orders.html is a different document, so it started with an empty
 *     variable. It looked for a `glomek_token` cookie instead — but that
 *     cookie belongs to api.glomek.com, and document.cookie on glomek.com can
 *     never see another domain's cookies. The gate therefore failed every
 *     time, and "Your Orders" from the menu always said "log in on the main
 *     store". Only the profile modal on index.html worked, because that one
 *     still had the variable in memory.
 *
 *   • The Paystack hosted-page redirect reloads the page on the way back, so
 *     the variable was gone by the time resumePendingPayment() ran.
 *     verifyPaystackPayment() needs no auth and passed; createOrder() sent no
 *     token and got a 401. Paystack had already taken the money. That is the
 *     "Payment received but the order failed to save" the customer sees.
 *
 * sessionStorage is the narrowest place that survives both: scoped to this one
 * tab and this origin, and gone when the tab closes. It is still XSS-readable,
 * but so was the variable — the server hands the token to JS in the login
 * response body and the app sends it as a Bearer header on every authenticated
 * call, so script running on the page could already reach it.
 */
const TOKEN_KEY = 'glomek_token';

function readStoredToken() {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function setUserToken(token) {
    userToken = token || null;
    try {
        if (token) sessionStorage.setItem(TOKEN_KEY, token);
        else sessionStorage.removeItem(TOKEN_KEY);
    } catch { /* private mode: the in-memory copy still serves this page */ }
}

let userToken = readStoredToken();
let currentUser = readStoredUser();
let isLoginMode = true;

/**
 * Prefer the HttpOnly cookie, and prove it before trusting it.
 *
 * The token in sessionStorage exists only because the app could not tell
 * whether the cookie authenticates. It can: one request with the Authorization
 * header deliberately withheld answers the question. If the cookie carried it,
 * the JS copy is redundant and is thrown away — leaving the JWT reachable only
 * by the server, which is the whole point of setting it HttpOnly.
 *
 * If the cookie does NOT carry it (never set, wrong attributes, blocked), the
 * token stays and checkout keeps working. This can make things safer; it can
 * never make them broken.
 *
 * Runs once: after it succeeds there is no token left, and the guard below
 * stops it running again.
 */
async function preferCookieAuth() {
    if (!currentUser || !currentUser._id || !userToken) return;

    if (await ApiService.cookieAuthWorks(currentUser._id)) {
        setUserToken(null);
        console.info("GLOMEK: HttpOnly cookie authenticates; JS token discarded.");
    }
}

function updateUserUI() {
    const userBtn = document.querySelector('.user-btn');
    if (userBtn && currentUser) {
        userBtn.title = currentUser.name || 'Account';
    }
}

const userBtn = document.querySelector('.user-btn');
if (userBtn) {
    userBtn.addEventListener('click', () => {
        if (currentUser) {
            document.getElementById('userName').textContent = currentUser?.name || 'User';
            loadOrderHistory();
            openModal('profileModal');
        } else {
            openModal('authModal');
        }
    });
}

window.toggleAuthMode = function () {
    isLoginMode = !isLoginMode;
    document.getElementById('authTitle').textContent = isLoginMode ? 'Login' : 'Sign Up';
    document.getElementById('authSubmitBtn').textContent = isLoginMode ? 'Login' : 'Create Account';
    document.getElementById('authToggleText').textContent = isLoginMode ? "Don't have an account?" : "Already have an account?";
    document.getElementById('authToggleLink').textContent = isLoginMode ? "Sign Up" : "Login";
    document.getElementById('authName').hidden = isLoginMode;
    document.getElementById('authName').required = !isLoginMode;
}

window.handleAuthSubmit = async function (e) {
    e.preventDefault();
    const email = document.getElementById('authEmail').value;
    const pass = document.getElementById('authPassword').value;
    const name = document.getElementById('authName').value;
    const btn = document.getElementById('authSubmitBtn');

    btn.textContent = "Please wait...";
    btn.disabled = true;

    try {
        let res;
        if (isLoginMode) {
            res = await ApiService.login(email, pass);
        } else {
            res = await ApiService.register(name, email, pass);
        }

        if (res.success) {
            showToast(res.message, "success");
            if (res.token) {
                setUserToken(res.token);
                currentUser = res.data;
                localStorage.setItem('glomek_user', JSON.stringify(currentUser));
                closeModal('authModal');
                updateUserUI();
                preferCookieAuth();
                state.recommendations = await ApiService.fetchRecommendations(currentUser._id);
            } else if (!isLoginMode) {
                // Registration success — switch to login
                isLoginMode = true;
                document.getElementById('authTitle').textContent = 'Login';
                document.getElementById('authSubmitBtn').textContent = 'Login';
                document.getElementById('authName').hidden = true;
            }
        } else {
            showToast(res.message || "Authentication failed.", "error");
        }
    } catch (err) {
        showToast("An error occurred. Please try again.", "error");
    }

    btn.textContent = isLoginMode ? 'Login' : 'Create Account';
    btn.disabled = false;
}

window.logout = async function () {
    await ApiService.logout(); // server clears the HTTP-only cookie
    currentUser = null;
    setUserToken(null);
    localStorage.removeItem('glomek_user');
    closeModal('profileModal');
    showToast("Successfully logged out.", "success");
}

async function loadOrderHistory() {
    const historyDiv = document.getElementById('orderHistory');
    historyDiv.innerHTML = '<p style="color:var(--text-secondary)">Loading your orders...</p>';

    if (!currentUser || !currentUser._id) return;

    const { orders, unauthorized } = await ApiService.fetchUserOrders(currentUser._id, userToken);
    if (unauthorized) {
        historyDiv.innerHTML = '<p style="color:var(--text-secondary)">Your session has expired. Please log in again.</p>';
        return;
    }
    if (orders.length === 0) {
        historyDiv.innerHTML = '<p style="color:var(--text-secondary)">No recent orders found.</p>';
        return;
    }

    historyDiv.innerHTML = orders.map(o => {
        const date = o.orderDate ? new Date(o.orderDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A';
        const statusClass = o.orderStatus || 'pending';
        const itemsHtml = (o.items || []).map(item => `
            <div style="display:flex; justify-content:space-between; font-size:0.85rem; color:var(--text-secondary); padding: 2px 0;">
                <span>${escapeHtml(item.productName || 'Item')} x${item.quantity}</span>
                <span>${formatPrice(item.price)}</span>
            </div>
        `).join('');

        return `
            <div class="order-card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem">
                    <strong>Order #${o._id ? o._id.substring(0, 8) : 'N/A'}</strong>
                    <span class="order-status-badge ${statusClass}">${statusClass}</span>
                </div>
                <div style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:0.5rem;">${date}</div>
                ${itemsHtml}
                <div style="display:flex; justify-content:flex-end; margin-top:0.5rem; font-weight:700;">
                    <span class="accent-text">${formatPrice(o.totalPrice)}</span>
                </div>
                <div style="margin-top: 10px; text-align: right;">
                    <button onclick='downloadOrderPDF(${JSON.stringify(o).replace(/'/g, "&apos;")})' style="background:transparent; color:var(--accent-color); border:1px solid var(--accent-color); padding: 4px 10px; border-radius:4px; font-size:0.75rem; cursor:pointer;">
                        Download PDF
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// ====== FORGOT & RESET PASSWORD ====== //
window.openForgotPassword = function () {
    closeModal('authModal');
    openModal('forgotPasswordModal');
}

window.handleForgotPasswordRequest = async function (e) {
    e.preventDefault();
    const email = document.getElementById('resetEmail').value;
    const btn = document.getElementById('reqOtpBtn');
    btn.textContent = "Sending...";
    btn.disabled = true;
    try {
        const res = await ApiService.forgotPassword(email);
        if (res && res.success) {
            showToast("OTP sent! Check your email.", "success");
            closeModal('forgotPasswordModal');
            openModal('resetPasswordModal');
        } else {
            showToast(res.message || "Failed to send OTP.", "error");
        }
    } catch (err) {
        showToast("An error occurred.", "error");
    }
    btn.textContent = "Request OTP";
    btn.disabled = false;
}

window.handleResetPasswordRequest = async function (e) {
    e.preventDefault();
    const email = document.getElementById('resetEmail').value;
    const otp = document.getElementById('resetOtp').value;
    const newPass = document.getElementById('resetNewPassword').value;
    const btn = document.getElementById('verifyOtpBtn');
    btn.textContent = "Verifying...";
    btn.disabled = true;
    try {
        const res = await ApiService.resetPassword(email, otp, newPass);
        if (res && res.success) {
            showToast("Password reset successful! You can now login.", "success");
            closeModal('resetPasswordModal');
            openModal('authModal');
        } else {
            showToast(res.message || "Invalid or expired OTP.", "error");
        }
    } catch (err) {
        showToast("An error occurred resetting password.", "error");
    }
    btn.textContent = "Set New Password";
    btn.disabled = false;
}


// ====== CHECKOUT & COUPONS ====== //
// Paystack is the only gateway. It fronts mobile money (MTN, Telecel,
// AirtelTigo) and cards, so there is no direct MoMo integration and no cash on
// delivery — every order is paid for and verified before it is created.
let appliedCouponConfig = null;

// Override at deploy time with `window.GLOMEK_PAYSTACK_KEY = 'pk_live_...'`.
const PAYSTACK_PUBLIC_KEY = window.GLOMEK_PAYSTACK_KEY || 'pk_test_c054cd818e2d4a49a16c6f9d16f2514dcc60740e';

// A test key on a live domain takes payments that never settle — the customer
// sees success and the money never arrives. Fail loudly rather than silently.
(function warnOnTestKeyInProduction() {
    const host = window.location.hostname;
    const isLocal = ['localhost', '127.0.0.1', '::1', ''].includes(host) || host.endsWith('.local');
    if (!isLocal && PAYSTACK_PUBLIC_KEY.startsWith('pk_test_')) {
        console.error(
            '%c⚠ GLOMEK: Paystack is running on a TEST key at ' + host + '.\n' +
            'No real money will be collected. Set window.GLOMEK_PAYSTACK_KEY to your pk_live_ key in index.html.',
            'color:#fff;background:#c00;font-size:14px;padding:6px 10px;border-radius:4px;'
        );
    }
})();

// Which Paystack channels each choice unlocks. `paystack` passes none, which
// lets the customer pick anything Paystack offers on the checkout screen.
const PAYSTACK_CHANNELS = {
    paystack_momo: ['mobile_money'],
    paystack_card: ['card'],
    paystack: null
};

const PAYMENT_HINTS = {
    paystack_momo: 'Approve the prompt on your phone to complete payment. Secured by Paystack — we never see or store your details.',
    paystack_card: 'Enter your card details on Paystack’s secure screen. Secured by Paystack — we never see or store your card.',
    paystack: 'Pick mobile money, card or bank on the Paystack screen. Secured by Paystack — we never see or store your details.'
};

const PENDING_ORDER_KEY = 'glomek_pending_order';

if (UI.checkoutBtn) {
    UI.checkoutBtn.addEventListener('click', () => {
        if (!currentUser) {
            showToast("Please login before checking out.", "warning");
            toggleCart(false);
            openModal('authModal');
            return;
        }
        if (state.cart.length === 0) {
            showToast("Your cart is empty.", "warning");
            return;
        }

        appliedCouponConfig = null;
        const couponInput = document.getElementById('chkCoupon');
        if (couponInput) couponInput.value = '';

        restoreSavedAddress();
        updateCheckoutSummary();
        toggleCart(false);
        openModal('checkoutModal');
    });
}

// ── Address memory (the app remembers it too, via GetStorage) ────────────
const ADDRESS_FIELDS = ['chkPhone', 'chkAddress', 'chkCity', 'chkState', 'chkPostalCode', 'chkCountry'];

function restoreSavedAddress() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('glomek_address') || '{}'); } catch { saved = {}; }
    ADDRESS_FIELDS.forEach(id => {
        const el = document.getElementById(id);
        if (el && saved[id]) el.value = saved[id];
    });
    const country = document.getElementById('chkCountry');
    if (country && !country.value) country.value = 'Ghana';
}

function saveAddress() {
    const saved = {};
    ADDRESS_FIELDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) saved[id] = el.value;
    });
    localStorage.setItem('glomek_address', JSON.stringify(saved));
}

// ── Totals ──────────────────────────────────────────────────────────────
function getCheckoutTotals() {
    const subtotal = state.cart.reduce((a, b) => a + (b.price * b.quantity), 0);
    const rawDiscount = appliedCouponConfig ? (appliedCouponConfig.discountAmount || 0) : 0;
    const discount = Math.min(rawDiscount, subtotal);
    return { subtotal, discount, total: Math.max(0, subtotal - discount) };
}

function updateCheckoutSummary() {
    const { subtotal, discount, total } = getCheckoutTotals();

    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('chkSubtotal', formatPrice(subtotal));
    set('chkDiscount', `-${formatPrice(discount)}`);
    set('checkoutAmount', formatPrice(total));
    set('payBtnAmount', formatPrice(total));

    const discountRow = document.getElementById('chkDiscountRow');
    if (discountRow) discountRow.hidden = discount <= 0;

    return { subtotal, discount, total };
}

window.applyCoupon = async function () {
    const input = document.getElementById('chkCoupon');
    const code = input.value.trim();
    if (!code) return showToast("Enter a coupon code first.", "warning");

    const subtotal = state.cart.reduce((a, b) => a + (b.price * b.quantity), 0);
    const pIds = state.cart.map(i => i.productId);

    const res = await ApiService.checkCoupon(code, subtotal, pIds);
    if (res.success) {
        appliedCouponConfig = res.data;
        showToast("Coupon applied successfully!", "success");
    } else {
        appliedCouponConfig = null;
        showToast(res.message || "Invalid or inapplicable coupon.", "error");
    }
    updateCheckoutSummary();
}

// ── Payment method picker ───────────────────────────────────────────────
function getSelectedPaymentMethod() {
    const checked = document.querySelector('input[name="payMethod"]:checked');
    return checked ? checked.value : 'paystack_momo';
}

window.selectPaymentMethod = function (value) {
    document.querySelectorAll('#payMethods .pay-method').forEach(tile => {
        const input = tile.querySelector('input[name="payMethod"]');
        tile.classList.toggle('selected', !!input && input.value === value);
    });
    const hint = document.getElementById('payMethodHint');
    if (hint) hint.textContent = PAYMENT_HINTS[value] || PAYMENT_HINTS.paystack;
    if (window.haptic) window.haptic();
}

// ── Pay button state ────────────────────────────────────────────────────
function setPayBtnBusy(busy, label) {
    const btn = document.getElementById('payBtn');
    if (!btn) return;
    const labelEl = document.getElementById('payBtnLabel');
    const amountEl = document.getElementById('payBtnAmount');
    btn.disabled = busy;
    btn.classList.toggle('is-busy', busy);
    if (labelEl) labelEl.textContent = busy ? (label || 'Processing…') : 'Pay';
    if (amountEl) amountEl.hidden = busy;
}

// ── Checkout ────────────────────────────────────────────────────────────
window.handleCheckoutSubmit = async function (e) {
    e.preventDefault();

    if (!currentUser) {
        showToast("Please login before checking out.", "warning");
        closeModal('checkoutModal');
        openModal('authModal');
        return;
    }
    if (state.cart.length === 0) {
        showToast("Your cart is empty.", "warning");
        return;
    }

    const paymentMethod = getSelectedPaymentMethod();
    const { subtotal, discount, total } = updateCheckoutSummary();

    if (total <= 0) {
        showToast("Order total must be greater than zero.", "error");
        return;
    }

    saveAddress();

    const orderData = {
        userID: currentUser._id,
        orderStatus: "pending",
        items: state.cart.map(i => ({
            productID: i.productId,
            productName: i.name,
            quantity: i.quantity,
            price: i.price
        })),
        totalPrice: total,
        shippingAddress: {
            phone: document.getElementById('chkPhone').value.trim(),
            street: document.getElementById('chkAddress').value.trim(),
            city: document.getElementById('chkCity').value.trim(),
            state: document.getElementById('chkState').value.trim(),
            postalCode: document.getElementById('chkPostalCode').value.trim(),
            country: document.getElementById('chkCountry').value.trim() || 'Ghana'
        },
        paymentMethod,
        couponCode: appliedCouponConfig ? appliedCouponConfig._id : null,
        orderTotal: { subtotal, discount, total }
    };

    const reference = 'GLOMEK_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    const email = (currentUser.email || '').trim() || 'customer@glomek.com';
    const channels = PAYSTACK_CHANNELS[paymentMethod];

    setPayBtnBusy(true, 'Opening secure checkout…');

    try {
        if (window.PaystackPop && typeof window.PaystackPop.setup === 'function') {
            await payWithPaystackInline({ orderData, reference, email, channels, total });
        } else {
            // The inline script did not load (blocked or offline) — fall back to
            // Paystack's hosted page and finish the order when the customer returns.
            await payWithPaystackRedirect({ orderData, reference, email, channels, total });
        }
    } catch (err) {
        console.error("Checkout Error:", err);
        showToast("Checkout failed. Please try again.", "error");
        setPayBtnBusy(false);
    }
}

/** In-page Paystack popup — the default, and the one that feels native. */
function payWithPaystackInline({ orderData, reference, email, channels, total }) {
    return new Promise((resolve) => {
        const handler = window.PaystackPop.setup({
            key: PAYSTACK_PUBLIC_KEY,
            email,
            amount: Math.round(total * 100), // pesewas
            currency: 'GHS',
            ref: reference,
            ...(channels ? { channels } : {}),
            metadata: {
                custom_fields: [
                    { display_name: 'Phone', variable_name: 'phone', value: orderData.shippingAddress.phone || 'N/A' },
                    { display_name: 'Customer', variable_name: 'customer', value: currentUser.name || 'Customer' }
                ]
            },
            callback: function (response) {
                // Paystack calls this synchronously — hand off to an async worker.
                finalisePaidOrder(orderData, response.reference)
                    .catch(err => {
                        console.error('Order finalisation error:', err);
                        showToast("Payment went through but we hit a snag saving the order. Contact support with reference " + response.reference + ".", "error");
                        setPayBtnBusy(false);
                    })
                    .finally(resolve);
            },
            onClose: function () {
                showToast('Payment cancelled — your cart is safe.', "warning");
                setPayBtnBusy(false);
                resolve();
            }
        });
        handler.openIframe();
    });
}

/** Hosted-page fallback: park the order, redirect, resume on return. */
async function payWithPaystackRedirect({ orderData, reference, email, channels, total }) {
    const returnUrl = window.location.origin + window.location.pathname;
    const initRes = await ApiService.initiatePaystackPayment(total, email, reference, channels, returnUrl, userToken);

    if (!initRes || !initRes.success || !initRes.authorization_url) {
        showToast(initRes && initRes.message ? initRes.message : "Could not start payment. Please try again.", "error");
        setPayBtnBusy(false);
        return;
    }

    sessionStorage.setItem(PENDING_ORDER_KEY, JSON.stringify({
        orderData,
        reference: initRes.reference || reference,
        returnUrl
    }));
    window.location.href = initRes.authorization_url;
}

/**
 * Verifies the reference, then creates the order. The server re-verifies with
 * Paystack and rejects a reused reference, so calling this twice cannot create
 * two orders.
 */
async function finalisePaidOrder(orderData, reference) {
    setPayBtnBusy(true, 'Verifying payment…');

    const verifyRes = await ApiService.verifyPaystackPayment(reference, userToken);
    if (!verifyRes || !verifyRes.success) {
        showToast("We couldn't confirm that payment. If you were debited, contact support with reference " + reference + ".", "error");
        setPayBtnBusy(false);
        return;
    }

    // Past this line the customer has been debited. The order is written to
    // localStorage *before* the first save attempt, so that whatever the API
    // does next — 401, 500, dropped connection, closed tab — the paid order
    // still exists somewhere and can be retried. It used to live only in the
    // text of an error toast.
    const payload = { ...orderData, paymentId: reference };
    parkPaidOrder(payload, reference);

    setPayBtnBusy(true, 'Placing your order…');
    const orderRes = await ApiService.createOrder(payload, userToken);

    if (orderRes && orderRes.success) {
        clearParkedOrder(reference);
        showToast("Payment successful! Your order is on its way.", "success");
        if (window.haptic) window.haptic([12, 40, 12]);
        showReceipt(payload, orderRes);
        state.cart = [];
        appliedCouponConfig = null;
        updateCartUI();
        closeModal('checkoutModal');
    } else {
        // The server's own reason used to be thrown away, which is why this
        // read as a mystery. "No token provided" would have named the bug.
        console.error('Order save failed:', orderRes);
        const why = orderRes && orderRes.message ? ' (' + orderRes.message + ')' : '';
        showToast(
            "Payment received" + why + ". Your order is saved on this device and " +
            "we'll retry automatically. Reference " + reference + ".",
            "warning"
        );
    }
    setPayBtnBusy(false);
}

/* ── Paid orders awaiting a successful save ──────────────────────────────
   A payment that Paystack has confirmed but the API has not yet accepted is
   money taken for nothing until the order lands. These live in localStorage,
   not sessionStorage, so they survive the tab being closed in frustration.  */
const PAID_ORDERS_KEY = 'glomek_unsaved_paid_orders';
const PAID_ORDER_MAX_ATTEMPTS = 5;
const PAID_ORDER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function readParkedOrders() {
    try {
        const list = JSON.parse(localStorage.getItem(PAID_ORDERS_KEY) || '[]');
        return Array.isArray(list) ? list : [];
    } catch { return []; }
}

function writeParkedOrders(list) {
    try { localStorage.setItem(PAID_ORDERS_KEY, JSON.stringify(list)); }
    catch { /* storage full or blocked — nothing useful to do here */ }
}

function parkPaidOrder(payload, reference) {
    const list = readParkedOrders().filter(o => o.reference !== reference);
    list.push({ payload, reference, parkedAt: Date.now(), attempts: 0 });
    writeParkedOrders(list);
}

function clearParkedOrder(reference) {
    writeParkedOrders(readParkedOrders().filter(o => o.reference !== reference));
}

/**
 * Retries any paid-but-unsaved order. Runs on load, once the token has been
 * restored from sessionStorage.
 *
 * Re-sending is safe: the server re-verifies the reference with Paystack and
 * rejects one it has already turned into an order, so a retry cannot produce a
 * duplicate.
 */
async function retryParkedOrders() {
    let list = readParkedOrders();
    if (list.length === 0) return;

    // Drop anything too old or too often tried to be worth retrying silently.
    const stale = list.filter(o =>
        Date.now() - (o.parkedAt || 0) > PAID_ORDER_MAX_AGE_MS ||
        (o.attempts || 0) >= PAID_ORDER_MAX_ATTEMPTS
    );
    if (stale.length) {
        console.warn('GLOMEK: giving up on paid orders', stale.map(o => o.reference));
        showToast(
            "We still couldn't save an earlier paid order. Please contact support with reference " +
            stale[0].reference + ".",
            "error"
        );
        list = list.filter(o => !stale.includes(o));
        writeParkedOrders(list);
    }

    if (list.length === 0 || !currentUser || !userToken) return;

    // An order parked seconds ago is one finalisePaidOrder() has just failed
    // on; retrying it in the same breath only repeats the same error toast.
    // Leave it for the next load.
    const ready = list.filter(o => Date.now() - (o.parkedAt || 0) > 30000);
    if (ready.length === 0) return;

    for (const entry of ready) {
        entry.attempts = (entry.attempts || 0) + 1;
        writeParkedOrders(list);

        const res = await ApiService.createOrder(entry.payload, userToken);
        if (res && res.success) {
            clearParkedOrder(entry.reference);
            showToast("Your earlier paid order has now been placed. Reference " + entry.reference + ".", "success");
        } else {
            console.warn('GLOMEK: retry failed for ' + entry.reference, res);
        }
    }
}

/**
 * Runs on load: if the customer came back from Paystack's hosted page, pick the
 * order back up where it left off.
 */
async function resumePendingPayment() {
    const raw = sessionStorage.getItem(PENDING_ORDER_KEY);
    if (!raw) return;
    sessionStorage.removeItem(PENDING_ORDER_KEY); // one attempt only

    let pending;
    try { pending = JSON.parse(raw); } catch { return; }
    if (!pending || !pending.reference || !pending.orderData) return;

    showToast('Confirming your payment…', 'info');
    await finalisePaidOrder(pending.orderData, pending.reference);
}

// ====== PRODUCT DETAIL MODAL (CAROUSEL + REVIEWS) ====== //
let currentPdImages = [];
let currentPdIndex = 0;
let currentPdProduct = null;

window.openProductDetails = async function (productId) {
    // Search in featured, allProducts, or recommendations first (instant)
    let product = state.products.find(p => (p._id || p.sId) === productId) ||
        (state.allProducts || []).find(p => (p._id || p.sId) === productId) ||
        state.recommendations.find(p => (p._id || p.sId) === productId) ||
        state.recentlyViewed.find(r => r._id === productId);

    // If no cached product at all, show a loading skeleton inside the modal while we fetch
    if (!product) {
        showPdLoadingSkeleton();
        openModal('productDetailModal');
        const freshProduct = await ApiService.fetchProductById(productId);
        if (!freshProduct) {
            closeModal('productDetailModal');
            // fetchProductById already retried a dropped request, so by here it
            // is either genuinely gone or the connection is down. Say both.
            showToast("Couldn't open that product. Check your connection and try again.", 'error');
            return false;
        }
        product = freshProduct;
        populateProductDetail(product);
        return true;
    }

    // Populate immediately with cached data
    populateProductDetail(product);
    openModal('productDetailModal');

    // Setup image zoom after modal is visible
    setTimeout(() => setupImageZoom(), 100);

    // Background: fetch fresh data for accurate ratings/reviews, then refresh
    ApiService.fetchProductById(productId).then(freshProduct => {
        if (freshProduct && document.getElementById('productDetailModal') && !document.getElementById('productDetailModal').hidden) {
            currentPdProduct = freshProduct;
            // Only refresh reviews/ratings in-place (no jarring re-render)
            renderProductReviews(freshProduct);
            // Update rating stars quietly
            updatePdRatingStars(freshProduct);
        }
    });

    return true;
}

function showPdLoadingSkeleton() {
    const layout = document.querySelector('.pd-layout');
    if (!layout) return;
    // Show a quick shimmer inside the modal while loading
    document.getElementById('pdImage').src = '';
    document.getElementById('pdImage').alt = 'Loading...';
    document.getElementById('pdTitle').textContent = 'Loading product...';
    document.getElementById('pdPrice').textContent = '—';
    document.getElementById('buyBoxPrice').textContent = '—';
    document.getElementById('pdDescription').innerHTML = '<li class="shimmer-line" style="height:14px;width:80%;background:#f0f0f0;border-radius:4px;list-style:none;"></li>';
    document.getElementById('pdReviewsList').innerHTML = '';
    const thumbContainer = document.getElementById('pdThumbnails');
    thumbContainer.style.display = 'none';
}

function updatePdRatingStars(product) {
    const avgRating = product.averageRating || 0;
    const numReviews = product.numberOfReviews || (product.ratings ? product.ratings.length : 0);
    const ratingContainer = document.querySelector('.pd-rating');
    if (!ratingContainer) return;
    let starsHtml = '';
    for (let i = 1; i <= 5; i++) {
        if (i <= Math.floor(avgRating)) {
            starsHtml += '<span class="material-symbols-rounded" style="color:#FFA41C;font-size:18px;">star</span>';
        } else if (i - 0.5 <= avgRating) {
            starsHtml += '<span class="material-symbols-rounded" style="color:#FFA41C;font-size:18px;">star_half</span>';
        } else {
            starsHtml += '<span class="material-symbols-rounded" style="color:#ddd;font-size:18px;">star</span>';
        }
    }
    // A real control, not a dead `<a href="#">`. It used to be an anchor with
    // no handler at all, so clicking the rating count did nothing.
    starsHtml += `<button type="button" class="pd-rating-link" id="pdRatingLink">${numReviews} rating${numReviews !== 1 ? 's' : ''}</button>`;
    ratingContainer.innerHTML = starsHtml;

    const link = ratingContainer.querySelector('#pdRatingLink');
    if (link) link.addEventListener('click', scrollToReviews);
}

/** Jumps to the reviews block inside the open product sheet. */
window.scrollToReviews = function scrollToReviews() {
    const section = document.querySelector('.pd-reviews-section');
    if (!section) return;
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    section.classList.remove('pd-reviews-flash');
    void section.offsetWidth;
    section.classList.add('pd-reviews-flash');
}

/** Hands the product to the device share sheet, falling back to the clipboard. */
window.shareCurrentProduct = async function () {
    const product = currentPdProduct;
    if (!product) return;

    const id = product._id || product.sId;
    const url = `${window.location.origin}${window.location.pathname}?product=${encodeURIComponent(id)}`;
    const shareData = {
        title: product.name,
        text: `${product.name} — ${formatPrice(product.offerPrice || product.price || 0)} on Glomek`,
        url
    };

    if (window.haptic) window.haptic();

    try {
        if (navigator.share) {
            await navigator.share(shareData);
            return;
        }
        await navigator.clipboard.writeText(url);
        showToast('Product link copied to clipboard.', 'success');
    } catch (err) {
        // AbortError just means the customer dismissed the share sheet.
        if (err && err.name !== 'AbortError') {
            showToast('Could not share this product.', 'warning');
        }
    }
}

function populateProductDetail(product) {
    currentPdProduct = product;

    // Images — preload main image for instant display
    currentPdImages = product.images && product.images.length > 0
        ? product.images.map(img => typeof img === 'string' ? img : (img.url || img.imageUrl || ''))
        : [''];
    currentPdIndex = 0;

    // Preload all images in background
    currentPdImages.forEach(src => {
        if (src) { const img = new Image(); img.src = src; }
    });

    updatePdCarousel();

    // Thumbnails
    const thumbContainer = document.getElementById('pdThumbnails');
    if (currentPdImages.length > 1) {
        thumbContainer.style.display = 'flex';
        thumbContainer.innerHTML = currentPdImages.map((img, i) =>
            `<img src="${img}" class="pd-thumbnail ${i === 0 ? 'active' : ''}" onclick="selectPdImage(${i})" alt="Thumbnail ${i + 1}">`
        ).join('');
    } else {
        thumbContainer.style.display = 'none';
    }

    document.getElementById('pdTitle').textContent = product.name;
    const price = product.offerPrice || product.price || 0;
    const priceNum = formatPrice(price).replace('GH₵', '');

    document.getElementById('pdPrice').textContent = priceNum;
    document.getElementById('buyBoxPrice').textContent = priceNum;

    // Dynamic star rating
    updatePdRatingStars(product);

    // Discount
    if (product.offerPrice && product.price && product.offerPrice < product.price) {
        document.getElementById('pdOldPrice').textContent = formatPrice(product.price);
        document.getElementById('pdOldPrice').hidden = false;
        const discountPct = Math.round(((product.price - product.offerPrice) / product.price) * 100);
        const badge = document.getElementById('pdDiscount');
        badge.textContent = `-${discountPct}%`;
        badge.hidden = false;
    } else {
        document.getElementById('pdOldPrice').hidden = true;
        document.getElementById('pdDiscount').hidden = true;
    }

    // Stock
    const stockWarn = document.getElementById('pdStockWarning');
    const stockText = document.getElementById('pdStockText');
    stockWarn.hidden = false;
    if (product.quantity > 0 && product.quantity < 50) {
        stockText.textContent = `Only ${product.quantity} left in stock - order soon.`;
        stockWarn.style.color = '#B12704';
    } else if (product.quantity <= 0) {
        stockText.textContent = `Currently unavailable.`;
        stockWarn.style.color = '#B12704';
    } else {
        stockText.textContent = `In Stock`;
        stockWarn.style.color = '#007600';
    }

    // Description
    const descEl = document.getElementById('pdDescription');
    if (product.description) {
        const points = product.description.split('. ').filter(p => p.trim());
        descEl.innerHTML = points.length > 1
            ? points.map(p => `<li>${escapeHtml(p)}</li>`).join('')
            : `<li>${escapeHtml(product.description)}</li>`;
    } else {
        descEl.innerHTML = `<li>No description provided.</li>`;
    }

    // Reviews
    renderProductReviews(product);

    // Add To Cart / Buy Now buttons
    const safeProductObj = { _id: product._id || product.sId, name: product.name, price: price, image: currentPdImages[0] };
    const prodJson = encodeURIComponent(JSON.stringify(safeProductObj));

    const addToCartBtn = document.getElementById('pdAddToCartBtn');
    addToCartBtn.onclick = () => {
        addToCart(safeProductObj._id, prodJson);
        // Show visual feedback on the button
        const originalHTML = addToCartBtn.innerHTML;
        addToCartBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size:20px;vertical-align:middle;margin-right:4px;">check_circle</span> Added to Cart!';
        addToCartBtn.style.background = '#00c853';
        addToCartBtn.style.color = '#fff';
        addToCartBtn.style.border = '1px solid #00a843';
        addToCartBtn.disabled = true;
        setTimeout(() => {
            addToCartBtn.innerHTML = originalHTML;
            addToCartBtn.style.background = '';
            addToCartBtn.style.color = '';
            addToCartBtn.style.border = '';
            addToCartBtn.disabled = false;
        }, 1800);
    };
    document.getElementById('pdBuyNowBtn').onclick = () => {
        if (!currentUser) {
            showToast('Please login before purchasing.', 'warning');
            closeModal('productDetailModal');
            openModal('authModal');
            return;
        }
        const existing = state.cart.find(i => i.productId === safeProductObj._id);
        if (!existing) {
            state.cart.push({ productId: safeProductObj._id, name: safeProductObj.name, price: safeProductObj.price, image: safeProductObj.image, quantity: 1 });
        }
        updateCartUI();
        closeModal('productDetailModal');
        const total = state.cart.reduce((a, b) => a + (b.price * b.quantity), 0);
        document.getElementById('checkoutAmount').textContent = formatPrice(total);
        openModal('checkoutModal');
    };

    // Track recently viewed
    trackRecentlyViewed(product);
    // Render related products
    renderRelatedProducts(product);

    // Setup image zoom after modal is visible
    setTimeout(() => setupImageZoom(), 100);
}

function renderProductReviews(product) {
    const reviewsList = document.getElementById('pdReviewsList');
    const reviewForm = document.getElementById('pdReviewForm');

    const ratings = product.ratings || [];

    if (ratings.length === 0) {
        reviewsList.innerHTML = '<p style="color:var(--text-secondary);font-size:0.9rem;">No reviews yet. Be the first to review!</p>';
    } else {
        reviewsList.innerHTML = ratings.map(r => {
            const userName = r.userId && typeof r.userId === 'object' ? r.userId.name : (r.userId || 'User');
            let stars = '';
            for (let i = 1; i <= 5; i++) {
                stars += `<span class="material-symbols-rounded">${i <= r.rating ? 'star' : 'star'}</span>`;
            }
            // Color filled vs empty
            const starsHtml = Array.from({ length: 5 }, (_, i) =>
                `<span class="material-symbols-rounded" style="color:${i < r.rating ? '#FFA41C' : '#ddd'};"}>star</span>`
            ).join('');

            return `
                <div class="review-card">
                    <div class="review-header">
                        <span class="review-author">${escapeHtml(userName)}</span>
                        <div class="review-stars">${starsHtml}</div>
                    </div>
                    ${r.review ? `<p class="review-text">${escapeHtml(r.review)}</p>` : ''}
                </div>
            `;
        }).join('');
    }

    // Show review form only for logged-in users who have a delivered order containing this product
    reviewForm.hidden = true;
    if (currentUser) {
        const productId = product._id || product.sId;
        checkReviewEligibility(productId).then(canReview => {
            if (canReview) {
                reviewForm.hidden = false;
                setupStarPicker();
                setupReviewSubmit(productId);
            }
        });
    }
}

async function checkReviewEligibility(productId) {
    if (!currentUser || !currentUser._id) return false;
    try {
        const { orders } = await ApiService.fetchUserOrders(currentUser._id, userToken);
        for (const order of orders) {
            const status = (order.orderStatus || '').toLowerCase();
            // User can review if the order is Delivered
            if (status === 'delivered') {
                const items = order.items || [];
                // Check if the current product exists in this delivered order
                const hasPurchased = items.some(item => 
                    String(item.product) === String(productId) || 
                    String(item._id) === String(productId) || 
                    String(item.productId) === String(productId)
                );
                if (hasPurchased) return true;
            }
        }
    } catch (e) {
        console.error('Failed to verify review eligibility:', e);
    }
    return false;
}

let selectedRating = 0;

function setupStarPicker() {
    selectedRating = 0;
    const picker = document.getElementById('starPicker');
    picker.innerHTML = Array.from({ length: 5 }, (_, i) =>
        `<span class="material-symbols-rounded" data-rating="${i + 1}" onclick="setStarRating(${i + 1})">star</span>`
    ).join('');
}

window.setStarRating = function (rating) {
    selectedRating = rating;
    const stars = document.querySelectorAll('#starPicker .material-symbols-rounded');
    stars.forEach((s, i) => {
        s.classList.toggle('active', i < rating);
    });
}

function setupReviewSubmit(productId) {
    const btn = document.getElementById('submitReviewBtn');
    // Remove previous handler by replacing the node
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.addEventListener('click', async () => {
        if (selectedRating === 0) return showToast("Please select a star rating.", "warning");

        const review = document.getElementById('reviewText').value.trim();
        newBtn.textContent = "Submitting...";
        newBtn.disabled = true;

        const res = await ApiService.rateProduct(productId, selectedRating, review, userToken);
        if (res && res.success) {
            showToast("Review submitted successfully!", "success");
            // Re-render reviews with updated data
            if (res.data) renderProductReviews(res.data);
            document.getElementById('reviewText').value = '';
            selectedRating = 0;
            setupStarPicker();
        } else {
            showToast(res.message || "Failed to submit review.", "error");
        }

        newBtn.textContent = "Submit Review";
        newBtn.disabled = false;
    });
}

let isAnimating = false;

window.selectPdImage = function (index) {
    if (index === currentPdIndex || isAnimating) return;
    fadeToPdImage(index);
}

window.fadeToPdImage = function (newIndex) {
    if (isAnimating) return;
    isAnimating = true;

    const pdImage = document.getElementById('pdImage');
    pdImage.style.opacity = '0';

    setTimeout(() => {
        currentPdIndex = newIndex;
        let newSrc = currentPdImages[currentPdIndex];
        if (typeof newSrc === 'object' && newSrc !== null) newSrc = newSrc.url || newSrc.imageUrl;

        // Update dots
        const dotsContainer = document.getElementById('pdDots');
        if (currentPdImages.length > 1) {
            dotsContainer.innerHTML = currentPdImages.map((_, i) =>
                `<div class="pd-dot ${i === currentPdIndex ? 'active' : ''}" onclick="selectPdImage(${i})"></div>`
            ).join('');
        }

        // Update thumbnails
        document.querySelectorAll('.pd-thumbnail').forEach((t, i) => {
            t.classList.toggle('active', i === currentPdIndex);
        });

        pdImage.onload = () => { pdImage.style.opacity = '1'; isAnimating = false; };
        pdImage.onerror = () => { pdImage.style.opacity = '1'; isAnimating = false; };
        pdImage.src = newSrc;
        setTimeout(() => { pdImage.style.opacity = '1'; isAnimating = false; }, 150);
    }, 200);
}

function updatePdCarousel() {
    const pdImage = document.getElementById('pdImage');
    let newSrc = currentPdImages[currentPdIndex];
    if (typeof newSrc === 'object' && newSrc !== null) newSrc = newSrc.url || newSrc.imageUrl;
    pdImage.src = newSrc;
    pdImage.style.opacity = '1';

    const dotsContainer = document.getElementById('pdDots');
    if (currentPdImages.length > 1) {
        dotsContainer.innerHTML = currentPdImages.map((_, i) =>
            `<div class="pd-dot ${i === currentPdIndex ? 'active' : ''}" onclick="selectPdImage(${i})"></div>`
        ).join('');
        document.querySelectorAll('.pd-main-image-container .carousel-btn').forEach(b => b.hidden = false);
    } else {
        dotsContainer.innerHTML = '';
        document.querySelectorAll('.pd-main-image-container .carousel-btn').forEach(b => b.hidden = true);
    }
}

window.nextPdImage = function (e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (currentPdImages.length <= 1 || isAnimating) return;
    fadeToPdImage((currentPdIndex + 1) % currentPdImages.length);
}

window.prevPdImage = function (e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (currentPdImages.length <= 1 || isAnimating) return;
    fadeToPdImage((currentPdIndex - 1 + currentPdImages.length) % currentPdImages.length);
}

function setupPdImageSwipe() {
    let touchStartX = 0, touchEndX = 0;
    const container = document.getElementById('pdMainImgContainer');
    if (!container) return;

    container.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        const diff = touchStartX - touchEndX;
        if (Math.abs(diff) > 50) {
            if (diff > 0) window.nextPdImage();
            else window.prevPdImage();
        }
    }, { passive: true });
}

// ====== MODAL UTILS ====== //
// Sheets behave like native screens: the page behind them never scrolls, and
// the hardware/browser back button dismisses the top one instead of leaving.
let modalStack = [];
let suppressModalPop = false;

/**
 * Single source of truth for the page scroll lock.
 *
 * This asks the DOM what is actually open rather than counting opens and
 * closes, so it cannot drift. That matters more than it sounds: if the lock
 * is ever left on with nothing open, the page simply stops scrolling and
 * there is no way for the customer to recover short of a reload.
 */
function isAnyOverlayOpen() {
    return !!document.querySelector('.modal-overlay:not([hidden])')
        || !!document.querySelector('.cart-sidebar.open')
        || !!document.querySelector('.wishlist-sidebar.open')
        // The category drawer sets the lock itself; it must be counted here
        // too or closing any modal would unlock the page behind an open drawer.
        || !!document.querySelector('.cat-drawer.open');
}

function syncBodyScrollLock() {
    const anyOpen = isAnyOverlayOpen();
    document.body.classList.toggle('overlay-open', anyOpen);
    document.body.style.overflow = anyOpen ? 'hidden' : '';
}
window.syncBodyScrollLock = syncBodyScrollLock;

/**
 * Safety net. If the lock is somehow left on with nothing open — an exception
 * partway through a close handler, a stale class — release it rather than
 * leaving the customer on a page that will not scroll.
 */
function releaseStuckScrollLock() {
    const locked = document.body.style.overflow === 'hidden'
        || document.body.classList.contains('overlay-open');
    if (locked && !isAnyOverlayOpen()) {
        document.body.classList.remove('overlay-open');
        document.body.style.overflow = '';
    }
}
window.releaseStuckScrollLock = releaseStuckScrollLock;

// Cheap, and only ever acts when the page is already broken.
setInterval(releaseStuckScrollLock, 1000);
window.addEventListener('pageshow', releaseStuckScrollLock);

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Remembers what had focus before each modal opened, so closing returns the
// customer exactly where they were — required for keyboard and screen readers.
let focusReturnStack = [];

window.openModal = function (id) {
    const el = document.getElementById(id);
    if (!el || el.hidden === false) return;

    focusReturnStack.push(document.activeElement);
    el.hidden = false;

    // Google sizes its button from the container's box, so it can only be
    // drawn once the dialog is actually on screen. Idempotent — reopening the
    // modal does not redraw a button that is already there.
    if (id === 'authModal') renderGoogleButton();

    // Announce it as a dialog rather than an anonymous div.
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    const heading = el.querySelector('h1, h2, h3');
    if (heading) {
        if (!heading.id) heading.id = `${id}Heading`;
        el.setAttribute('aria-labelledby', heading.id);
    }

    modalStack.push(id);
    try { history.pushState({ glomekModal: id }, ''); } catch { /* history unavailable */ }
    syncBodyScrollLock();

    // Move focus inside so the next Tab lands in the dialog, not behind it.
    requestAnimationFrame(() => {
        const target = el.querySelector('input:not([type="hidden"]):not([disabled]), textarea, button:not(.close-modal)')
            || el.querySelector(FOCUSABLE);
        if (target) target.focus();
    });
}

/** Keeps Tab inside the top-most dialog. */
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const top = modalStack[modalStack.length - 1];
    if (!top) return;

    const el = document.getElementById(top);
    if (!el) return;

    const items = [...el.querySelectorAll(FOCUSABLE)].filter(n => n.offsetParent !== null);
    if (items.length === 0) return;

    const first = items[0];
    const last = items[items.length - 1];

    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
});

window.closeModal = function (id) {
    const el = document.getElementById(id);
    if (!el || el.hidden) return;
    el.hidden = true;
    const idx = modalStack.lastIndexOf(id);
    if (idx > -1) modalStack.splice(idx, 1);
    syncBodyScrollLock();

    const returnTo = focusReturnStack.pop();
    if (returnTo && typeof returnTo.focus === 'function' && document.contains(returnTo)) {
        returnTo.focus();
    }

    // Drop the matching history entry so back/forward stays in step.
    if (history.state && history.state.glomekModal === id) {
        suppressModalPop = true;
        try { history.back(); } catch { suppressModalPop = false; }
    }
}

window.addEventListener('popstate', () => {
    if (suppressModalPop) { suppressModalPop = false; return; }

    const top = modalStack[modalStack.length - 1];

    // Nothing open — this is Back through the listing history, so restore the
    // search / category / page the address bar now describes.
    if (!top) {
        applyListingFromUrl();
        // Crucial: the load this triggers must NOT push a new history entry.
        // It used to, so every Back press consumed one entry and immediately
        // created another — you could press Back forever and never leave.
        suppressUrlSync = true;
        Promise.resolve(loadProducts()).finally(() => { suppressUrlSync = false; });
        return;
    }

    // The history entry is already gone, so tear down without calling back()
    // — but run the same focus/scroll cleanup closeModal does.
    const el = document.getElementById(top);
    if (el) el.hidden = true;
    modalStack.pop();
    syncBodyScrollLock();

    const returnTo = focusReturnStack.pop();
    if (returnTo && typeof returnTo.focus === 'function' && document.contains(returnTo)) {
        returnTo.focus();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const top = modalStack[modalStack.length - 1];
    if (top) closeModal(top);
});

// ====================================================================
// PHASE 1 & 2 — NEW FEATURES
// ====================================================================

// ====== SORTING ====== //
function applySorting(list, sortKey) {
    const sorted = [...list];
    switch (sortKey) {
        case 'price_low':
            sorted.sort((a, b) => (a.offerPrice || a.price || 0) - (b.offerPrice || b.price || 0));
            break;
        case 'price_high':
            sorted.sort((a, b) => (b.offerPrice || b.price || 0) - (a.offerPrice || a.price || 0));
            break;
        case 'newest':
            sorted.sort((a, b) => {
                const da = new Date(b.createdAt || 0);
                const db = new Date(a.createdAt || 0);
                return da - db;
            });
            break;
        case 'rating':
            sorted.sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0));
            break;
        default: // 'featured' — keep original order
            break;
    }
    return sorted;
}

window.handleSortChange = function () {
    state.sortBy = document.getElementById('sortSelect').value;
    state.currentPage = 1;
    loadProducts();
}

window.applyPriceFilter = function () {
    const min = document.getElementById('priceMin').value;
    const max = document.getElementById('priceMax').value;
    state.priceMin = min ? parseFloat(min) : null;
    state.priceMax = max ? parseFloat(max) : null;
    state.currentPage = 1;
    loadProducts();
}

// ====== PRODUCT COUNT ====== //
function updateProductCount() {
    const el = document.getElementById('productCountText');
    if (!el) return;
    const count = state.products.length;
    
    if (state.searchKeyword) {
        el.innerHTML = `Showing <strong>${count}</strong> result${count !== 1 ? 's' : ''} for "<strong>${escapeHtml(state.searchKeyword)}</strong>"`;
    } else if (state.selectedCategoryId) {
        const cat = state.categories.find(c => c._id === state.selectedCategoryId);
        el.innerHTML = `Showing <strong>${count}</strong> result${count !== 1 ? 's' : ''} in <strong>${escapeHtml(cat ? cat.name : 'category')}</strong>`;
    } else {
        el.innerHTML = `Showing <strong>${count}</strong> product${count !== 1 ? 's' : ''}`;
    }
}

// ====== BREADCRUMBS ====== //
function updateBreadcrumbs() {
    const nav = document.getElementById('breadcrumbNav');
    if (!nav) return;
    // "Home" clears whatever narrowed the listing — search term included.
    let html = '<a href="#" onclick="exitListing(); return false;">Home</a>';

    if (state.selectedCategoryId) {
        const cat = state.categories.find(c => c._id === state.selectedCategoryId);
        if (cat) {
            html += '<span class="breadcrumb-sep">›</span>';
            if (state.selectedSubCategoryId) {
                html += `<a href="#" onclick="filterByCategory('${cat._id}'); return false;">${escapeHtml(cat.name)}</a>`;
            } else {
                html += `<span class="breadcrumb-current">${escapeHtml(cat.name)}</span>`;
            }
        }
    }
    if (state.selectedSubCategoryId) {
        const subCat = state.subCategories.find(s => s._id === state.selectedSubCategoryId);
        if (subCat) {
            html += '<span class="breadcrumb-sep">›</span>';
            html += `<span class="breadcrumb-current">${escapeHtml(subCat.name)}</span>`;
        }
    }
    if (state.searchKeyword) {
        html += '<span class="breadcrumb-sep">›</span>';
        html += `<span class="breadcrumb-current">Search: "${escapeHtml(state.searchKeyword)}"</span>`;
    }
    nav.innerHTML = html;
}

// ====== RECENTLY VIEWED ====== //
function trackRecentlyViewed(product) {
    if (!product || !product._id) return;
    const img = product.images && product.images.length > 0 ? (product.images[0].url || product.images[0]) : '';
    const entry = {
        _id: product._id || product.sId,
        name: product.name,
        price: product.offerPrice || product.price || 0,
        image: typeof img === 'string' ? img : (img.url || '')
    };
    // Remove duplicate
    state.recentlyViewed = state.recentlyViewed.filter(r => r._id !== entry._id);
    // Prepend
    state.recentlyViewed.unshift(entry);
    // Keep max 20
    if (state.recentlyViewed.length > 20) state.recentlyViewed = state.recentlyViewed.slice(0, 20);
    localStorage.setItem('glomek_recently_viewed', JSON.stringify(state.recentlyViewed));
    renderRecentlyViewed();
}

function renderRecentlyViewed() {
    const section = document.getElementById('recentlyViewedSection');
    const scroll = document.getElementById('recentlyViewedScroll');
    if (!section || !scroll) return;

    if (state.recentlyViewed.length === 0) {
        section.hidden = true;
        return;
    }

    section.hidden = false;
    // The thumbnail sits in its own box that shimmers until the image paints.
    // On a slow connection these were blank squares for several seconds, which
    // reads as broken — particularly beside a neighbour that already loaded.
    scroll.innerHTML = state.recentlyViewed.map(item => `
        <div class="rv-card" onclick="openProductDetails('${item._id}')">
            <div class="rv-thumb">
                <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy" decoding="async"
                     onload="this.parentNode.classList.add('is-loaded')"
                     onerror="this.onerror=null;this.src=FALLBACK_IMAGE;this.parentNode.classList.add('is-loaded');">
            </div>
            <div class="rv-title">${escapeHtml(item.name)}</div>
            <div class="rv-price">${formatPrice(item.price)}</div>
        </div>
    `).join('');

    // An image served straight from cache can finish before the inline onload
    // is wired up, and would otherwise shimmer forever behind a picture that
    // is already there.
    scroll.querySelectorAll('.rv-thumb img').forEach(img => {
        if (img.complete && img.naturalWidth > 0) {
            img.parentNode.classList.add('is-loaded');
        }
    });
}

// ====== WISHLIST SYSTEM ====== //
window.toggleWishlistItem = function (event, productId, encodedName, price, encodedImage) {
    event.stopPropagation();
    const btn = event.currentTarget;
    const existing = state.wishlist.findIndex(w => w._id === productId);

    if (existing >= 0) {
        // Remove from wishlist
        state.wishlist.splice(existing, 1);
        btn.classList.remove('active');
        btn.querySelector('.material-symbols-rounded').textContent = 'favorite_border';
        btn.title = 'Save for Later';
        showToast('Removed from saved items', 'info');
    } else {
        // Add to wishlist
        state.wishlist.push({
            _id: productId,
            name: decodeURIComponent(encodedName),
            price: price,
            image: decodeURIComponent(encodedImage)
        });
        btn.classList.add('active');
        btn.querySelector('.material-symbols-rounded').textContent = 'favorite';
        btn.title = 'Remove from Saved';
        // Pop animation
        btn.classList.remove('popping');
        void btn.offsetWidth;
        btn.classList.add('popping');
        showToast('Saved for later', 'success');
    }

    localStorage.setItem('glomek_wishlist', JSON.stringify(state.wishlist));
    updateWishlistBadge();
    renderWishlistSidebar();
}

function updateWishlistBadge() {
    const badge = document.getElementById('wishlistBadge');
    if (!badge) return;
    if (state.wishlist.length > 0) {
        badge.textContent = state.wishlist.length;
        badge.hidden = false;
    } else {
        badge.hidden = true;
    }
    document.dispatchEvent(new CustomEvent('glomek:statechange'));
}

function toggleWishlist(show) {
    const sidebar = document.getElementById('wishlistSidebar');
    if (!sidebar) return;
    if (show) {
        sidebar.classList.add('open');
        UI.cartOverlay.classList.add('active');
        renderWishlistSidebar();
    } else {
        sidebar.classList.remove('open');
        // Only remove overlay if cart sidebar is also closed
        if (!UI.cartSidebar.classList.contains('open')) {
            UI.cartOverlay.classList.remove('active');
        }
    }
    if (window.syncBodyScrollLock) window.syncBodyScrollLock();
    document.dispatchEvent(new CustomEvent('glomek:statechange'));
}

function renderWishlistSidebar() {
    const container = document.getElementById('wishlistItems');
    if (!container) return;

    if (state.wishlist.length === 0) {
        container.innerHTML = `
            <div class="empty-wishlist-msg">
                <span class="material-symbols-rounded">favorite_border</span>
                <p>No saved items yet.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = state.wishlist.map(item => `
        <div class="wishlist-item">
            <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=FALLBACK_IMAGE;" onclick="openProductDetails('${item._id}'); toggleWishlist(false);">
            <div class="wishlist-item-info">
                <div class="wishlist-item-title">${escapeHtml(item.name)}</div>
                <div class="wishlist-item-price">${formatPrice(item.price)}</div>
                <div class="wishlist-item-actions">
                    <button class="wishlist-add-cart-btn" onclick="addWishlistItemToCart('${item._id}')">Add to Cart</button>
                    <button class="wishlist-remove-btn" onclick="removeWishlistItem('${item._id}')">Remove</button>
                </div>
            </div>
        </div>
    `).join('');
}

window.addWishlistItemToCart = function (productId) {
    const item = state.wishlist.find(w => w._id === productId);
    if (!item) return;
    const prodJson = encodeURIComponent(JSON.stringify(item));
    addToCart(productId, prodJson);
}

window.removeWishlistItem = function (productId) {
    state.wishlist = state.wishlist.filter(w => w._id !== productId);
    localStorage.setItem('glomek_wishlist', JSON.stringify(state.wishlist));
    updateWishlistBadge();
    renderWishlistSidebar();
    // Also update heart buttons on visible product cards
    renderProducts();
    showToast('Removed from saved items', 'info');
}

// ====== IMAGE ZOOM ON HOVER ====== //
function setupImageZoom() {
    const container = document.getElementById('pdMainImgContainer');
    const lens = document.getElementById('pdZoomLens');
    const result = document.getElementById('pdZoomResult');
    const img = document.getElementById('pdImage');
    if (!container || !lens || !result || !img) return;

    // Remove old listeners by cloning
    const newContainer = container;

    newContainer.addEventListener('mousemove', function (e) {
        if (window.innerWidth <= 1024) return; // Skip on mobile/tablet
        const rect = img.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const imgW = img.clientWidth;
        const imgH = img.clientHeight;

        if (x < 0 || y < 0 || x > imgW || y > imgH) {
            lens.style.display = 'none';
            result.style.display = 'none';
            return;
        }

        const lensW = lens.offsetWidth / 2;
        const lensH = lens.offsetHeight / 2;
        let lx = x - lensW;
        let ly = y - lensH;
        lx = Math.max(0, Math.min(lx, imgW - lens.offsetWidth));
        ly = Math.max(0, Math.min(ly, imgH - lens.offsetHeight));

        lens.style.left = lx + 'px';
        lens.style.top = ly + 'px';
        lens.style.display = 'block';

        // Show zoomed result
        const zoomFactor = 2.5;
        result.style.display = 'block';
        result.style.backgroundImage = `url(${img.src})`;
        result.style.backgroundSize = `${imgW * zoomFactor}px ${imgH * zoomFactor}px`;
        result.style.backgroundPosition = `-${lx * zoomFactor}px -${ly * zoomFactor}px`;
    });

    newContainer.addEventListener('mouseleave', function () {
        lens.style.display = 'none';
        result.style.display = 'none';
    });
}

// ====== RELATED PRODUCTS IN PRODUCT DETAIL ====== //
function renderRelatedProducts(product) {
    const section = document.getElementById('pdRelatedSection');
    const scroll = document.getElementById('pdRelatedScroll');
    if (!section || !scroll) return;

    // Find related products by same category
    let related = state.allProducts ? state.allProducts.filter(p => {
        const id = p._id || p.sId;
        const pid = product._id || product.sId;
        if (id === pid) return false; // Exclude current product
        // Match by category
        if (product.proCategoryId && p.proCategoryId) {
            const catA = typeof product.proCategoryId === 'object' ? product.proCategoryId._id : product.proCategoryId;
            const catB = typeof p.proCategoryId === 'object' ? p.proCategoryId._id : p.proCategoryId;
            return catA === catB;
        }
        return false;
    }) : [];

    // Fallback: take any products if no category match
    if (related.length < 4 && state.allProducts) {
        const pid = product._id || product.sId;
        const fallback = state.allProducts.filter(p => (p._id || p.sId) !== pid && !related.some(r => (r._id || r.sId) === (p._id || p.sId)));
        related = [...related, ...fallback].slice(0, 12);
    }
    related = related.slice(0, 12);

    if (related.length === 0) {
        section.hidden = true;
        return;
    }

    section.hidden = false;
    scroll.innerHTML = related.map(p => {
        const img = p.images && p.images.length > 0 ? p.images[0].url : '';
        const price = p.offerPrice || p.price || 0;
        return `
            <div class="pd-related-card" onclick="openProductDetails('${p._id || p.sId}')">
                <img src="${escapeHtml(img)}" alt="${escapeHtml(p.name)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=FALLBACK_IMAGE;">
                <div class="rv-title">${escapeHtml(p.name)}</div>
                <div class="rv-price">${formatPrice(price)}</div>
            </div>
        `;
    }).join('');
}

// ====== VARIANT / COLOR SELECTION ====== //
// ====== RECEIPT GENERATION & PDF DOWNLOAD ====== //

/**
 * The order id, in full, with a button to copy it.
 *
 * It used to be shown truncated to 12 characters and upper-cased. A database
 * id is 24 characters, so a customer quoting what they saw handed support only
 * half of it — and half an id cannot be looked up. Orders placed on the site
 * were effectively unfindable in the admin panel for that reason alone.
 */
function renderOrderIdValue(orderId) {
    const id = typeof orderId === 'string' ? orderId.trim() : '';

    if (!id) {
        return '<span class="value">Not available</span>';
    }

    return `<span class="value order-id-value">
        <code class="order-id-text">${escapeHtml(id)}</code>
        <button type="button" class="order-id-copy" data-order-id="${escapeHtml(id)}"
                title="Copy order ID" aria-label="Copy order ID">Copy</button>
    </span>`;
}

/** Copies an order id and confirms it, so the customer knows it worked. */
async function copyOrderId(id) {
    try {
        await navigator.clipboard.writeText(id);
        showToast('Order ID copied', 'success');
    } catch (err) {
        // Clipboard access is refused in some browsers unless the page is
        // focused, and over plain http. Selecting the text is the fallback.
        const el = document.querySelector(`.order-id-copy[data-order-id="${id}"]`)
            ?.previousElementSibling;
        if (el && window.getSelection) {
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }
        showToast('Select the ID and copy it', 'info');
    }
}

// Delegated, so it keeps working for receipts rendered after this point.
document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.order-id-copy');
    if (btn) copyOrderId(btn.dataset.orderId);
});

let lastReceiptData = null;

function showReceipt(orderData, orderRes) {
    const receiptData = {
        // The real database id, never an invented one. This used to fall back
        // to 'ORD-' + a timestamp when the response carried no data, which
        // handed the customer a reference that exists nowhere — support could
        // not find the order, because there was no such order.
        orderId: (orderRes && orderRes.data && (orderRes.data._id || orderRes.data.orderId)) || '',
        date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        paymentMethod: formatPaymentMethod(orderData.paymentMethod),
        items: orderData.items || [],
        subtotal: orderData.orderTotal ? orderData.orderTotal.subtotal : orderData.totalPrice,
        discount: orderData.orderTotal ? orderData.orderTotal.discount : 0,
        total: orderData.totalPrice,
        shippingAddress: orderData.shippingAddress || {},
        customerName: currentUser ? currentUser.name : 'Customer',
        customerEmail: currentUser ? currentUser.email : ''
    };

    lastReceiptData = receiptData;

    // Populate receipt meta
    document.getElementById('receiptMeta').innerHTML = `
        <div class="receipt-meta-item">
            <span class="label">Order ID</span>
            ${renderOrderIdValue(receiptData.orderId)}
        </div>
        <div class="receipt-meta-item">
            <span class="label">Date</span>
            <span class="value">${receiptData.date} at ${receiptData.time}</span>
        </div>
        <div class="receipt-meta-item">
            <span class="label">Payment</span>
            <span class="value">${receiptData.paymentMethod}</span>
        </div>
        <div class="receipt-meta-item">
            <span class="label">Customer</span>
            <span class="value">${escapeHtml(receiptData.customerName)}</span>
        </div>
    `;

    // Populate receipt items
    document.getElementById('receiptItems').innerHTML = receiptData.items.map(item => `
        <div class="receipt-item-row">
            <div class="receipt-item-info">
                <div class="receipt-item-name">${escapeHtml(item.productName || item.name || 'Item')}</div>
                <div class="receipt-item-qty">Qty: ${item.quantity}</div>
            </div>
            <div class="receipt-item-price">${formatPrice(item.price * item.quantity)}</div>
        </div>
    `).join('');

    // Populate receipt totals
    let totalsHtml = `
        <div class="receipt-total-row">
            <span>Subtotal</span>
            <span>${formatPrice(receiptData.subtotal)}</span>
        </div>
    `;
    if (receiptData.discount > 0) {
        totalsHtml += `
            <div class="receipt-total-row" style="color:#007600;">
                <span>Discount</span>
                <span>-${formatPrice(receiptData.discount)}</span>
            </div>
        `;
    }
    totalsHtml += `
        <div class="receipt-total-row">
            <span>Delivery</span>
            <span style="color:#007600;">Free</span>
        </div>
        <div class="receipt-total-row final">
            <span>Total</span>
            <span>${formatPrice(receiptData.total)}</span>
        </div>
    `;
    document.getElementById('receiptTotals').innerHTML = totalsHtml;

    // Populate shipping address
    const addr = receiptData.shippingAddress;
    // Every field here is typed by the customer at checkout, so all of it is
    // untrusted on the way back out.
    document.getElementById('receiptShipping').innerHTML = `
        <strong>Delivery Address</strong>
        <p>${escapeHtml(addr.street || '')}, ${escapeHtml(addr.city || '')}<br>
        ${escapeHtml(addr.state || '')} ${escapeHtml(addr.postalCode || '')}<br>
        ${escapeHtml(addr.country || 'Ghana')}${addr.phone && addr.phone !== 'N/A' ? '<br>Tel: ' + escapeHtml(addr.phone) : ''}</p>
    `;

    openModal('receiptModal');
}

function formatPaymentMethod(method) {
    const map = {
        'paystack_momo': 'Mobile Money (Paystack)',
        'paystack_card': 'Card (Paystack)',
        'paystack': 'Paystack',
        // Legacy orders placed before the switch to Paystack-only checkout.
        'mtn_mobile_money': 'MTN Mobile Money',
        'cash_on_delivery': 'Cash on Delivery'
    };
    return map[method] || method;
}

// ====== PDF RECEIPT DOWNLOAD (jsPDF) ====== //
window.downloadReceiptPDF = function () {
    if (!lastReceiptData) return showToast('No receipt data available.', 'warning');

    if (!window.jspdf || !window.jspdf.jsPDF) {
        return showToast('PDF library not loaded. Please wait a moment and try again.', 'error');
    }
    const { jsPDF } = window.jspdf;

    const img = new Image();
    const isPages = window.location.pathname.includes('/pages/');
    img.src = isPages ? '../assets/logo/Glomek%20App%20Logo2.png' : 'assets/logo/Glomek%20App%20Logo2.png';

    img.onload = function() {
        const doc = new jsPDF('p', 'mm', 'a4');
        const data = lastReceiptData;
        const pageW = doc.internal.pageSize.getWidth();
        const margin = 20;
        const contentW = pageW - margin * 2;
        let y = 0;

        // ── Orange Header Banner ──
        doc.setFillColor(246, 139, 30);
        doc.rect(0, 0, pageW, 42, 'F');

        // Draw Image (Centered)
        // Image aspect ratio: depends on logo. We'll use 40x40 or proportionate.
        // Assuming it's roughly square or horizontal.
        const imgW = 30;
        const imgH = 30;
        doc.addImage(img, 'PNG', (pageW / 2) - (imgW / 2), 5, imgW, imgH);

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text('Order Receipt', pageW / 2, 38, { align: 'center' });

        y = 52;

        // ── Order Meta Grid ──
        doc.setFillColor(247, 248, 248);
        doc.roundedRect(margin, y, contentW, 28, 3, 3, 'F');

        // Full id, not the first 12 characters: this is the reference a customer
    // quotes to support, and half of one cannot be looked up.
    const orderId = typeof data.orderId === 'string' ? data.orderId : (data.orderId || '');
        const metaItems = [
            ['Order ID', '#' + orderId],
            ['Date', data.date],
            ['Payment', data.paymentMethod],
            ['Customer', data.customerName]
        ];

        const colW = contentW / 4;
        metaItems.forEach((item, i) => {
            const x = margin + colW * i + 6;
            doc.setFontSize(7);
            doc.setTextColor(150, 150, 150);
            doc.setFont('helvetica', 'normal');
            doc.text(item[0].toUpperCase(), x, y + 10);

            doc.setFontSize(9);
            doc.setTextColor(15, 17, 17);
            doc.setFont('helvetica', 'bold');
            // Truncate if too long
            const val = item[1].length > 18 ? item[1].substring(0, 17) + '...' : item[1];
            doc.text(val, x, y + 18);
        });

        y += 36;

        // ── Items Table Header ──
        doc.setFillColor(240, 240, 240);
        doc.rect(margin, y, contentW, 8, 'F');
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.setFont('helvetica', 'bold');
        doc.text('ITEM', margin + 4, y + 5.5);
        doc.text('QTY', margin + contentW - 45, y + 5.5, { align: 'center' });
        doc.text('AMOUNT', margin + contentW - 4, y + 5.5, { align: 'right' });

        y += 10;

        // ── Items Rows ──
        doc.setFont('helvetica', 'normal');
        const items = data.items || [];
        items.forEach((item, idx) => {
            const itemName = (item.productName || item.name || 'Item');
            const displayName = itemName.length > 40 ? itemName.substring(0, 39) + '...' : itemName;
            const amount = 'GHS ' + ((item.price || 0) * (item.quantity || 1)).toFixed(2);

            doc.setFontSize(9);
            doc.setTextColor(51, 51, 51);
            doc.text(displayName, margin + 4, y + 5);

            doc.setTextColor(100, 100, 100);
            doc.text(String(item.quantity), margin + contentW - 45, y + 5, { align: 'center' });

            doc.setTextColor(15, 17, 17);
            doc.setFont('helvetica', 'bold');
            doc.text(amount, margin + contentW - 4, y + 5, { align: 'right' });
            doc.setFont('helvetica', 'normal');

            // Divider line
            doc.setDrawColor(240, 240, 240);
            doc.line(margin, y + 8, margin + contentW, y + 8);

            y += 10;

            // Page break check
            if (y > 260) {
                doc.addPage();
                y = 20;
            }
        });

        y += 4;

        // ── Dashed divider ──
        doc.setDrawColor(200, 200, 200);
        doc.setLineDashPattern([2, 2], 0);
        doc.line(margin, y, margin + contentW, y);
        doc.setLineDashPattern([], 0);

        y += 8;

        // ── Totals ──
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 100);
        doc.setFont('helvetica', 'normal');
        doc.text('Subtotal', margin + 4, y);
        doc.text('GHS ' + data.subtotal.toFixed(2), margin + contentW - 4, y, { align: 'right' });
        y += 7;

        if (data.discount > 0) {
            doc.setTextColor(0, 118, 0);
            doc.text('Discount', margin + 4, y);
            doc.text('-GHS ' + data.discount.toFixed(2), margin + contentW - 4, y, { align: 'right' });
            y += 7;
        }

        doc.setTextColor(0, 118, 0);
        doc.text('Delivery', margin + 4, y);
        doc.text('Free', margin + contentW - 4, y, { align: 'right' });
        y += 4;

        // Total line
        doc.setDrawColor(220, 220, 220);
        doc.line(margin, y, margin + contentW, y);
        y += 7;

        doc.setFontSize(13);
        doc.setTextColor(15, 17, 17);
        doc.setFont('helvetica', 'bold');
        doc.text('Total', margin + 4, y);
        doc.text('GHS ' + data.total.toFixed(2), margin + contentW - 4, y, { align: 'right' });

        y += 12;

        // ── Shipping Address ──
        doc.setFillColor(247, 248, 248);
        const addrH = 28;
        doc.roundedRect(margin, y, contentW, addrH, 3, 3, 'F');

        doc.setFontSize(9);
        doc.setTextColor(15, 17, 17);
        doc.setFont('helvetica', 'bold');
        doc.text('Delivery Address', margin + 8, y + 8);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(86, 89, 89);
        const addr = data.shippingAddress;
        const addrLine1 = (addr.street || '') + ', ' + (addr.city || '');
        const addrLine2 = (addr.state || '') + ' ' + (addr.postalCode || '') + ', ' + (addr.country || 'Ghana');
        doc.text(addrLine1, margin + 8, y + 15);
        doc.text(addrLine2, margin + 8, y + 21);

        y += addrH + 10;

        // ── Footer ──
        doc.setDrawColor(200, 200, 200);
        doc.setLineDashPattern([2, 2], 0);
        doc.line(margin, y, margin + contentW, y);
        doc.setLineDashPattern([], 0);
        y += 8;

        doc.setFontSize(9);
        doc.setTextColor(120, 120, 120);
        doc.setFont('helvetica', 'normal');
        doc.text('Thank you for shopping with Glomek!', pageW / 2, y, { align: 'center' });
        y += 6;
        doc.setFontSize(8);
        doc.text('Support: +233 543 791 625 | support@glomek.com', pageW / 2, y, { align: 'center' });
        y += 5;
        doc.text('\u00A9 2026 Glomek.com, Inc.', pageW / 2, y, { align: 'center' });

        // ── Save the PDF ──
        const fileName = 'Glomek_Receipt_' + orderId + '.pdf';
        doc.save(fileName);
        showToast('Receipt downloaded as PDF!', 'success');
    };

    img.onerror = function() {
        showToast('Error loading logo for receipt.', 'error');
    };
}

// ====== DOWNLOAD PAST ORDER AS PDF ====== //
window.downloadOrderPDF = function(order) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        showToast('PDF library not loaded. Please wait or refresh the page.', 'error');
        return;
    }
    const { jsPDF } = window.jspdf;

    const img = new Image();
    const isPages = window.location.pathname.includes('/pages/');
    img.src = isPages ? '../assets/logo/Glomek%20App%20Logo2.png' : 'assets/logo/Glomek%20App%20Logo2.png';

    img.onload = function() {
        const doc = new jsPDF('p', 'mm', 'a4');
        const pageW = doc.internal.pageSize.getWidth();
        const margin = 20;
        const contentW = pageW - margin * 2;
        let y = 0;

        // Orange Header Banner
        doc.setFillColor(246, 139, 30);
        doc.rect(0, 0, pageW, 42, 'F');
        
        // Draw Image (Centered)
        const imgW = 30;
        const imgH = 30;
        doc.addImage(img, 'PNG', (pageW / 2) - (imgW / 2), 5, imgW, imgH);

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text('Order Receipt', pageW / 2, 38, { align: 'center' });

        y = 52;

        // Order Meta Grid
        doc.setFillColor(247, 248, 248);
        doc.roundedRect(margin, y, contentW, 28, 3, 3, 'F');
        
        const date = new Date(order.createdAt || Date.now()).toLocaleDateString('en-GB');
        const metaItems = [
            ['Order ID', order._id || 'Not available'],
            ['Date', date],
            ['Payment', formatPaymentMethod(order.paymentMethod)],
            ['Customer', (currentUser && currentUser.name) ? currentUser.name : 'Customer']
        ];

        const colW = contentW / 4;
        metaItems.forEach((item, i) => {
            const x = margin + colW * i + 6;
            doc.setFontSize(7);
            doc.setTextColor(150, 150, 150);
            doc.setFont('helvetica', 'normal');
            doc.text(item[0].toUpperCase(), x, y + 10);
            doc.setFontSize(9);
            doc.setTextColor(15, 17, 17);
            doc.setFont('helvetica', 'bold');
            const val = (item[1] || '').length > 18 ? (item[1] || '').substring(0, 17) + '...' : item[1] || 'N/A';
            doc.text(val, x, y + 18);
        });

        y += 36;

        // Items Table Header
        doc.setFillColor(240, 240, 240);
        doc.rect(margin, y, contentW, 8, 'F');
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.setFont('helvetica', 'bold');
        doc.text('ITEM', margin + 4, y + 5.5);
        doc.text('QTY', margin + contentW - 45, y + 5.5, { align: 'center' });
        doc.text('AMOUNT', margin + contentW - 4, y + 5.5, { align: 'right' });

        y += 10;

        // Items Rows
        doc.setFont('helvetica', 'normal');
        const items = order.items || [];
        items.forEach((item) => {
            const itemName = (item.productName || item.name || 'Item');
            const displayName = itemName.length > 40 ? itemName.substring(0, 39) + '...' : itemName;
            const amount = 'GHS ' + ((item.price || 0) * (item.quantity || 1)).toFixed(2);

            doc.setFontSize(9);
            doc.setTextColor(51, 51, 51);
            doc.text(displayName, margin + 4, y + 5);

            doc.setTextColor(100, 100, 100);
            doc.text(String(item.quantity || 1), margin + contentW - 45, y + 5, { align: 'center' });

            doc.setTextColor(15, 17, 17);
            doc.setFont('helvetica', 'bold');
            doc.text(amount, margin + contentW - 4, y + 5, { align: 'right' });
            doc.setFont('helvetica', 'normal');

            doc.setDrawColor(240, 240, 240);
            doc.line(margin, y + 8, margin + contentW, y + 8);
            y += 10;

            if (y > 260) { doc.addPage(); y = 20; }
        });

        y += 4;
        doc.setDrawColor(200, 200, 200);
        doc.setLineDashPattern([2, 2], 0);
        doc.line(margin, y, margin + contentW, y);
        doc.setLineDashPattern([], 0);
        y += 8;

        // Totals
        const sub = order.orderTotal ? order.orderTotal.subtotal : order.totalPrice;
        const disc = order.orderTotal ? order.orderTotal.discount : 0;
        const tot = order.orderTotal ? order.orderTotal.total : order.totalPrice;

        doc.setFontSize(9);
        doc.setTextColor(100, 100, 100);
        doc.setFont('helvetica', 'normal');
        doc.text('Subtotal', margin + 4, y);
        doc.text('GHS ' + (sub || 0).toFixed(2), margin + contentW - 4, y, { align: 'right' });
        y += 7;

        if (disc > 0) {
            doc.setTextColor(0, 118, 0);
            doc.text('Discount', margin + 4, y);
            doc.text('-GHS ' + disc.toFixed(2), margin + contentW - 4, y, { align: 'right' });
            y += 7;
        }

        doc.setTextColor(0, 118, 0);
        doc.text('Delivery', margin + 4, y);
        doc.text('Free', margin + contentW - 4, y, { align: 'right' });
        y += 4;

        doc.setDrawColor(220, 220, 220);
        doc.line(margin, y, margin + contentW, y);
        y += 7;

        doc.setFontSize(13);
        doc.setTextColor(15, 17, 17);
        doc.setFont('helvetica', 'bold');
        doc.text('Total', margin + 4, y);
        doc.text('GHS ' + (tot || 0).toFixed(2), margin + contentW - 4, y, { align: 'right' });
        y += 12;

        // Shipping Address
        if (order.shippingAddress) {
            doc.setFillColor(247, 248, 248);
            const addrH = 28;
            doc.roundedRect(margin, y, contentW, addrH, 3, 3, 'F');
            doc.setFontSize(9);
            doc.setTextColor(15, 17, 17);
            doc.setFont('helvetica', 'bold');
            doc.text('Delivery Address', margin + 8, y + 8);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8.5);
            doc.setTextColor(86, 89, 89);
            const addr = order.shippingAddress;
            const addrLine1 = (addr.street || '') + ', ' + (addr.city || '');
            const addrLine2 = (addr.state || '') + ' ' + (addr.postalCode || '') + ', ' + (addr.country || 'Ghana');
            doc.text(addrLine1, margin + 8, y + 15);
            doc.text(addrLine2, margin + 8, y + 21);
            y += addrH + 10;
        }

        doc.setDrawColor(200, 200, 200);
        doc.setLineDashPattern([2, 2], 0);
        doc.line(margin, y, margin + contentW, y);
        doc.setLineDashPattern([], 0);
        y += 8;

        doc.setFontSize(9);
        doc.setTextColor(120, 120, 120);
        doc.setFont('helvetica', 'normal');
        doc.text('Thank you for shopping with Glomek!', pageW / 2, y, { align: 'center' });
        
        doc.save('Glomek_Receipt_' + (order._id || 'unknown').substring(0, 12) + '.pdf');
        showToast('Receipt downloaded as PDF!', 'success');
    };

    img.onerror = function() {
        showToast('Error loading logo. Please check connection.', 'error');
    };
}

// ====== DYNAMIC PAGE TITLE (Industry Standard) ====== //
function updatePageTitle() {
    const cartCount = state.cart.length;
    const base = 'Glomek — Shop Premium Products Online';
    if (state.searchKeyword) {
        document.title = `"${state.searchKeyword}" — Search Results | Glomek`;
    } else if (state.selectedCategoryId) {
        const cat = state.categories.find(c => c._id === state.selectedCategoryId);
        document.title = cat ? `${cat.name} — Glomek` : base;
    } else {
        document.title = cartCount > 0 ? `(${cartCount}) ${base}` : base;
    }
}

// ====== ACCESSIBILITY (Industry Standard) ====== //
function setupAccessibility() {
    // Add ARIA labels to interactive buttons
    const ariaMap = [
        ['#cartToggleBtn', 'Open shopping cart'],
        ['#wishlistToggleBtn', 'Open saved items'],
        ['.user-btn', 'Open account menu'],
        ['#closeCartBtn', 'Close cart'],
        ['#closeWishlistBtn', 'Close saved items'],
        ['#backToTopFab', 'Scroll back to top'],
        ['.search-submit-btn', 'Search products'],
        ['#clearSearchBtn', 'Clear search'],
        ['#pdShareBtn', 'Share this product'],
        ['#pdAddToCartBtn', 'Add this product to your cart'],
        ['#pdBuyNowBtn', 'Buy this product now'],
        ['#checkoutBtn', 'Proceed to secure checkout'],
    ];
    ariaMap.forEach(([sel, label]) => {
        const el = document.querySelector(sel);
        if (el) {
            el.setAttribute('aria-label', label);
            if (!el.getAttribute('role') && el.tagName !== 'BUTTON') el.setAttribute('role', 'button');
        }
    });

    // Placeholders are not labels: a screen reader loses them the moment the
    // customer types. Give every bare input an accessible name.
    const inputLabels = {
        searchInput: 'Search products on Glomek',
        priceMin: 'Minimum price',
        priceMax: 'Maximum price',
        sortSelect: 'Sort products by',
        authName: 'Full name',
        authEmail: 'Email address',
        authPassword: 'Password',
        resetEmail: 'Email address',
        resetOtp: 'Six-digit verification code',
        resetNewPassword: 'New password',
        chkPhone: 'Delivery phone number',
        chkAddress: 'Street address',
        chkCity: 'City',
        chkState: 'State or region',
        chkPostalCode: 'Postal code',
        chkCountry: 'Country',
        chkCoupon: 'Coupon code',
        reviewText: 'Write your review',
    };
    Object.entries(inputLabels).forEach(([id, label]) => {
        const el = document.getElementById(id);
        if (el && !el.getAttribute('aria-label')) el.setAttribute('aria-label', label);
    });

    // Live region so toasts are announced rather than appearing silently.
    const toastContainer = document.getElementById('toastContainer');
    if (toastContainer) {
        toastContainer.setAttribute('role', 'status');
        toastContainer.setAttribute('aria-live', 'polite');
        toastContainer.setAttribute('aria-atomic', 'false');
    }

    // The product grid updates asynchronously — announce result counts.
    const countText = document.getElementById('productCountText');
    if (countText) {
        countText.setAttribute('role', 'status');
        countText.setAttribute('aria-live', 'polite');
    }

    // Escape closes the sidebars. Modals are handled by the stack-based
    // listener in MODAL UTILS — duplicating it here would close two layers
    // on a single keypress.
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (modalStack.length > 0) return; // a modal is on top; let it win

        if (UI.cartSidebar.classList.contains('open')) { toggleCart(false); return; }
        const ws = document.getElementById('wishlistSidebar');
        if (ws && ws.classList.contains('open')) { toggleWishlist(false); }
    });
}

// ====== OFFLINE / ONLINE DETECTION (Industry Standard) ====== //
function setupOfflineDetection() {
    let offlineBanner = null;

    function showOfflineBanner() {
        if (offlineBanner) return;
        offlineBanner = document.createElement('div');
        offlineBanner.id = 'offlineBanner';
        offlineBanner.className = 'offline-banner';
        offlineBanner.innerHTML = `
            <span class="material-symbols-rounded" style="font-size:18px;">wifi_off</span>
            <span>You're offline. Check your connection.</span>
        `;
        document.body.prepend(offlineBanner);
        requestAnimationFrame(() => offlineBanner.classList.add('visible'));
    }

    function hideOfflineBanner() {
        if (!offlineBanner) return;
        offlineBanner.classList.remove('visible');
        setTimeout(() => {
            if (offlineBanner) { offlineBanner.remove(); offlineBanner = null; }
        }, 400);
        showToast('You\'re back online!', 'success');
    }

    window.addEventListener('offline', showOfflineBanner);
    window.addEventListener('online', hideOfflineBanner);
    if (!navigator.onLine) showOfflineBanner();
}

// ====== NETWORK ERROR RETRY (Industry Standard) ====== //
function showNetworkError() {
    UI.productGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align:center; padding: 3rem 1rem;">
            <span class="material-symbols-rounded" style="font-size:3.5rem; color:#ccc; display:block; margin-bottom:1rem;">cloud_off</span>
            <h3 style="font-size:1.2rem; color:#0f1111; margin-bottom:0.5rem;">Something went wrong</h3>
            <p style="color:#565959; margin-bottom:1.5rem;">Please check your internet connection and try again.</p>
            <button onclick="retryLoadProducts()" class="checkout-btn" style="width:auto; padding: 0.6rem 2rem; display:inline-flex; align-items:center; gap:8px;">
                <span class="material-symbols-rounded" style="font-size:20px;">refresh</span>
                Try Again
            </button>
        </div>
    `;
}

window.retryLoadProducts = function() {
    state.isLoading = false;
    state.currentPage = 1;
    loadProducts();
}
