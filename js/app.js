document.addEventListener('DOMContentLoaded', () => {
    initApp();
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
    selectedSubCategoryId: null,
    sortBy: 'featured',
    priceMin: null,
    priceMax: null,
    wishlist: JSON.parse(localStorage.getItem('glomek_wishlist') || '[]'),
    recentlyViewed: JSON.parse(localStorage.getItem('glomek_recently_viewed') || '[]')
};

// ====== UTILS ====== //
function escapeHtml(unsafe) {
    if (!unsafe) return '';
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
        <span class="toast-msg">${message}</span>
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

async function initApp() {
    setupEventListeners();
    await loadInitialData();
    renderGoogleButton();
}

function renderGoogleButton() {
    const container = document.getElementById("googleSignInBtnContainer");
    if (!container) return;

    if (window.google && window.google.accounts && GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.startsWith('YOUR_')) {
        window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleGoogleCredentialResponse
        });
        window.google.accounts.id.renderButton(container, { theme: "outline", size: "large", type: "standard" });
    } else {
        // Fallback: render a styled Google button that shows a prompt
        container.innerHTML = `
            <button type="button" class="google-signin-btn" onclick="handleFallbackGoogleLogin()">
                <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                <span>Sign in with Google</span>
            </button>
        `;
    }
}

async function handleGoogleCredentialResponse(response) {
    if (!response || !response.credential) return;
    try {
        const payload = JSON.parse(atob(response.credential.split('.')[1]));
        const { email, name } = payload;
        await performGoogleLogin(email, name);
    } catch (err) {
        console.error("Google Auth error:", err);
        showToast("Unable to complete Google Auth.", "error");
    }
}

window.handleFallbackGoogleLogin = function () {
    // Prompt-based fallback when no Client ID is configured
    const email = prompt('Enter your Google email address:');
    if (!email || !email.includes('@')) return showToast('Please enter a valid email.', 'warning');
    const name = email.split('@')[0];
    performGoogleLogin(email, name);
}

async function performGoogleLogin(email, name) {
    const btn = document.getElementById('authSubmitBtn');
    if (btn) { btn.textContent = "Please wait..."; btn.disabled = true; }
    try {
        const res = await ApiService.googleLogin(email, name);
        if (res && res.success) {
            currentUser = res.data;
            if (res.token) userToken = res.token; // keep in memory only, cookie is set by server
            localStorage.setItem('glomek_user', JSON.stringify(currentUser));
            closeModal('authModal');
            updateUserUI();
            state.recommendations = await ApiService.fetchRecommendations(currentUser._id);
            showToast("Google login successful!", "success");
        } else {
            showToast(res.message || "Google Login failed.", "error");
        }
    } catch (err) {
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

        if (q.length >= 2) {
            // 2) Category matches
            state.categories.forEach(cat => {
                if (cat.name && cat.name.toLowerCase().includes(q) && suggestions.length < 12) {
                    // Avoid duplicates
                    if (!suggestions.some(s => s.text.toLowerCase() === cat.name.toLowerCase())) {
                        suggestions.push({ type: 'category', text: cat.name, icon: 'category', category: 'in Categories' });
                    }
                }
            });

            // 3) Product name matches (from already-loaded products)
            const seenNames = new Set();
            const allProds = state.allProducts || state.products || [];
            allProds.forEach(p => {
                if (suggestions.length >= 12) return;
                if (p.name && p.name.toLowerCase().includes(q)) {
                    // Use a simplified/shortened version for suggestion
                    const shortName = p.name.length > 60 ? p.name.substring(0, 57) + '...' : p.name;
                    const key = shortName.toLowerCase();
                    if (!seenNames.has(key) && !suggestions.some(s => s.text.toLowerCase() === key)) {
                        seenNames.add(key);
                        const catName = p.proCategoryId ? (p.proCategoryId.name || '') : '';
                        suggestions.push({ type: 'product', text: shortName, fullText: p.name, icon: 'search', category: catName ? `in ${catName}` : '' });
                    }
                }
            });
        }

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
                } else if (s.type === 'product' && lastType !== 'product') {
                    html += `<div class="search-suggestions-divider">Products</div>`;
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
                <div class="search-suggestion-item" data-index="${idx}" data-text="${escapeHtml(s.fullText || s.text)}"
                     onclick="window._selectSuggestion('${escapeHtml(s.fullText || s.text)}')">
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

    // Infinite Scroll + Back to Top FAB
    const fab = document.getElementById('backToTopFab');
    window.addEventListener('scroll', () => {
        if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 200) {
            if (!state.isLoading && state.hasMore) {
                state.currentPage++;
                loadProducts(true);
            }
        }
        // Back to top FAB visibility
        if (fab) {
            fab.classList.toggle('visible', window.scrollY > 600);
        }
    });

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

async function loadProducts(isPagination = false) {
    if (state.isLoading) return;
    state.isLoading = true;
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

        const oldRecs = document.getElementById('recsGrid');
        if (oldRecs) oldRecs.remove();
        const oldTitle = document.querySelector('.recommendations-title');
        if (oldTitle) oldTitle.style.display = 'none';
    } else {
        UI.loadingMore.hidden = false;
    }

    const fetchedProducts = await ApiService.fetchProducts(state.currentPage, 50, state.searchKeyword);

    // Network error check — show retry UI if offline and no results
    if (!fetchedProducts || (fetchedProducts.length === 0 && !navigator.onLine)) {
        showNetworkError();
        state.isLoading = false;
        hideSearchLoading();
        return;
    }

    if (isPagination) {
        state.allProducts = [...state.allProducts, ...fetchedProducts];
    } else {
        state.allProducts = fetchedProducts;
    }

    let filteredList = state.allProducts;

    if (state.selectedCategoryId) {
        const cat = state.categories.find(c => c._id === state.selectedCategoryId);
        if (cat) {
            filteredList = filteredList.filter(p => p.proCategoryId && (p.proCategoryId.name === cat.name || p.proCategoryId._id === cat._id));
        }
    }

    if (state.selectedSubCategoryId) {
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
    state.hasMore = fetchedProducts.length >= 50;

    // Update product count text
    updateProductCount();
    // Update breadcrumbs
    updateBreadcrumbs();

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

    // Auto-scroll to results when searching (industry standard)
    if (state.searchKeyword && !isPagination) {
        const prodSec = document.querySelector('.products-section');
        if (prodSec) setTimeout(() => prodSec.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    }

    // Update page title with context
    updatePageTitle();
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
            matchingSubs.map(s => `<div class="subcategory-pill" onclick="filterBySubCategory('${s._id}', event)">${s.name}</div>`).join('') :
            '<span style="color:var(--text-secondary);font-size:0.9rem;padding:0.5rem 1rem;">No subcategories found</span>';
    } else {
        UI.subcategoryList.hidden = true;
        UI.subcategoryList.innerHTML = '';
    }

    state.currentPage = 1;
    await loadProducts();

    const prodSec = document.querySelector('.products-section');
    if (prodSec) setTimeout(() => prodSec.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
}

window.filterBySubCategory = async function (subCatId, event) {
    document.querySelectorAll('.subcategory-pill').forEach(el => el.classList.remove('active'));
    if (event && event.target) event.target.classList.add('active');

    state.selectedSubCategoryId = subCatId;
    state.currentPage = 1;
    await loadProducts();

    const prodSec = document.querySelector('.products-section');
    if (prodSec) setTimeout(() => prodSec.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
}

function renderCategories() {
    UI.categoryList.innerHTML = `<div class="category-pill ${!state.selectedCategoryId ? 'active' : ''}" onclick="filterByCategory(null)">All Products</div>` +
        state.categories.map(c => `<div class="category-pill ${state.selectedCategoryId === c._id ? 'active' : ''}" onclick="filterByCategory('${c._id}')">${c.name}</div>`).join('');
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
                    <img src="${imgUrl}" class="poster-image" alt="${p.posterName || 'Promotion'}" />
                    <div class="poster-overlay-gradient"></div>
                    <div class="poster-overlay-content">
                        ${p.posterName ? `<h2 class="poster-title">${p.posterName}</h2>` : ''}
                        ${p.discountText ? `<span class="poster-discount-tag">${p.discountText}</span>` : ''}
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

    const prodSec = document.querySelector('.products-section');
    if (prodSec) setTimeout(() => prodSec.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
}

function renderProducts() {
    UI.productGrid.innerHTML = state.products.map(p => createProductCardHTML(p)).join('');
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
        oldPriceHTML = `<div class="jumia-old-price">${formatPrice(product.price)}</div>`;
    }

    return `
        <div class="product-card jumia-card" onclick="openProductDetails('${productId}')">
            <div class="product-image-container jumia-img-container">
                <button class="wishlist-heart-btn ${isWishlisted ? 'active' : ''}" onclick="toggleWishlistItem(event, '${productId}', '${encodeURIComponent(product.name)}', ${price}, '${encodeURIComponent(defaultImage)}')" title="${isWishlisted ? 'Remove from Saved' : 'Save for Later'}">
                    <span class="material-symbols-rounded">${isWishlisted ? 'favorite' : 'favorite_border'}</span>
                </button>
                <img src="${defaultImage}" alt="${product.name}" class="product-image" loading="lazy">
                ${discountHTML}
            </div>
            <div class="product-info jumia-info">
                <h3 class="product-title jumia-title" title="${product.name}">${product.name}</h3>
                <div class="product-price jumia-price">${formatPrice(price)}</div>
                ${oldPriceHTML}
            </div>
        </div>
    `;
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
                    <img src="${item.image}" class="cart-item-img" alt="${item.name}">
                    <div class="cart-item-details">
                        <div class="cart-item-title">${item.name}</div>
                        <div class="cart-item-price">${formatPrice(item.price)}</div>
                        <div class="cart-item-actions">
                            <div class="qty-controls">
                                <button class="qty-btn" onclick="updateQty('${item.productId}', -1)"><span class="material-symbols-rounded" style="font-size:16px;">remove</span></button>
                                <input type="number" class="qty-input" value="${item.quantity}" min="1" onchange="setQty('${item.productId}', this.value)" onkeydown="if(event.key==='Enter'){this.blur()}">
                                <button class="qty-btn" onclick="updateQty('${item.productId}', 1)"><span class="material-symbols-rounded" style="font-size:16px;">add</span></button>
                            </div>
                            <button class="delete-btn" onclick="deleteFromCart('${item.productId}')" title="Remove"><span class="material-symbols-rounded">delete</span></button>
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
}

function toggleCart(show) {
    if (show) {
        UI.cartSidebar.classList.add('open');
        UI.cartOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    } else {
        UI.cartSidebar.classList.remove('open');
        UI.cartOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }
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
// JWT token is stored in HTTP-only cookie by the server — we only keep a memory reference
// for the Authorization header fallback (used by mobile). Never persisted to localStorage.
let userToken = null;
let currentUser = JSON.parse(localStorage.getItem('glomek_user'));
let isLoginMode = true;

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
                userToken = res.token; // keep in memory only, cookie is set by server
                currentUser = res.data;
                localStorage.setItem('glomek_user', JSON.stringify(currentUser));
                closeModal('authModal');
                updateUserUI();
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
    userToken = null;
    localStorage.removeItem('glomek_user');
    closeModal('profileModal');
    showToast("Successfully logged out.", "success");
}

async function loadOrderHistory() {
    const historyDiv = document.getElementById('orderHistory');
    historyDiv.innerHTML = '<p style="color:var(--text-secondary)">Loading your orders...</p>';

    if (!currentUser || !currentUser._id) return;

    const orders = await ApiService.fetchUserOrders(currentUser._id, userToken);
    if (orders.length === 0) {
        historyDiv.innerHTML = '<p style="color:var(--text-secondary)">No recent orders found.</p>';
        return;
    }

    historyDiv.innerHTML = orders.map(o => {
        const date = o.orderDate ? new Date(o.orderDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A';
        const statusClass = o.orderStatus || 'pending';
        const itemsHtml = (o.items || []).map(item => `
            <div style="display:flex; justify-content:space-between; font-size:0.85rem; color:var(--text-secondary); padding: 2px 0;">
                <span>${item.productName || 'Item'} x${item.quantity}</span>
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
let appliedCouponConfig = null;

if (UI.checkoutBtn) {
    UI.checkoutBtn.addEventListener('click', () => {
        if (!currentUser) {
            showToast("Please login before checking out.", "warning");
            toggleCart(false);
            openModal('authModal');
            return;
        }

        const total = state.cart.reduce((a, b) => a + (b.price * b.quantity), 0);
        document.getElementById('checkoutAmount').textContent = formatPrice(total);
        toggleCart(false);
        openModal('checkoutModal');
    });
}

window.applyCoupon = async function () {
    const code = document.getElementById('chkCoupon').value.trim();
    if (!code) return showToast("Enter a coupon code first.", "warning");

    const total = state.cart.reduce((a, b) => a + (b.price * b.quantity), 0);
    const pIds = state.cart.map(i => i.productId);

    const res = await ApiService.checkCoupon(code, total, pIds);
    if (res.success) {
        appliedCouponConfig = res.data;
        showToast("Coupon applied successfully!", "success");
        const newTotal = total - appliedCouponConfig.discountAmount;
        document.getElementById('checkoutAmount').textContent = formatPrice(newTotal < 0 ? 0 : newTotal);
    } else {
        showToast(res.message || "Invalid or inapplicable coupon.", "error");
    }
}

window.togglePaymentFields = function () {
    const pm = document.getElementById('chkPaymentMethod').value;
    const momoSection = document.getElementById('momoFieldSection');
    const chkPhone = document.getElementById('chkPhone');
    const codNotice = document.getElementById('codNotice');

    if (pm === 'mtn_mobile_money') {
        momoSection.style.display = 'flex';
        chkPhone.required = true;
        if (codNotice) codNotice.style.display = 'none';
    } else if (pm === 'cash_on_delivery') {
        momoSection.style.display = 'none';
        chkPhone.required = false;
        chkPhone.value = '';
        if (codNotice) codNotice.style.display = 'block';
    } else {
        momoSection.style.display = 'none';
        chkPhone.required = false;
        chkPhone.value = '';
        if (codNotice) codNotice.style.display = 'none';
    }
}

window.handleCheckoutSubmit = async function (e) {
    e.preventDefault();
    const paymentMethod = document.getElementById('chkPaymentMethod').value;
    const phone = document.getElementById('chkPhone').value;
    const street = document.getElementById('chkAddress').value;
    const city = document.getElementById('chkCity').value;
    const addrState = document.getElementById('chkState').value;
    const postalCode = document.getElementById('chkPostalCode').value;
    const country = document.getElementById('chkCountry').value;

    const btn = document.getElementById('payBtn');
    btn.textContent = "Processing Payment...";
    btn.disabled = true;

    const subtotal = state.cart.reduce((a, b) => a + (b.price * b.quantity), 0);
    const discountAmount = appliedCouponConfig ? appliedCouponConfig.discountAmount : 0;
    const finalAmount = Math.max(0, subtotal - discountAmount);

    const orderItems = state.cart.map(i => ({
        productID: i.productId,
        productName: i.name,
        quantity: i.quantity,
        price: i.price
    }));

    const shippingAddress = { phone: phone || 'N/A', street, city, state: addrState, postalCode, country: country || 'Ghana' };

    try {
        if (paymentMethod === 'mtn_mobile_money') {
            // Step 1: Initiate MoMo payment
            const momoRes = await ApiService.initiateMomoPayment(finalAmount, 'ORDER_' + Date.now(), phone, userToken);

            if (momoRes && momoRes.success) {
                showToast("Payment initiated! Please authorize on your phone.", "info");

                // Step 2: Create order with payment reference
                const orderData = {
                    userID: currentUser._id,
                    orderStatus: "pending",
                    items: orderItems,
                    totalPrice: finalAmount,
                    shippingAddress,
                    paymentMethod,
                    couponCode: appliedCouponConfig ? appliedCouponConfig._id : null,
                    orderTotal: { subtotal, discount: discountAmount, total: finalAmount },
                    paymentId: momoRes.referenceId
                };

                const orderRes = await ApiService.createOrder(orderData, userToken);
                if (orderRes && orderRes.success) {
                    showToast("Order placed successfully!", "success");
                    showReceipt(orderData, orderRes);
                    state.cart = [];
                    appliedCouponConfig = null;
                    updateCartUI();
                    closeModal('checkoutModal');
                } else {
                    showToast("Order creation failed: " + (orderRes ? orderRes.message : 'Unknown error'), "error");
                }
            } else {
                showToast("Payment initiation failed. Check your number or balance.", "error");
            }
        } else if (paymentMethod === 'paystack_card') {
            let handler = PaystackPop.setup({
                key: 'pk_test_c054cd818e2d4a49a16c6f9d16f2514dcc60740e',
                email: currentUser.email || 'customer@glomek.com',
                amount: finalAmount * 100,
                currency: 'GHS',
                ref: 'GLOMEK_' + Date.now() + '_' + Math.random().toString(36).substring(7),
                callback: async function (response) {
                    btn.textContent = "Verifying Payment...";

                    const verifyRes = await ApiService.verifyPaystackPayment(response.reference, userToken);
                    if (verifyRes && verifyRes.success) {
                        // Create order with verified payment reference
                        const orderData = {
                            userID: currentUser._id,
                            orderStatus: "pending",
                            items: orderItems,
                            totalPrice: finalAmount,
                            shippingAddress,
                            paymentMethod,
                            couponCode: appliedCouponConfig ? appliedCouponConfig._id : null,
                            orderTotal: { subtotal, discount: discountAmount, total: finalAmount },
                            paymentId: response.reference
                        };

                        const orderRes = await ApiService.createOrder(orderData, userToken);
                        if (orderRes && orderRes.success) {
                            showToast("Payment successful! Order completed.", "success");
                            showReceipt(orderData, orderRes);
                            state.cart = [];
                            appliedCouponConfig = null;
                            updateCartUI();
                            closeModal('checkoutModal');
                        } else {
                            showToast("Payment verified but order creation failed. Contact support.", "error");
                        }
                    } else {
                        showToast("Payment verification failed. Please contact support.", "error");
                    }
                    btn.textContent = "Pay securely";
                    btn.disabled = false;
                },
                onClose: function () {
                    showToast('Transaction was not completed.', "warning");
                    btn.textContent = "Pay securely";
                    btn.disabled = false;
                }
            });
            handler.openIframe();
            return;
        } else if (paymentMethod === 'cash_on_delivery') {
            // Cash on delivery — no payment gateway needed
            const orderData = {
                userID: currentUser._id,
                orderStatus: "pending",
                items: orderItems,
                totalPrice: finalAmount,
                shippingAddress,
                paymentMethod,
                couponCode: appliedCouponConfig ? appliedCouponConfig._id : null,
                orderTotal: { subtotal, discount: discountAmount, total: finalAmount }
            };

            const orderRes = await ApiService.createOrder(orderData, userToken);
            if (orderRes && orderRes.success) {
                showToast("Order placed! Pay on delivery.", "success");
                showReceipt(orderData, orderRes);
                state.cart = [];
                appliedCouponConfig = null;
                updateCartUI();
                closeModal('checkoutModal');
            } else {
                showToast("Order failed: " + (orderRes ? orderRes.message : 'Unknown error'), "error");
            }
        }
    } catch (err) {
        console.error("Checkout Error:", err);
        showToast("Checkout failed. Please try again.", "error");
    }

    btn.textContent = "Pay securely";
    btn.disabled = false;
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
        if (!freshProduct) { closeModal('productDetailModal'); showToast('Product not found.', 'error'); return; }
        product = freshProduct;
        populateProductDetail(product);
        return;
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
    starsHtml += `<a href="#" style="color:#007185;margin-left:8px;font-size:0.9rem;">${numReviews} rating${numReviews !== 1 ? 's' : ''}</a>`;
    ratingContainer.innerHTML = starsHtml;
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
        descEl.innerHTML = points.length > 1 ? points.map(p => `<li>${p}</li>`).join('') : `<li>${product.description}</li>`;
    } else {
        descEl.innerHTML = `<li>No description provided.</li>`;
    }

    // Variants / Color Selection
    const varSec = document.getElementById('pdVariantsSection');
    if (product.proVariantId && product.proVariantId.length > 0) {
        varSec.hidden = false;
        const variants = product.proVariantId;

        const colorNames = ['red', 'blue', 'green', 'black', 'white', 'yellow', 'orange', 'pink', 'purple', 'brown', 'grey', 'gray', 'navy', 'teal', 'maroon', 'beige', 'cream', 'gold', 'silver', 'cyan', 'magenta', 'olive', 'coral', 'salmon', 'turquoise', 'indigo', 'violet', 'khaki', 'tan', 'ivory', 'lavender', 'mint', 'peach', 'rose', 'burgundy', 'charcoal', 'chocolate', 'crimson', 'emerald', 'jade', 'lime', 'mauve', 'midnight', 'plum', 'ruby', 'rust', 'scarlet', 'slate', 'smoke', 'wine'];

        function isColor(str) {
            if (!str || typeof str !== 'string') return false;
            str = str.trim().toLowerCase();
            if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(str)) return true;
            if (colorNames.includes(str)) return true;
            return false;
        }

        function getColorValue(str) {
            if (!str) return '#ccc';
            str = str.trim().toLowerCase();
            if (/^#/.test(str)) return str;
            return str;
        }

        let variantsHtml = '';
        const firstVariant = variants[0];
        const variantName = typeof firstVariant === 'string' ? firstVariant : (firstVariant.name || firstVariant.color || '');
        const areColors = variants.every(v => {
            const name = typeof v === 'string' ? v : (v.color || v.name || '');
            return isColor(name);
        });

        if (areColors) {
            const labelEl = `<div class="pd-variant-label">Color: <span class="selected-variant-name" id="selectedVariantName">${variantName}</span></div>`;
            const swatches = variants.map((v, i) => {
                const name = typeof v === 'string' ? v : (v.color || v.name || '');
                const color = getColorValue(name);
                return `<div class="pd-color-swatch ${i === 0 ? 'selected' : ''}" 
                    style="background-color: ${color};" 
                    title="${name}" 
                    onclick="selectVariant(${i}, '${name.replace(/'/g, "\\'")}')">
                </div>`;
            }).join('');
            variantsHtml = labelEl + `<div class="pd-variants-list">${swatches}</div>`;
        } else {
            const labelEl = `<div class="pd-variant-label">Style: <span class="selected-variant-name" id="selectedVariantName">${variantName}</span></div>`;
            const pills = variants.map((v, i) => {
                const name = typeof v === 'string' ? v : (v.name || '');
                return `<div class="pd-variant-pill ${i === 0 ? 'selected' : ''}" 
                    onclick="selectVariant(${i}, '${name.replace(/'/g, "\\'")}')">
                ${name}</div>`;
            }).join('');
            variantsHtml = labelEl + `<div class="pd-variants-list">${pills}</div>`;
        }

        document.getElementById('pdVariantsList').innerHTML = variantsHtml;
    } else {
        varSec.hidden = true;
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
                        <span class="review-author">${userName}</span>
                        <div class="review-stars">${starsHtml}</div>
                    </div>
                    ${r.review ? `<p class="review-text">${r.review}</p>` : ''}
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
        const orders = await ApiService.fetchUserOrders(currentUser._id, userToken);
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
window.openModal = function (id) {
    const el = document.getElementById(id);
    if (el) el.hidden = false;
}
window.closeModal = function (id) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
}

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
    let html = '<a href="#" onclick="filterByCategory(null); return false;">Home</a>';

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
    scroll.innerHTML = state.recentlyViewed.map(item => `
        <div class="rv-card" onclick="openProductDetails('${item._id}')">
            <img src="${item.image}" alt="${item.name}" loading="lazy">
            <div class="rv-title">${item.name}</div>
            <div class="rv-price">${formatPrice(item.price)}</div>
        </div>
    `).join('');
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
}

function toggleWishlist(show) {
    const sidebar = document.getElementById('wishlistSidebar');
    if (!sidebar) return;
    if (show) {
        sidebar.classList.add('open');
        UI.cartOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        renderWishlistSidebar();
    } else {
        sidebar.classList.remove('open');
        // Only remove overlay if cart sidebar is also closed
        if (!UI.cartSidebar.classList.contains('open')) {
            UI.cartOverlay.classList.remove('active');
            document.body.style.overflow = '';
        }
    }
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
            <img src="${item.image}" alt="${item.name}" onclick="openProductDetails('${item._id}'); toggleWishlist(false);">
            <div class="wishlist-item-info">
                <div class="wishlist-item-title">${item.name}</div>
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
                <img src="${img}" alt="${p.name}" loading="lazy">
                <div class="rv-title">${p.name}</div>
                <div class="rv-price">${formatPrice(price)}</div>
            </div>
        `;
    }).join('');
}

// ====== VARIANT / COLOR SELECTION ====== //
window.selectVariant = function (index, variantName) {
    // Update selected variant name label
    const nameEl = document.getElementById('selectedVariantName');
    if (nameEl) nameEl.textContent = variantName;

    // Update visual selection state for color swatches
    document.querySelectorAll('.pd-color-swatch').forEach((el, i) => {
        el.classList.toggle('selected', i === index);
    });

    // Update visual selection state for text pills
    document.querySelectorAll('.pd-variant-pill').forEach((el, i) => {
        el.classList.toggle('selected', i === index);
    });

    // If the product has variant-specific images, swap to that image
    if (currentPdProduct && currentPdProduct.proVariantId) {
        const variant = currentPdProduct.proVariantId[index];
        if (variant && typeof variant === 'object') {
            // Check if variant has its own image
            if (variant.image || variant.imageUrl) {
                const varImg = variant.image || variant.imageUrl;
                const pdImage = document.getElementById('pdImage');
                if (pdImage) {
                    pdImage.style.opacity = '0';
                    setTimeout(() => {
                        pdImage.src = typeof varImg === 'object' ? varImg.url : varImg;
                        pdImage.onload = () => { pdImage.style.opacity = '1'; };
                        pdImage.onerror = () => { pdImage.style.opacity = '1'; };
                        setTimeout(() => { pdImage.style.opacity = '1'; }, 150);
                    }, 200);
                }
            }
        }
    }

    showToast(`Selected: ${variantName}`, 'info');
}

// ====== RECEIPT GENERATION & PDF DOWNLOAD ====== //
let lastReceiptData = null;

function showReceipt(orderData, orderRes) {
    const receiptData = {
        orderId: orderRes.data ? (orderRes.data._id || orderRes.data.orderId || 'N/A') : ('ORD-' + Date.now().toString(36).toUpperCase()),
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
            <span class="value">#${typeof receiptData.orderId === 'string' ? receiptData.orderId.substring(0, 12).toUpperCase() : receiptData.orderId}</span>
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
            <span class="value">${receiptData.customerName}</span>
        </div>
    `;

    // Populate receipt items
    document.getElementById('receiptItems').innerHTML = receiptData.items.map(item => `
        <div class="receipt-item-row">
            <div class="receipt-item-info">
                <div class="receipt-item-name">${item.productName || item.name || 'Item'}</div>
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
    document.getElementById('receiptShipping').innerHTML = `
        <strong>Delivery Address</strong>
        <p>${addr.street || ''}, ${addr.city || ''}<br>
        ${addr.state || ''} ${addr.postalCode || ''}<br>
        ${addr.country || 'Ghana'}${addr.phone && addr.phone !== 'N/A' ? '<br>Tel: ' + addr.phone : ''}</p>
    `;

    openModal('receiptModal');
}

function formatPaymentMethod(method) {
    const map = {
        'mtn_mobile_money': 'MTN Mobile Money',
        'paystack_card': 'Card Payment (Paystack)',
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

        const orderId = typeof data.orderId === 'string' ? data.orderId.substring(0, 12).toUpperCase() : data.orderId;
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
            ['Order ID', '#' + (order._id || '').substring(0, 12).toUpperCase()],
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
    ];
    ariaMap.forEach(([sel, label]) => {
        const el = document.querySelector(sel);
        if (el) {
            el.setAttribute('aria-label', label);
            if (!el.getAttribute('role') && el.tagName !== 'BUTTON') el.setAttribute('role', 'button');
        }
    });

    // Escape key to close modals (industry standard)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // Close topmost open modal
            const modals = ['productDetailModal', 'receiptModal', 'checkoutModal', 'profileModal', 'authModal', 'forgotPasswordModal', 'resetPasswordModal'];
            for (const id of modals) {
                const modal = document.getElementById(id);
                if (modal && !modal.hidden) {
                    closeModal(id);
                    return;
                }
            }
            // Close sidebars
            if (UI.cartSidebar.classList.contains('open')) { toggleCart(false); return; }
            const ws = document.getElementById('wishlistSidebar');
            if (ws && ws.classList.contains('open')) { toggleWishlist(false); }
        }
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
