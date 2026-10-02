const app = require( "express")();
const server = require( "http" ).Server( app );
const bodyParser = require( "body-parser" );
const Datastore = require( "nedb" );
const multer = require("multer");
const fileUpload = require('express-fileupload');
const fs = require('fs');


// Kenya (KSh) defaults. Every fresh machine boots into Kenyan Shillings.
const DEFAULT_CURRENCY = "KSh ";
const DEFAULT_VAT_PERCENTAGE = "16";

// Symbols shipped by earlier builds / other markets. These are migrated to
// Kenyan Shillings on server start so an existing till switches over cleanly.
const LEGACY_CURRENCY_SYMBOLS = [
    "$", "US$", "USD", "usd", "$us",
    "€", "EUR", "eur",
    "£", "GBP", "gbp",
    "₹", "Rs", "Rs.", "INR",
    "R", "ZAR",
    "₦", "NGN",
    "¢"
];

function normaliseCurrency(symbol) {
    let value = (symbol === undefined || symbol === null) ? "" : String(symbol).trim();

    if (value === "" || LEGACY_CURRENCY_SYMBOLS.indexOf(value) > -1) {
        return DEFAULT_CURRENCY;
    }

    return value;
}


function normalisePercentage(percentage) {
    if (percentage === undefined || percentage === null || String(percentage).trim() === "") {
        return DEFAULT_VAT_PERCENTAGE;
    }

    return percentage;
}


const storage = multer.diskStorage({
    destination:  process.env.APPDATA+'/POS/uploads',
    filename: function(req, file, callback){
        callback(null, Date.now() + '.jpg'); // 
    }
});

let upload = multer({storage: storage});

app.use( bodyParser.json() );

module.exports = app;

 
let settingsDB = new Datastore( {
    filename: process.env.APPDATA+"/POS/server/databases/settings.db",
    autoload: true
} );

settingsDB.ensureIndex({ fieldName: '_id', unique: true });


// Force already-configured tills onto Kenyan Shillings / Kenya VAT rate.
settingsDB.findOne( { _id: 1 }, function ( err, doc ) {

    if ( err || !doc || !doc.settings ) {

        // No settings stored yet: leave it blank so the first-run setup
        // wizard still opens and the user supplies their store details.
        return;
    }

    let updates = {};

    if ( normaliseCurrency( doc.settings.symbol ) !== doc.settings.symbol ) {
        updates["settings.symbol"] = normaliseCurrency( doc.settings.symbol );
    }

    if ( normalisePercentage( doc.settings.percentage ) !== doc.settings.percentage ) {
        updates["settings.percentage"] = normalisePercentage( doc.settings.percentage );
    }

    if ( Object.keys( updates ).length > 0 ) {
        settingsDB.update( { _id: 1 }, { $set: updates }, {}, function ( updateErr ) {
            if ( updateErr ) console.error( updateErr );
            else console.log( "Settings migrated to Kenyan Shillings (KSh)" );
        } );
    }

} );



app.get( "/", function ( req, res ) {
    res.send( "Settings API" );
} );


  
app.get( "/get", function ( req, res ) {
    settingsDB.findOne( {
        _id: 1
}, function ( err, docs ) {
        res.send( docs );
    } );
} );

 
app.post( "/post", upload.single('imagename'), function ( req, res ) {

    let image = '';

    if(req.body.img != "") {
        image = req.body.img;       
    }

    if(req.file) {
        image = req.file.filename;  
    }

    if(req.body.remove == 1) {
        const path = process.env.APPDATA+"/POS/uploads/"+ req.body.img;
        try {
          fs.unlinkSync(path)
        } catch(err) {
          console.error(err)
        }

        if(!req.file) {
            image = '';
        }
    } 
    
  
    let Settings = {  
        _id: 1,
        settings: {
            "app": req.body.app,
            "store": req.body.store,
            "address_one": req.body.address_one,
            "address_two":req.body.address_two,
            "contact": req.body.contact,
            "tax": req.body.tax,
            "symbol": normaliseCurrency(req.body.symbol),
            "percentage": normalisePercentage(req.body.percentage),
            "charge_tax": req.body.charge_tax,
            "footer": req.body.footer,
            "img": image
        }       
    }

    if(req.body.id == "") { 
        settingsDB.insert( Settings, function ( err, settings ) {
            if ( err ) {
                console.error( err );
                res.status( 500 ).send( err );
            }
            else res.send( settings );
        });
    }
    else { 
        settingsDB.update( {
            _id: 1
        }, Settings, {}, function (
            err,
            numReplaced,
            settings
        ) {
            if ( err ) {
                console.error( err );
                res.status( 500 ).send( err );
            }
            else res.sendStatus( 200 );
        } );

    }

});

 