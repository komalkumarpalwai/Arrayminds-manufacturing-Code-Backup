import { LightningElement, api, wire, track } from 'lwc';
import addProducts from '@salesforce/apex/ProductCartService.addProducts';
import getPricebooks from '@salesforce/apex/ProductCartService.getPricebooks';
import getProductsByPricebook from '@salesforce/apex/ProductCartService.getProductsByPricebook';
import updateParentPricebook
    from '@salesforce/apex/ProductCartService.updateParentPricebook';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { RefreshEvent } from 'lightning/refresh';
import { getRecord } from 'lightning/uiRecordApi';
import { NavigationMixin } from 'lightning/navigation';

const ORDER_FIELDS = ['Order.Status'];
const CURRENCY_FIELDS = [
    'Opportunity.CurrencyIsoCode',
    'Quote.CurrencyIsoCode',
    'Order.CurrencyIsoCode'
];

export default class ProductCartService extends NavigationMixin(LightningElement) {
    isLoading = false;


    @api recordId;

    @track pricebookOptions = [];
    @track allPricebooksData = [];
    selectedPricebookId;
    parentCurrency;
    pricebookSearchTerm = '';
    showAllPricebooks = false;

    countdown = 3;
    progressWidth = 100;

    @track products = [];
    @track filteredProducts = [];
    @track cart = [];

    /* DETAILS MODAL */
    showDetailsModal = false;
    selectedProduct = {};
    selectedProductQty = 1;
    selectedImageIndex = 0;
    imageScrollInterval = null;
    isImageGalleryHovered = false;

    get disableDecrementBtn() {
        return this.selectedProductQty <= 1;
    }

    get disableAddDetailsBtn() {
        return this.isOrderActivated || this.selectedProductQty <= 0;
    }

    get selectedImage() {
        if (this.selectedProduct.imageUrls && this.selectedProduct.imageUrls.length > 0) {
            return this.selectedProduct.imageUrls[this.selectedImageIndex];
        }
        return this.selectedProduct.imageUrl;
    }

    get productImages() {
        return (this.selectedProduct.imageUrls && this.selectedProduct.imageUrls.length > 0) 
            ? this.selectedProduct.imageUrls.map((url, index) => ({
                url: url,
                index: index,
                isSelected: index === this.selectedImageIndex,
                btnClass: index === this.selectedImageIndex ? 'thumbnail-btn active' : 'thumbnail-btn'
            }))
            : [];
    }

    /* PRODUCT FILTERING & PAGINATION */
    productSearchTerm = '';
    selectedCategory = 'All Products';
    currentPage = 1;
    productsPerPage = 6;

    showCartModal = false;
    cartMode = 'EDIT';
    orderStatus;

    /* ORDER STATUS */
    @wire(getRecord, { recordId: '$recordId', fields: ORDER_FIELDS })
    wiredOrder({ data }) {
        if (data) {
            this.orderStatus = data.fields.Status.value;
        }
    }

    /* CURRENCY */
    @wire(getRecord, { recordId: '$recordId', fields: CURRENCY_FIELDS })
    wiredCurrency({ data }) {
        if (data) {
            this.parentCurrency = data.fields.CurrencyIsoCode.value;

            /* if pricebook already selected reload products */
            if (this.selectedPricebookId) {
                this.loadProducts();
            }
        }
    }

    /* PRICEBOOKS */
    @wire(getPricebooks)
    wiredPB({ data }) {
        if (data) {
            this.allPricebooksData = data;
            this.pricebookOptions =
                data.map(p => ({ label: p.Name, value: p.Id }));
        }
    }

    handlePricebookSearch(event) {
        this.pricebookSearchTerm = event.target.value.toLowerCase();
    }

    toggleAllPricebooks() {
        this.showAllPricebooks = !this.showAllPricebooks;
        
        // Auto-scroll to all pricebooks section if opened
        if (this.showAllPricebooks) {
            setTimeout(() => {
                const allPBSection = this.template.querySelector('.all-pricebooks-section');
                if (allPBSection) {
                    allPBSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);
        }
    }

    selectPricebook(event) {
        const pricebookId = event.currentTarget.dataset.pbid;
        this.selectedPricebookId = pricebookId;
        this.showAllPricebooks = false;

        updateParentPricebook({
            parentId: this.recordId,
            pricebookId: this.selectedPricebookId
        })
        .then(() => {
            this.loadProducts();   // fetch products after update
        });
    }

    handleBackToPricebooks() {
        this.selectedPricebookId = null;
        this.pricebookSearchTerm = '';
        this.showAllPricebooks = false;
        this.productSearchTerm = '';
        this.selectedCategory = 'All Products';
        this.currentPage = 1;
        this.products = [];
        this.filteredProducts = [];
        this.cart = [];
    }

    /* PRODUCT SEARCH & FILTERING */
    handleProductSearch(event) {
        this.productSearchTerm = event.target.value.toLowerCase();
        this.currentPage = 1;
    }

    handleCategoryFilter(event) {
        this.selectedCategory = event.currentTarget.dataset.category;
        this.currentPage = 1;
        
        // Auto-scroll to products section
        setTimeout(() => {
            const productsContainer = this.template.querySelector('.products-container');
            if (productsContainer) {
                productsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 100);
    }

    getCategoryIcon(categoryName) {
        const iconMap = {
            'Finished Good': '📦',
            'Trading Good': '🏪',
            'Raw Material': '⚙️',
            'Warranty': '🛡️',
            'Semi Finished Good': '🔧',
            'Consumable': '💧',
            'Packaging': '📫',
            'Service': '🔧',
            'All Products': '🛍️'
        };
        return iconMap[categoryName] || '📦';
    }

    get categories() {
        // Predefined product family categories
        const predefinedCategories = [
            'Finished Good',
            'Trading Good',
            'Raw Material',
            'Warranty',
            'Semi Finished Good',
            'Consumable',
            'Packaging',
            'Service'
        ];
        
        const categorySet = new Set(['All Products']);
        
        // Add predefined categories
        predefinedCategories.forEach(cat => categorySet.add(cat));
        
        // Also add any ProductFamily from actual products (in case there are custom ones)
        if (this.products && this.products.length > 0) {
            this.products.forEach(p => {
                if (p.ProductFamily) {
                    categorySet.add(p.ProductFamily);
                }
            });
        }
        
        return Array.from(categorySet).sort().map(cat => ({
            name: cat,
            icon: this.getCategoryIcon(cat),
            isActive: cat === this.selectedCategory
        }));
    }

    get filteredBySearchAndCategory() {
        let filtered = this.products;

        // Filter by category
        if (this.selectedCategory !== 'All Products') {
            filtered = filtered.filter(p => {
                // Handle null/undefined ProductFamily
                const productFamily = p.ProductFamily ? p.ProductFamily.trim() : '';
                const selectedCategory = this.selectedCategory.trim();
                return productFamily === selectedCategory;
            });
        }

        // Filter by search term
        if (this.productSearchTerm) {
            filtered = filtered.filter(p =>
                p.name.toLowerCase().includes(this.productSearchTerm) ||
                p.productCode.toLowerCase().includes(this.productSearchTerm) ||
                (p.Brand && p.Brand.toLowerCase().includes(this.productSearchTerm))
            );
        }

        return filtered;
    }

    get totalPages() {
        return Math.ceil(this.filteredBySearchAndCategory.length / this.productsPerPage) || 1;
    }

    get paginatedProducts() {
        const start = (this.currentPage - 1) * this.productsPerPage;
        const end = start + this.productsPerPage;
        return this.filteredBySearchAndCategory.slice(start, end);
    }

    get hasProductsOnPage() {
        return this.paginatedProducts && this.paginatedProducts.length > 0;
    }

    get canGoPrevious() {
        return this.currentPage > 1;
    }

    get canGoNext() {
        return this.currentPage < this.totalPages;
    }

    get disablePreviousButton() {
        return !this.canGoPrevious;
    }

    get disableNextButton() {
        return !this.canGoNext;
    }

    handlePreviousPage() {
        if (this.canGoPrevious) {
            this.currentPage -= 1;
        }
    }

    handleNextPage() {
        if (this.canGoNext) {
            this.currentPage += 1;
        }
    }

    handlePageClick(event) {
        const pageNum = parseInt(event.currentTarget.dataset.page, 10);
        this.currentPage = pageNum;
    }

    get pageNumbers() {
        const pages = [];
        for (let i = 1; i <= this.totalPages; i++) {
            const isActive = i === this.currentPage;
            pages.push({
                number: i,
                isActive: isActive,
                btnClass: isActive ? 'page-btn active' : 'page-btn'
            });
        }
        return pages;
    }

    get topPricebooks() {
        let filtered = this.allPricebooksData;
        if (this.pricebookSearchTerm) {
            filtered = filtered.filter(p =>
                p.Name.toLowerCase().includes(this.pricebookSearchTerm)
            );
        }
        return filtered.slice(0, 4).map(p => ({
            ...p,
            isSelected: p.Id === this.selectedPricebookId
        }));
    }

    get filteredAllPricebooks() {
        let filtered = this.allPricebooksData;
        if (this.pricebookSearchTerm) {
            filtered = filtered.filter(p =>
                p.Name.toLowerCase().includes(this.pricebookSearchTerm)
            );
        }
        return filtered.map(p => ({
            ...p,
            isSelected: p.Id === this.selectedPricebookId
        }));
    }

    get hasPricebooks() {
        return this.allPricebooksData && this.allPricebooksData.length > 0;
    }

    get filteredPricebooksCount() {
        return this.filteredAllPricebooks.length;
    }

    /* LOAD PRODUCTS */
    loadProducts() {

        if (!this.selectedPricebookId || !this.parentCurrency) {
            return;
        }
        this.isLoading = true;

        getProductsByPricebook({
            pricebookId: this.selectedPricebookId,
            currencyIso: this.parentCurrency
        })
        .then(data => {
            this.products = data.map(p => ({ ...p, qty: null }));
            this.filteredProducts = this.products;
        })
        .finally(()=>{
            this.isLoading = false;
        });
    }

    /* ----- EVERYTHING BELOW REMAINS SAME AS YOUR EXISTING CODE ----- */

    get isOrderActivated() {
        return this.orderStatus === 'Activated';
    }

    handleQtyChange(event) {
        const id = event.target.dataset.id;
        const qty = Number(event.target.value);

        this.products = this.products.map(p =>
            p.productId === id ? { ...p, qty } : p
        );
    }

    /* PRODUCT DETAILS MODAL HANDLERS */
    handleViewDetails(event) {
        const id = event.currentTarget.dataset.id;
        const product = this.products.find(p => p.productId === id);

        if (product) {
            // Set up the product with additional fields for the modal
            this.selectedProduct = {
                ...product,
                brand: product.Brand || product.name,
                category: product.Category || 'General',
                availableUnits: 10053,
                description: 'Premium product designed for reliability and advanced functionality.',
                mrp: null,
                discount: null,
                savingAmount: null,
                maxPrice: null
            };
            this.selectedProductQty = 1;
            this.selectedImageIndex = 0;
            this.showDetailsModal = true;
            
            // Start image auto-scroll after modal opens
            setTimeout(() => {
                this.startImageScroll();
            }, 100);
        }
    }

    closeDetailsModal() {
        this.showDetailsModal = false;
        this.selectedProduct = {};
        this.selectedProductQty = 1;
        this.selectedImageIndex = 0;
        this.stopImageScroll();
    }

    startImageScroll() {
        // Only start if there are multiple images
        if (this.selectedProduct.imageUrls && this.selectedProduct.imageUrls.length > 1) {
            this.stopImageScroll(); // Clear any existing interval
            this.imageScrollInterval = setInterval(() => {
                this.nextImage();
            }, 2000);
        }
    }

    stopImageScroll() {
        if (this.imageScrollInterval) {
            clearInterval(this.imageScrollInterval);
            this.imageScrollInterval = null;
        }
    }

    nextImage() {
        if (this.selectedProduct.imageUrls && this.selectedProduct.imageUrls.length > 1) {
            this.selectedImageIndex = (this.selectedImageIndex + 1) % this.selectedProduct.imageUrls.length;
        }
    }

    handleImageGalleryMouseEnter() {
        this.isImageGalleryHovered = true;
        this.stopImageScroll();
    }

    handleImageGalleryMouseLeave() {
        this.isImageGalleryHovered = false;
        this.startImageScroll();
    }

    selectProductImage(event) {
        const index = parseInt(event.currentTarget.dataset.index, 10);
        this.selectedImageIndex = index;
        
        // Pause auto-scroll when user manually selects an image
        this.isImageGalleryHovered = true;
        this.stopImageScroll();
        
        // Resume auto-scroll after 3 seconds of inactivity
        setTimeout(() => {
            if (this.isImageGalleryHovered) {
                this.isImageGalleryHovered = false;
                this.startImageScroll();
            }
        }, 3000);
    }

    incrementQty() {
        if (this.selectedProductQty < (this.selectedProduct.availableUnits || 10053)) {
            this.selectedProductQty += 1;
        }
    }

    decrementQty() {
        if (this.selectedProductQty > 1) {
            this.selectedProductQty -= 1;
        }
    }

    handleDetailsQtyChange(event) {
        const qty = Number(event.target.value);
        if (qty > 0 && qty <= (this.selectedProduct.availableUnits || 10053)) {
            this.selectedProductQty = qty;
        }
    }

    addDetailsModalToCart() {
        const product = this.selectedProduct;
        const qty = this.selectedProductQty;

        if (!qty || qty <= 0) {
            this.showToast('Invalid Quantity', 'Enter quantity greater than 0', 'error');
            return;
        }

        const index = this.cart.findIndex(c => c.productId === product.productId);

        if (index !== -1) {
            const updated = [...this.cart];
            const item = updated[index];
            updated[index] = {
                ...item,
                qty: item.qty + qty,
                total: (item.qty + qty) * item.price
            };
            this.cart = updated;
        } else {
            this.cart = [...this.cart, {
                productId: product.productId,
                name: product.name,
                qty,
                price: product.unitPrice,
                total: qty * product.unitPrice
            }];
        }

        this.showToast('Success', `${product.name} added to cart`, 'success');
        this.closeDetailsModal();
    }

    handleQuickAddToCart(event) {
        const id = event.currentTarget.dataset.id;
        const product = this.products.find(p => p.productId === id);

        if (!product) {
            this.showToast('Error', 'Product not found', 'error');
            return;
        }

        // Add with qty = 1 for quick add
        const qty = 1;
        const index = this.cart.findIndex(c => c.productId === id);

        if (index !== -1) {
            const updated = [...this.cart];
            const item = updated[index];
            updated[index] = {
                ...item,
                qty: item.qty + qty,
                total: (item.qty + qty) * item.price
            };
            this.cart = updated;
        } else {
            this.cart = [...this.cart, {
                productId: id,
                name: product.name,
                qty: 1,
                price: product.unitPrice,
                total: 1 * product.unitPrice
            }];
        }

        this.showToast('Success', `${product.name} added to cart`, 'success');
    }

    addToCart(event) {
        const id = event.target.dataset.id;
        const product = this.products.find(p => p.productId === id);

        if (!product.qty || product.qty <= 0) {
            this.showToast('Invalid Quantity', 'Enter quantity greater than 0', 'error');
            return;
        }

        const qty = product.qty;
        const index = this.cart.findIndex(c => c.productId === id);

        if (index !== -1) {
            const updated = [...this.cart];
            const item = updated[index];
            updated[index] = { ...item, qty: item.qty + qty, total: (item.qty + qty) * item.price };
            this.cart = updated;
        } else {
            this.cart = [...this.cart,
                { productId: id, name: product.name, qty, price: product.unitPrice, total: qty * product.unitPrice }
            ];
        }

        this.resetProductQty(id);
    }

    updateCartQty(event) {
        const id = event.target.dataset.id;
        const qty = Number(event.target.value);

        this.cart = this.cart.map(c =>
            c.productId === id ? { ...c, qty, total: qty * c.price } : c
        );
    }

    removeItem(event) {
        const id = event.currentTarget.dataset.id;
        this.cart = this.cart.filter(c => c.productId !== id);
        this.showToast('Success', 'Product removed from cart', 'success');
    }

    clearCart() {
        this.cart = [];
        this.closeCart();
    }

    get totalAmount() {
        return this.cart.reduce((sum, c) => sum + c.total, 0);
    }

    get hasCartItems() {
        return this.cart && this.cart.length > 0;
    }

    get showSearch() {
        return this.products && this.products.length > 0;
    }

    openCart() {
        if (!this.cart.length) return;
        this.cartMode = 'EDIT';
        this.showCartModal = true;
    }

    closeCart() {
        this.showCartModal = false;
        this.cartMode = 'EDIT';
        this.resetAllProductQty();
    }

    closeSummary() {
        this.cart = [];
        this.showCartModal = false;
        this.cartMode = 'EDIT';
        this.resetAllProductQty();
        this.navigateToRelatedTab();
    }

    get isEditMode() { return this.cartMode === 'EDIT'; }
    get isSummaryMode() { return this.cartMode === 'SUMMARY'; }

    saveAll() {

        const lines = this.cart.map(c => ({
            Product2Id: c.productId,
            Quantity: c.qty,
            UnitPrice: c.price
        }));

        addProducts({ parentId: this.recordId, lines })
        .then(() => {
            this.cartMode = 'SUMMARY';
            this.showCartModal = true;
            this.resetAllProductQty();

            this.countdown = 3;
            this.progressWidth = 100;

            const interval = setInterval(() => {
                this.countdown -= 1;
                this.progressWidth = (this.countdown / 3) * 100;
                if (this.countdown === 0) clearInterval(interval);
            }, 1000);

            this.dispatchEvent(new RefreshEvent());

            setTimeout(() => {
                this.closeSummary();
            }, 3000);
        });
    }

    resetProductQty(productId) {
        this.products = this.products.map(p =>
            p.productId === productId ? { ...p, qty: null } : p
        );
        this.filteredProducts = this.filteredProducts.map(p =>
            p.productId === productId ? { ...p, qty: null } : p
        );
    }

    resetAllProductQty() {
        this.products = this.products.map(p => ({ ...p, qty: null }));
        this.filteredProducts = this.products;
    }

    get progressStyle() {
        return `width: ${this.progressWidth}%;`;
    }

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    handleImageError(event) {
        event.target.src = '/img/icon/t4v35/standard/product_120.png';
    }

    navigateToRelatedTab() {
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: this.recordId, actionName: 'view' },
            state: { tab: 'related' }
        });
    }
}