document.addEventListener('DOMContentLoaded', () => {
    initApp();
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
    cartOverlay: document.getElementById('cartOverlay'),
    cartSidebar: document.getElementById('cartSidebar'),
    cartItemsContainer: document.getElementById('cartItems'),
    cartTotal: document.getElementById('cartTotal'),
    cartToggleBtn: document.getElementById('cartToggleBtn'),
    closeCartBtn: document.getElementById('closeCartBtn'),
    checkoutBtn: document.getElementById('checkoutBtn'),
};

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
        window.google.accounts.id.renderButton(container, { theme: "outline", size: "large", width: "100%" });
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
    if(!response || !response.credential) return;
    try {
        const payload = JSON.parse(atob(response.credential.split('.')[1]));
        const { email, name } = payload;
        await performGoogleLogin(email, name);
    } catch(err) {
        console.error("Google Auth error:", err);
        showToast("Unable to complete Google Auth.", "error");
    }
}

window.handleFallbackGoogleLogin = function() {
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
        if(res && res.success) {
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
    } catch(err) {
        showToast("Unable to complete Google Auth.", "error");
    }
    if (btn) { btn.textContent = "Login"; btn.disabled = false; }
}

function setupEventListeners() {
    // Search with debounce
    let searchTimeout;
    UI.searchInput.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        UI.clearSearchBtn.hidden = val.length === 0;
        
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            state.searchKeyword = val;
            state.currentPage = 1;
            loadProducts();
        }, 600);
    });

    // Search submit button
    const searchSubmitBtn = document.querySelector('.search-submit-btn');
    if (searchSubmitBtn) {
        searchSubmitBtn.addEventListener('click', () => {
            state.searchKeyword = UI.searchInput.value.trim();
            state.currentPage = 1;
            loadProducts();
        });
    }

    UI.clearSearchBtn.addEventListener('click', () => {
        UI.searchInput.value = '';
        UI.clearSearchBtn.hidden = true;
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

    // Load persisted Cart from LocalStorage
    const savedCart = localStorage.getItem('glomek_cart');
    if (savedCart) {
        state.cart = JSON.parse(savedCart);
        updateCartUI();
    }
    // Initialize wishlist UI
    updateWishlistBadge();
    renderRecentlyViewed();
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

    if (!isPagination) {
        state.products = [];
        renderShimmerGrid();
        UI.productSectionTitle.textContent = state.searchKeyword ? `Search Results for "${state.searchKeyword}"` : "Featured Products";
        UI.emptyState.hidden = true;
        UI.productGrid.hidden = false;
        
        const oldRecs = document.getElementById('recsGrid');
        if (oldRecs) oldRecs.remove();
        const oldTitle = document.querySelector('.recommendations-title');
        if (oldTitle) oldTitle.style.display = 'none';
    } else {
        UI.loadingMore.hidden = false;
    }

    const fetchedProducts = await ApiService.fetchProducts(state.currentPage, 50, state.searchKeyword);
    
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

window.filterByCategory = async function(catId) {
    state.selectedCategoryId = catId;
    state.selectedSubCategoryId = null;
    renderCategories();
    
    if(catId) {
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
    if(prodSec) setTimeout(() => prodSec.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
}

window.filterBySubCategory = async function(subCatId, event) {
    document.querySelectorAll('.subcategory-pill').forEach(el => el.classList.remove('active'));
    if(event && event.target) event.target.classList.add('active');
    
    state.selectedSubCategoryId = subCatId;
    state.currentPage = 1;
    await loadProducts();
    
    const prodSec = document.querySelector('.products-section');
    if(prodSec) setTimeout(() => prodSec.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
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
                <div class="poster-slide" id="posterSlide-${idx}" style="opacity:${idx===0?'1':'0'}; z-index:${idx===0?'2':'1'};" onclick="handlePosterClick(${idx})">
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
        
        if(validPosters.length > 1) {
            htmlSnippet += `
                <button class="poster-carousel-btn poster-prev-btn" onclick="prevPoster(event)"><span class="material-symbols-rounded">chevron_left</span></button>
                <button class="poster-carousel-btn poster-next-btn" onclick="nextPoster(event)"><span class="material-symbols-rounded">chevron_right</span></button>
                <div class="poster-dots" id="posterDots">
                    ${validPosters.map((_, i) => `<div class="poster-dot ${i===0?'active':''}" onclick="setPoster(${i}, event)"></div>`).join('')}
                </div>
            `;
        }
        
        UI.posterContainer.innerHTML = htmlSnippet;
        
        // Touch swipe support
        setupPosterSwipe();
        
        if(validPosters.length > 1) {
            if(posterInterval) clearInterval(posterInterval);
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
        if(posterInterval) clearInterval(posterInterval);
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
    if(validPosters.length <= 1 || newIndex === currentPosterIndex) return;
    const oldSlide = document.getElementById(`posterSlide-${currentPosterIndex}`);
    const newSlide = document.getElementById(`posterSlide-${newIndex}`);
    if (oldSlide) { oldSlide.style.opacity = '0'; oldSlide.style.zIndex = '1'; }
    if (newSlide) { newSlide.style.opacity = '1'; newSlide.style.zIndex = '2'; }
    document.querySelectorAll('#posterDots .poster-dot').forEach((d, i) => d.classList.toggle('active', i === newIndex));
    currentPosterIndex = newIndex;
}

window.nextPoster = function(e) {
    if(e) { e.preventDefault(); clearInterval(posterInterval); }
    let validPosters = state.posters.filter(p => p.imageUrl || (p.image && p.image.url));
    if(validPosters.length <= 1) return;
    transitionPoster((currentPosterIndex + 1) % validPosters.length);
}

window.prevPoster = function(e) {
    if(e) { e.preventDefault(); clearInterval(posterInterval); }
    let validPosters = state.posters.filter(p => p.imageUrl || (p.image && p.image.url));
    if(validPosters.length <= 1) return;
    transitionPoster((currentPosterIndex - 1 + validPosters.length) % validPosters.length);
}

window.setPoster = function(idx, e) {
    if(e) { e.preventDefault(); clearInterval(posterInterval); }
    transitionPoster(idx);
}

window.handlePosterClick = function(idx) {
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
    if(prodSec) setTimeout(() => prodSec.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
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

window.addToCart = function(id, encodedProduct) {
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
    
    showToast(`${product.name} added to cart`, "success");
}

window.updateQty = function(id, change) {
    const item = state.cart.find(i => i.productId === id);
    if (item) {
        item.quantity += change;
        if (item.quantity <= 0) { deleteFromCart(id); }
        else { updateCartUI(); }
    }
}

window.setQty = function(id, value) {
    const qty = parseInt(value, 10);
    if (isNaN(qty) || qty <= 0) { deleteFromCart(id); return; }
    const item = state.cart.find(i => i.productId === id);
    if (item) {
        item.quantity = qty;
        updateCartUI();
    }
}

window.deleteFromCart = function(id) {
    state.cart = state.cart.filter(i => i.productId !== id);
    updateCartUI();
}

function updateCartUI() {
    localStorage.setItem('glomek_cart', JSON.stringify(state.cart));
    const count = state.cart.length;
    if (count > 0) {
        UI.cartBadge.textContent = count;
        UI.cartBadge.hidden = false;
        UI.checkoutBtn.disabled = false;
    } else {
        UI.cartBadge.hidden = true;
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

window.toggleAuthMode = function() {
    isLoginMode = !isLoginMode;
    document.getElementById('authTitle').textContent = isLoginMode ? 'Login' : 'Sign Up';
    document.getElementById('authSubmitBtn').textContent = isLoginMode ? 'Login' : 'Create Account';
    document.getElementById('authToggleText').textContent = isLoginMode ? "Don't have an account?" : "Already have an account?";
    document.getElementById('authToggleLink').textContent = isLoginMode ? "Sign Up" : "Login";
    document.getElementById('authName').hidden = isLoginMode;
    document.getElementById('authName').required = !isLoginMode;
}

window.handleAuthSubmit = async function(e) {
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
    } catch(err) {
        showToast("An error occurred. Please try again.", "error");
    }

    btn.textContent = isLoginMode ? 'Login' : 'Create Account';
    btn.disabled = false;
}

window.logout = async function() {
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
    
    if(!currentUser || !currentUser._id) return;
    
    const orders = await ApiService.fetchUserOrders(currentUser._id, userToken);
    if(orders.length === 0) {
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
                    <strong>Order #${o._id ? o._id.substring(0,8) : 'N/A'}</strong>
                    <span class="order-status-badge ${statusClass}">${statusClass}</span>
                </div>
                <div style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:0.5rem;">${date}</div>
                ${itemsHtml}
                <div style="display:flex; justify-content:flex-end; margin-top:0.5rem; font-weight:700;">
                    <span class="accent-text">${formatPrice(o.totalPrice)}</span>
                </div>
            </div>
        `;
    }).join('');
}

// ====== FORGOT & RESET PASSWORD ====== //
window.openForgotPassword = function() {
    closeModal('authModal');
    openModal('forgotPasswordModal');
}

window.handleForgotPasswordRequest = async function(e) {
    e.preventDefault();
    const email = document.getElementById('resetEmail').value;
    const btn = document.getElementById('reqOtpBtn');
    btn.textContent = "Sending...";
    btn.disabled = true;
    try {
        const res = await ApiService.forgotPassword(email);
        if(res && res.success) {
            showToast("OTP sent! Check your email.", "success");
            closeModal('forgotPasswordModal');
            openModal('resetPasswordModal');
        } else {
            showToast(res.message || "Failed to send OTP.", "error");
        }
    } catch(err) {
        showToast("An error occurred.", "error");
    }
    btn.textContent = "Request OTP";
    btn.disabled = false;
}

window.handleResetPasswordRequest = async function(e) {
    e.preventDefault();
    const email = document.getElementById('resetEmail').value;
    const otp = document.getElementById('resetOtp').value;
    const newPass = document.getElementById('resetNewPassword').value;
    const btn = document.getElementById('verifyOtpBtn');
    btn.textContent = "Verifying...";
    btn.disabled = true;
    try {
        const res = await ApiService.resetPassword(email, otp, newPass);
        if(res && res.success) {
            showToast("Password reset successful! You can now login.", "success");
            closeModal('resetPasswordModal');
            openModal('authModal');
        } else {
            showToast(res.message || "Invalid or expired OTP.", "error");
        }
    } catch(err) {
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

window.applyCoupon = async function() {
    const code = document.getElementById('chkCoupon').value.trim();
    if(!code) return showToast("Enter a coupon code first.", "warning");
    
    const total = state.cart.reduce((a, b) => a + (b.price * b.quantity), 0);
    const pIds = state.cart.map(i => i.productId);
    
    const res = await ApiService.checkCoupon(code, total, pIds);
    if(res.success) {
        appliedCouponConfig = res.data;
        showToast("Coupon applied successfully!", "success");
        const newTotal = total - appliedCouponConfig.discountAmount;
        document.getElementById('checkoutAmount').textContent = formatPrice(newTotal < 0 ? 0 : newTotal);
    } else {
        showToast(res.message || "Invalid or inapplicable coupon.", "error");
    }
}

window.togglePaymentFields = function() {
    const pm = document.getElementById('chkPaymentMethod').value;
    const momoSection = document.getElementById('momoFieldSection');
    const chkPhone = document.getElementById('chkPhone');
    const codNotice = document.getElementById('codNotice');
    
    if(pm === 'mtn_mobile_money') {
        momoSection.style.display = 'flex';
        chkPhone.required = true;
        if(codNotice) codNotice.style.display = 'none';
    } else if(pm === 'cash_on_delivery') {
        momoSection.style.display = 'none';
        chkPhone.required = false;
        chkPhone.value = '';
        if(codNotice) codNotice.style.display = 'block';
    } else {
        momoSection.style.display = 'none';
        chkPhone.required = false;
        chkPhone.value = '';
        if(codNotice) codNotice.style.display = 'none';
    }
}

window.handleCheckoutSubmit = async function(e) {
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
            
            if(momoRes && momoRes.success) {
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
                if(orderRes && orderRes.success) {
                    showToast("Order placed successfully!", "success");
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
                callback: async function(response) {
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
                        if(orderRes && orderRes.success) {
                            showToast("Payment successful! Order completed.", "success");
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
                onClose: function(){
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
            if(orderRes && orderRes.success) {
                showToast("Order placed! Pay on delivery.", "success");
                state.cart = [];
                appliedCouponConfig = null;
                updateCartUI();
                closeModal('checkoutModal');
            } else {
                showToast("Order failed: " + (orderRes ? orderRes.message : 'Unknown error'), "error");
            }
        }
    } catch(err) {
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

window.openProductDetails = async function(productId) {
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
            `<img src="${img}" class="pd-thumbnail ${i === 0 ? 'active' : ''}" onclick="selectPdImage(${i})" alt="Thumbnail ${i+1}">`
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
    if(product.description) {
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
        
        const colorNames = ['red','blue','green','black','white','yellow','orange','pink','purple','brown','grey','gray','navy','teal','maroon','beige','cream','gold','silver','cyan','magenta','olive','coral','salmon','turquoise','indigo','violet','khaki','tan','ivory','lavender','mint','peach','rose','burgundy','charcoal','chocolate','crimson','emerald','jade','lime','mauve','midnight','plum','ruby','rust','scarlet','slate','smoke','wine'];
        
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
    
    document.getElementById('pdAddToCartBtn').onclick = () => {
        addToCart(safeProductObj._id, prodJson);
        closeModal('productDetailModal');
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
            const starsHtml = Array.from({length: 5}, (_, i) => 
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
    
    // Show review form only for logged-in users
    if (currentUser) {
        reviewForm.hidden = false;
        setupStarPicker();
        setupReviewSubmit(product._id || product.sId);
    } else {
        reviewForm.hidden = true;
    }
}

let selectedRating = 0;

function setupStarPicker() {
    selectedRating = 0;
    const picker = document.getElementById('starPicker');
    picker.innerHTML = Array.from({length: 5}, (_, i) => 
        `<span class="material-symbols-rounded" data-rating="${i+1}" onclick="setStarRating(${i+1})">star</span>`
    ).join('');
}

window.setStarRating = function(rating) {
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

window.selectPdImage = function(index) {
    if(index === currentPdIndex || isAnimating) return;
    fadeToPdImage(index);
}

window.fadeToPdImage = function(newIndex) {
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

window.nextPdImage = function(e) {
    if(e) { e.preventDefault(); e.stopPropagation(); }
    if(currentPdImages.length <= 1 || isAnimating) return;
    fadeToPdImage((currentPdIndex + 1) % currentPdImages.length);
}

window.prevPdImage = function(e) {
    if(e) { e.preventDefault(); e.stopPropagation(); }
    if(currentPdImages.length <= 1 || isAnimating) return;
    fadeToPdImage((currentPdIndex - 1 + currentPdImages.length) % currentPdImages.length);
}

// ====== MODAL UTILS ====== //
window.openModal = function(id) {
    const el = document.getElementById(id);
    if(el) el.hidden = false;
}
window.closeModal = function(id) {
    const el = document.getElementById(id);
    if(el) el.hidden = true;
}

// ====================================================================
// PHASE 1 & 2 — NEW FEATURES
// ====================================================================

// ====== SORTING ====== //
function applySorting(list, sortKey) {
    const sorted = [...list];
    switch(sortKey) {
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

window.handleSortChange = function() {
    state.sortBy = document.getElementById('sortSelect').value;
    state.currentPage = 1;
    loadProducts();
}

window.applyPriceFilter = function() {
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
        el.innerHTML = `Showing <strong>${count}</strong> result${count !== 1 ? 's' : ''} for "<strong>${state.searchKeyword}</strong>"`;
    } else if (state.selectedCategoryId) {
        const cat = state.categories.find(c => c._id === state.selectedCategoryId);
        el.innerHTML = `Showing <strong>${count}</strong> result${count !== 1 ? 's' : ''} in <strong>${cat ? cat.name : 'category'}</strong>`;
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
                html += `<a href="#" onclick="filterByCategory('${cat._id}'); return false;">${cat.name}</a>`;
            } else {
                html += `<span class="breadcrumb-current">${cat.name}</span>`;
            }
        }
    }
    if (state.selectedSubCategoryId) {
        const subCat = state.subCategories.find(s => s._id === state.selectedSubCategoryId);
        if (subCat) {
            html += '<span class="breadcrumb-sep">›</span>';
            html += `<span class="breadcrumb-current">${subCat.name}</span>`;
        }
    }
    if (state.searchKeyword) {
        html += '<span class="breadcrumb-sep">›</span>';
        html += `<span class="breadcrumb-current">Search: "${state.searchKeyword}"</span>`;
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
window.toggleWishlistItem = function(event, productId, encodedName, price, encodedImage) {
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

window.addWishlistItemToCart = function(productId) {
    const item = state.wishlist.find(w => w._id === productId);
    if (!item) return;
    const prodJson = encodeURIComponent(JSON.stringify(item));
    addToCart(productId, prodJson);
}

window.removeWishlistItem = function(productId) {
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
    
    newContainer.addEventListener('mousemove', function(e) {
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
    
    newContainer.addEventListener('mouseleave', function() {
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
window.selectVariant = function(index, variantName) {
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
