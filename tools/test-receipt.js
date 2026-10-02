// Renders a sample receipt using the real builder so the output can be checked
// without launching the Electron UI.
//   node tools/test-receipt.js

global.document = {
    createElementNS: function (ns, tag) {
        // Minimal stand-in: the barcode renderer only needs somewhere to draw.
        return {
            tagName: tag,
            outerHTML: '<svg data-fake="1"></svg>',
            setAttribute: function () { },
            appendChild: function () { },
            style: {}
        };
    }
};

let builder = require('../assets/js/receipt.js');

let receipt = builder.buildReceipt({
    settings: {
        store: 'Nairobi Mini Mart',
        address_one: 'Moi Avenue',
        address_two: 'Nairobi, Kenya',
        contact: '0722 123 456',
        tax: 'VAT-PK-001',
        symbol: 'KSh ',
        percentage: '16',
        charge_tax: true,
        footer: 'Karibu tena!',
        img: 'logo.jpg'
    },
    imgPath: 'C:/Users/demo/AppData/Roaming/POS/uploads/',
    orderNumber: '1700000000',
    refNumber: 'REF-99',
    customerName: 'Jane Wanjiru',
    cashier: 'Mary Atieno',
    date: new Date('2026-02-10T09:30:00'),
    items: [
        { product_name: 'Maize Flour 2kg', quantity: 2, price: '180.50' },
        { product_name: 'Cooking Oil 1L', quantity: 1, price: '350.00' }
    ],
    subtotal: 711.0,
    discount: 50,
    tax: 105.76,
    total: 766.76,
    paid: '1000.00',
    change: 233.24,
    paymentType: 'Cash',
    barcode: '1700000000'
});

const checks = [
    ['shop name', 'Nairobi Mini Mart'],
    ['location', 'Nairobi, Kenya'],
    ['phone', '0722 123 456'],
    ['vat number', 'VAT-PK-001'],
    ['logo', 'logo.jpg'],
    ['customer', 'Jane Wanjiru'],
    ['cashier', 'Mary Atieno'],
    ['currency amount', 'KSh 180.50'],
    ['subtotal', 'KSh 711.00'],
    ['discount', 'KSh 50.00'],
    ['vat', 'KSh 105.76'],
    ['total', 'KSh 766.76'],
    ['change', 'KSh 233.24'],
    ['payment method', 'Cash'],
    ['ref number', 'REF-99'],
    ['barcode svg', '<svg'],
    ['thank you', 'Thank you for your patronage'],
    ['footer', 'Karibu tena!']
];

let failed = 0;

checks.forEach(([label, needle]) => {
    let ok = receipt.includes(needle);
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(16)} -> ${needle}`);
});

console.log(`\nReceipt length: ${receipt.length} chars`);
console.log(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);

process.exit(failed === 0 ? 0 : 1);