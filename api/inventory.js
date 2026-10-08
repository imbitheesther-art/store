
const app = require( "express")();
const server = require( "http" ).Server( app );
const bodyParser = require( "body-parser" );
const fileUpload = require('express-fileupload');

const Datastore = require("nedb");
const async = require("async");

const multer = require("multer");
const fs = require('fs');


const dbpath = require("./dbpath");

const storage = multer.diskStorage({
    destination: function (req, file, callback) {
        callback(null, dbpath.uploadsDir());
    },
    filename: function (req, file, callback) {
        callback(null, Date.now() + '.jpg'); // 
    }
});


let upload = multer({ storage: storage });

app.use(bodyParser.json());


module.exports = app;


let inventoryDB = new Datastore({
    filename: dbpath.dbFile("inventory.db"),
    autoload: true
});


inventoryDB.ensureIndex({ fieldName: '_id', unique: true });


// Assigns the product an unused millisecond-based id and inserts it.
function insertWithFreeId(product, attempt, done) {

    let candidate = Date.now() + attempt;

    inventoryDB.findOne({ _id: candidate }, function (err, existing) {

        if (err) {
            return done(err);
        }

        if (existing) {
            return insertWithFreeId(product, attempt + 1, done);
        }

        product._id = candidate;

        inventoryDB.insert(product, done);

    });

}


app.get("/", function (req, res) {
    res.send("Inventory API");
});



app.get("/product/:productId", function (req, res) {
    if (!req.params.productId) {
        res.status(500).send("ID field is required.");
    } else {
        inventoryDB.findOne({
            _id: parseInt(req.params.productId)
        }, function (err, product) {
            res.send(product);
        });
    }
});



app.get("/products", function (req, res) {
    inventoryDB.find({}, function (err, docs) {
        res.send(docs);
    });
});



app.post("/product", upload.single('imagename'), function (req, res) {

    let image = '';

    if (req.body.img != "") {
        image = req.body.img;
    }

    if (req.file) {
        image = req.file.filename;
    }


    if (req.body.remove == 1) {
        // Images live in the user data folder, not next to the app bundle.
        const path = require("path").join(dbpath.uploadsDir(), req.body.img);
        try {
            fs.unlinkSync(path)
        } catch (err) {
            console.error(err)
        }

        if (!req.file) {
            image = '';
        }
    }

    let Product = {
        _id: parseInt(req.body.id),
        price: req.body.price,
        category: req.body.category,
        quantity: req.body.quantity == "" ? 0 : req.body.quantity,
        name: req.body.name,
        stock: req.body.stock == "on" ? 0 : 1,
        img: image
    }

    if (req.body.id == "") {

        // Ids used to be second-resolution timestamps (Date.now()/1000), so two
        // products saved within the same second collided on the unique _id index
        // and the second insert was silently rejected. Millisecond ids plus a
        // uniqueness check keep the "Add another" flow working.
        insertWithFreeId(Product, 0, function (err, product) {
            if (err) {
                console.error(err);
                res.status(500).send(err);
            }
            else res.send(product);
        });

    }
    else {
        inventoryDB.update({
            _id: parseInt(req.body.id)
        }, Product, {}, function (
            err,
            numReplaced,
            product
        ) {
            if (err) res.status(500).send(err);
            else res.sendStatus(200);
        });

    }

});




app.delete("/product/:productId", function (req, res) {
    inventoryDB.remove({
        _id: parseInt(req.params.productId)
    }, function (err, numRemoved) {
        if (err) res.status(500).send(err);
        else res.sendStatus(200);
    });
});



app.post("/product/sku", function (req, res) {
    var request = req.body;
    inventoryDB.findOne({
        _id: parseInt(request.skuCode)
    }, function (err, product) {
        res.send(product);
    });
});




app.decrementInventory = function (products) {

    async.eachSeries(products, function (transactionProduct, callback) {
        inventoryDB.findOne({
            _id: parseInt(transactionProduct.id)
        }, function (
            err,
            product
        ) {

            if (!product || !product.quantity) {
                callback();
            } else {
                let updatedQuantity =
                    parseInt(product.quantity) -
                    parseInt(transactionProduct.quantity);

                inventoryDB.update({
                    _id: parseInt(product._id)
                }, {
                    $set: {
                        quantity: updatedQuantity
                    }
                }, {},
                    callback
                );
            }
        });
    });
};