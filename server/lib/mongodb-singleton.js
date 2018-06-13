var MongoClient = require("mongodb").MongoClient;
var winston = require('winston');
//the MongoDB connection
let dbConnectionPromise;
module.exports = function(callback) {

if (dbConnectionPromise) {
  callback(dbConnectionPromise);
    return;
  }
MongoClient.connect("mongodb://localhost/dero-network", function(error, db) {
    if (error) return funcCallback(error);
    dbConnectionPromise = db;
    winston.log('info', 'database -- Connected to the database dero-network');
    callback(dbConnectionPromise);
  });
}