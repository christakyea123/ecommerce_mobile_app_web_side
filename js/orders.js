function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

const currentUser = JSON.parse(localStorage.getItem('glomek_user'));
const userToken = getCookie('glomek_token') || localStorage.getItem('glomek_token');

document.addEventListener('DOMContentLoaded', async () => {
    const contentCard = document.querySelector('.page-content-card');

    if (!currentUser || !userToken) {
        contentCard.innerHTML = `
            <h1 class="page-title">Your Orders</h1>
            <section class="page-section">
                <p style="margin-top:1rem;color:#565959;">Please <a href="../index.html" style="color:#007185;">log in on the main store</a> to view your orders.</p>
            </section>
        `;
        return;
    }

    // Replace Loading state
    contentCard.innerHTML = `
        <h1 class="page-title">Your Orders</h1>
        <div id="ordersList" style="min-height: 200px; position:relative;">
            <p style="text-align:center; padding: 2rem; color: #666;">Loading your orders...</p>
        </div>
    `;

    // Fetch Orders
    const orders = await ApiService.fetchUserOrders(currentUser._id, userToken);
    
    renderOrders(orders);
});

function renderOrders(orders) {
    const container = document.getElementById('ordersList');
    if (!orders || orders.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 3rem 1rem;">
                <span class="material-symbols-rounded" style="font-size: 3rem; color: #ccc;">receipt_long</span>
                <p style="margin-top: 1rem; color: #565959;">You haven't placed any orders yet.</p>
                <a href="../index.html" class="checkout-btn" style="display:inline-block; margin-top: 1rem; text-decoration: none;">Start Shopping</a>
            </div>
        `;
        return;
    }

    // Sort orders by most recent
    orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    let html = '<div style="display:flex; flex-direction:column; gap:1.5rem;">';

    orders.forEach(order => {
        const date = new Date(order.createdAt || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        const itemsList = (order.items || []).map(i => {
           return `<div style="display:flex; justify-content:space-between; margin-bottom: 0.5rem; font-size: 0.9rem;">
                <span>${i.quantity}x ${i.productName || i.name || 'Product'}</span>
                <span>GH₵${(i.price * i.quantity).toFixed(2)}</span>
           </div>`;
        }).join('');

        const statusColor = order.orderStatus === 'delivered' ? '#007600' : (order.orderStatus === 'cancelled' ? '#d00000' : '#f68b1e');

        html += `
            <div style="border: 1px solid #D5D9D9; border-radius: 8px; overflow: hidden;">
                <div style="background: #f0f2f2; padding: 1rem; border-bottom: 1px solid #D5D9D9; display: flex; justify-content: space-between; align-items:flex-start; flex-wrap: wrap; gap: 1rem;">
                    <div style="display:flex; gap: 2rem; flex-wrap: wrap;">
                        <div>
                            <div style="font-size:0.75rem; color:#565959; text-transform:uppercase;">Order Placed</div>
                            <div style="font-size:0.9rem;">${date}</div>
                        </div>
                        <div>
                            <div style="font-size:0.75rem; color:#565959; text-transform:uppercase;">Total</div>
                            <div style="font-size:0.9rem; font-weight:bold;">GH₵${(order.totalPrice || 0).toFixed(2)}</div>
                        </div>
                        <div>
                            <div style="font-size:0.75rem; color:#565959; text-transform:uppercase;">Dispatch To</div>
                            <div style="font-size:0.9rem; color:#007185;">${currentUser.name || 'Customer'}</div>
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size:0.75rem; color:#565959; text-transform:uppercase;">Order # ${order._id.substring(0, 12).toUpperCase()}</div>
                    </div>
                </div>
                
                <div style="padding: 1.5rem; display: flex; flex-direction:column; gap: 1rem;">
                    <div>
                        <h3 style="font-size:1.1rem; color: ${statusColor}; text-transform: capitalize; margin-bottom: 0.5rem;">${order.orderStatus || 'Pending'}</h3>
                        <div style="border-bottom: 1px solid #eee; padding-bottom: 1rem; margin-bottom: 1rem;">
                            ${itemsList}
                        </div>
                    </div>
                    <div style="display:flex; gap: 1rem;">
                        <button onclick='downloadOrderPDF(${JSON.stringify(order).replace(/'/g, "&apos;")})' class="checkout-btn" style="background:#fff; color:#111; border: 1px solid #D5D9D9; width:auto; padding: 8px 16px; font-size:0.9rem; display:flex; align-items:center; gap:6px;">
                            <span class="material-symbols-rounded" style="font-size:18px;">receipt_long</span> 
                            Download PDF Receipt
                        </button>
                    </div>
                </div>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
}

window.downloadOrderPDF = function(order) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        alert('PDF library not loaded. Please wait or refresh the page.');
        return;
    }
    const { jsPDF } = window.jspdf;

    const img = new Image();
    // In orders.js, we know we are in pages/orders.html, so relative path is:
    img.src = '../assets/logo/Glomek%20App%20Logo2.png';

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
    };

    img.onerror = function() {
        alert('Error loading logo for receipt PDF. Please check connection.');
    };
}

function formatPaymentMethod(method) {
    if (!method) return 'N/A';
    const map = {
        'mtn_mobile_money': 'MTN Mobile Money',
        'paystack_card': 'Card (Paystack)',
        'cash_on_delivery': 'Cash on Delivery'
    };
    return map[method] || method;
}
