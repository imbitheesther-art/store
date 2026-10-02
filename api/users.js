const app = require( "express")();
const server = require( "http" ).Server( app );
const bodyParser = require( "body-parser" );
const Datastore = require( "nedb" );
const btoa = require('btoa');
app.use( bodyParser.json() );

module.exports = app;

 
let usersDB = new Datastore( {
    filename: process.env.APPDATA+"/POS/server/databases/users.db",
    autoload: true
} );


usersDB.ensureIndex({ fieldName: '_id', unique: true });


// Assigns the user an unused millisecond-based id and inserts it.
//
// Date.now() / 1000 only resolves to the second, so two users created in the
// same second produced the same _id and the second insert was silently
// rejected by the unique index.
function insertWithFreeId(user, attempt, done) {

    let candidate = Date.now() + attempt;

    usersDB.findOne({ _id: candidate }, function (err, existing) {

        if (err) {
            return done(err);
        }

        if (existing) {
            return insertWithFreeId(user, attempt + 1, done);
        }

        user._id = candidate;

        usersDB.insert(user, done);

    });

}


app.get( "/", function ( req, res ) {
    res.send( "Users API" );
} );


  
app.get( "/user/:userId", function ( req, res ) {
    if ( !req.params.userId ) {
        res.status( 500 ).send( "ID field is required." );
    }
    else{
    usersDB.findOne( {
        _id: parseInt(req.params.userId)
}, function ( err, docs ) {
        res.send( docs );
    } );
    }
} );



app.get( "/logout/:userId", function ( req, res ) {
    if ( !req.params.userId ) {
        res.status( 500 ).send( "ID field is required." );
    }
    else{ usersDB.update( {
            _id: parseInt(req.params.userId)
        }, {
            $set: {
                status: 'Logged Out_'+ new Date()
            }
        }, {},
    );

    res.sendStatus( 200 );
 
    }
});



app.post( "/login", function ( req, res ) {  
    usersDB.findOne( {
        username: req.body.username,
        password: btoa(req.body.password)

}, function ( err, docs ) {
        if(docs) {
            usersDB.update( {
                _id: docs._id
            }, {
                $set: {
                    status: 'Logged In_'+ new Date()
                }
            }, {},
            
        );
        }
        res.send( docs );
    } );
    
} );




app.get( "/all", function ( req, res ) {
    usersDB.find( {}, function ( err, docs ) {
        res.send( docs );
    } );
} );



app.delete( "/user/:userId", function ( req, res ) {
    usersDB.remove( {
        _id: parseInt(req.params.userId)
    }, function ( err, numRemoved ) {
        if ( err ) res.status( 500 ).send( err );
        else res.sendStatus( 200 );
    } );
} );

 
app.post( "/post" , function ( req, res ) {   
    let User = { 
            "username": req.body.username,
            "password": btoa(req.body.password),
            "fullname": req.body.fullname,
            "perm_products": req.body.perm_products == "on" ? 1 : 0,
            "perm_categories": req.body.perm_categories == "on" ? 1 : 0,
            "perm_transactions": req.body.perm_transactions == "on" ? 1 : 0,
            "perm_users": req.body.perm_users == "on" ? 1 : 0,
            "perm_settings": req.body.perm_settings == "on" ? 1 : 0,
            "status": ""
          }

    if(req.body.id == "") { 
       insertWithFreeId( User, 0, function ( err, user ) {
            if ( err ) res.status( 500 ).send( err );
            else res.send( user );
        });
    }
    else { 
        usersDB.update( {
            _id: parseInt(req.body.id)
                    }, {
                        $set: {
                            username: req.body.username,
                            password: btoa(req.body.password),
                            fullname: req.body.fullname,
                            perm_products: req.body.perm_products == "on" ? 1 : 0,
                            perm_categories: req.body.perm_categories == "on" ? 1 : 0,
                            perm_transactions: req.body.perm_transactions == "on" ? 1 : 0,
                            perm_users: req.body.perm_users == "on" ? 1 : 0,
                            perm_settings: req.body.perm_settings == "on" ? 1 : 0
                        }
                    }, {}, function (
            err,
            numReplaced,
            user
        ) {
            if ( err ) res.status( 500 ).send( err );
            else res.sendStatus( 200 );
        } );

    }

});


// Seeds the default admin account on a fresh install, then always answers.
//
// This used to seed without ever calling res.send(), so the request hung until
// the client gave up. pos.js calls it on startup, which made the app look like
// it could not reach its own server.
app.get( "/check", function ( req, res ) {

    usersDB.findOne( {
        _id: 1
    }, function ( err, docs ) {

        if ( err ) {
            return res.status( 500 ).send( err );
        }

        if ( docs ) {
            return res.send( { checked: true, seeded: false } );
        }

        let User = {
            "_id": 1,
            "username": "admin",
            "password": btoa("admin"),
            "fullname": "Administrator",
            "perm_products": 1,
            "perm_categories": 1,
            "perm_transactions": 1,
            "perm_users": 1,
            "perm_settings": 1,
            "status": ""
        }

        usersDB.insert( User, function ( insertErr, user ) {

            // A unique-index violation only means somebody else seeded first.
            if ( insertErr && insertErr.errorType !== 'uniqueViolated' ) {
                return res.status( 500 ).send( insertErr );
            }

            res.send( { checked: true, seeded: true } );

        } );

    } );

} );
 