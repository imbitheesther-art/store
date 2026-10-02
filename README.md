# Store Point of Sale
 Desktop Point of Sale app built with electron
 
  **Features:**

- Can be used by multiple PC's on a network with one central database.
- Receipt Printing.
- Search for product by barcode.
- Staff accounts and permissions. 
- Products and Categories.
- Basic Stock Management.
- Open Tabs (Orders).
- Customer Database. 
- Transaction History. 
- Filter Transactions by Till, Cashier or Status. 
- Filter Transactions by Date Range. 

 **To use on Windows:**

Run `release-builds\StorePOS-Setup-1.0.0.exe` - the installer installs the POS on any 64-bit Windows machine.

  **Kenya defaults:**

- **Currency is Kenyan Shillings (KSh)** across the whole app - cart, payment, change, printed receipts, reports and inventory.
- **VAT defaults to 16%** (the Kenya standard rate). Toggle "Charge Vat" in Settings to switch VAT on or off.
- The symbol stays editable under **Settings > Currency Symbol**. Save it as `KSh ` (with the trailing space) for the standard look, e.g. `KSh 1,500.00`.
- On start-up the server migrates any legacy symbol (`$`, `EUR`, `GBP`, ...) to `KSh`, so existing tills switch over automatically.

  **Building the Windows installer from source:**

```bash
npm install
npm run dist
```

This produces `release-builds\StorePOS-Setup-1.0.0.exe`, a single self-contained installer you can copy to any 64-bit Windows machine. It offers a destination folder, creates Desktop and Start Menu shortcuts, and uninstalls cleanly from "Apps & features". User data (products, sales, settings) lives in `%APPDATA%\POS` and is **kept** on uninstall.

| Script | Purpose |
| --- | --- |
| `npm run electron` | Run the desktop app straight from source (dev) |
| `npm start` | Run just the local API server on port 8001 |
| `npm run pack` | Unpacked build in `release-builds\win-unpacked` (no installer) |
| `npm run dist` | Build the `Setup.exe` NSIS installer |
| `node build.js` | Same as `npm run dist` |

The default username and password is  **admin**

  **Looking for a Desktop Invoicing app?**
  
 Check out the [Offline Invoicing](https://github.com/tngoman/Offline_Invoicing) app for freelancers.

**To Customize/Create your own installer**

- Clone this project.
- Open terminal and navigate into the cloned folder.
- Run "npm install" to install dependencies.
- Run "npm run electron". 

![POS](https://github.com/tngoman/Store-POS/blob/master/screenshots/pos.jpg)

![Transactions](https://github.com/tngoman/Store-POS/blob/master/screenshots/transactions.jpg)

![Receipt](https://github.com/tngoman/Store-POS/blob/master/screenshots/receipt.jpg)

![Permissions](https://github.com/tngoman/Store-POS/blob/master/screenshots/permissions.jpg)

![Users](https://github.com/tngoman/Store-POS/blob/master/screenshots/users.jpg)
# store
