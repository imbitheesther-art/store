// Builds the printable receipt markup.
//
// Both the live receipt shown after a sale and the "view" receipt for a past
// transaction render through this one function so they can never drift apart.

let moment = require('moment');
let JsBarcode = require('jsbarcode');


// Escapes text before it is injected into the receipt markup.
function esc(value) {

    if (value === undefined || value === null) {
        return '';
    }

    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}


// Renders a Code128 barcode to an inline <svg> string so it survives being
// written to a file and printed by the main process.
function barcodeSvg(value) {

    if (value === undefined || value === null || value === '') {
        return '';
    }

    try {
        let svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

        JsBarcode(svg, String(value), {
            format: 'CODE128',
            width: 1.3,
            height: 38,
            displayValue: true,
            fontSize: 11,
            margin: 3
        });

        return svg.outerHTML;
    }
    catch (err) {
        return '';
    }
}


function money(value) {

    let number = parseFloat(value);

    return isNaN(number) ? '' : number.toFixed(2);
}


function buildReceipt(opts) {

    let settings = opts.settings || {};
    let imgPath = opts.imgPath || '';
    let symbol = settings.symbol === undefined ? '' : settings.symbol;
    let items = opts.items || [];

    let rows = items.map(item => `<tr>
            <td>${esc(item.product_name)}</td>
            <td class="r">${esc(item.quantity)}</td>
            <td class="r">${esc(symbol + money(item.price))}</td>
        </tr>`).join('');

    let taxRow = '';

    if (settings.charge_tax) {
        taxRow = `<tr>
                <td>VAT (${esc(settings.percentage)}%)</td>
                <td>:</td>
                <td class="r">${esc(symbol + money(opts.tax))}</td>
            </tr>`;
    }

    let paymentRows = '';

    if (opts.paid !== '' && opts.paid !== undefined && opts.paid !== null) {
        paymentRows = `<tr>
                <td>Paid</td>
                <td>:</td>
                <td class="r">${esc(symbol + money(opts.paid))}</td>
            </tr>
            <tr>
                <td>Change</td>
                <td>:</td>
                <td class="r">${esc(symbol + money(Math.abs(opts.change)))}</td>
            </tr>
            <tr>
                <td>Method</td>
                <td>:</td>
                <td>${esc(opts.paymentType)}</td>
            </tr>`;

        // Extra detail line for M-Pesa code, card info or a split breakdown.
        if (opts.paymentInfo !== undefined && opts.paymentInfo !== null && String(opts.paymentInfo) !== '') {
            paymentRows += `<tr>
                <td>Details</td>
                <td>:</td>
                <td>${esc(opts.paymentInfo)}</td>
            </tr>`;
        }
    }

    let barcode = barcodeSvg(opts.barcode);

    let barcodeBlock = barcode ? `<div class="barcode">${barcode}</div>` : '';

    let logo = settings.img ? `<img class="logo" src="${esc(imgPath + settings.img)}" alt="" /><br>` : '';

    // The closing message is the shop's own footer text from Settings. If the
    // shop has not set one we print a neutral line instead - never the old
    // hard-coded "Thank you for your patronage!" which ignored the configured
    // footer entirely.
    let closingMsg = settings.footer ? esc(settings.footer) : 'Thank you for shopping with us!';

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Receipt</title>
<style>
    @page { margin: 4mm; }
    * { box-sizing: border-box; }
    body { font-family: "Courier New", monospace; font-size: 11px; margin: 0; color: #000; }
    .receipt { width: 100%; }
    .center { text-align: center; }
    .shop-name { font-size: 17px; font-weight: bold; }
    .logo { max-width: 90px; max-height: 60px; }
    hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; border-bottom: 1px solid #000; }
    th.r, td.r { text-align: right; }
    td { padding: 1px 0; vertical-align: top; }
    .total { font-size: 14px; font-weight: bold; }
    .barcode { text-align: center; margin-top: 6px; }
    .barcode svg { max-width: 100%; }
    .thanks { text-align: center; font-weight: bold; margin-top: 8px; }
    .footer { text-align: center; margin-top: 4px; }
</style>
</head>
<body>
<div class="receipt">

    <div class="center">
        ${logo}
        <span class="shop-name">${esc(settings.store)}</span><br>
        ${settings.address_one ? esc(settings.address_one) + '<br>' : ''}
        ${settings.address_two ? esc(settings.address_two) + '<br>' : ''}
        ${settings.contact ? 'Tel: ' + esc(settings.contact) + '<br>' : ''}
        ${settings.tax ? 'VAT No: ' + esc(settings.tax) + '<br>' : ''}
    </div>

    <hr>

    <div>
        Receipt No: ${esc(opts.orderNumber)}<br>
        ${opts.refNumber && opts.refNumber !== opts.orderNumber ? 'Ref No: ' + esc(opts.refNumber) + '<br>' : ''}
        Customer: ${esc(opts.customerName || 'Walk-in Customer')}<br>
        Cashier: ${esc(opts.cashier)}<br>
        Date: ${esc(moment(opts.date).format('DD MMM YYYY HH:mm:ss'))}<br>
    </div>

    <hr>

    <table>
        <thead>
            <tr><th>Item</th><th class="r">Qty</th><th class="r">Price</th></tr>
        </thead>
        <tbody>
            ${rows}
            <tr>
                <td>Subtotal</td>
                <td>:</td>
                <td class="r">${esc(symbol + money(opts.subtotal))}</td>
            </tr>
            ${parseFloat(opts.discount) > 0 ? `<tr>
                <td>Discount</td><td>:</td>
                <td class="r">${esc(symbol + money(opts.discount))}</td>
            </tr>` : ''}
            ${taxRow}
            <tr class="total">
                <td>TOTAL</td>
                <td>:</td>
                <td class="r">${esc(symbol + money(opts.total))}</td>
            </tr>
            ${paymentRows}
        </tbody>
    </table>

    ${barcodeBlock}

    <hr>

    <p class="thanks">${closingMsg}</p>
    <p class="center">Served by ${esc(opts.cashier)}</p>

</div>
</body>
</html>`;
}


module.exports = {
    buildReceipt: buildReceipt,
    barcodeSvg: barcodeSvg
};