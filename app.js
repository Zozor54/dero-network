 var express = require('express'),
    app = express(),
    server = require('http').createServer(app),
    socketIo = require('socket.io'),
    async = require('async'),
    request = require('request-json');


var MongoClient = require("mongodb").MongoClient;
var winston = require('winston');
var mongoDbConnection = require('./lib/mongodb-singleton.js');

app.use(express.static(__dirname + '/public'));



var api = require('./lib/api.js');

global.collectedStats = {};
global.collectedNodes = {};
global.deroDag = null;
global.globalCurrentHeight = 0;
global.maxHeight = 0;
global.io = socketIo.listen(server);

var giveUpdateSomeone = false;
var socketRefresh = null;
var baseBlockPropagation = null;
var endBlockPropagation = null;
var hasNewBlock = [];

const FIRST_BLOCK = 9550;
const REFRESH_TIME = '500';
const API_KEY = 'c3295d20321531f9207bbc435f04971c';
const IP_BANNED = ['195.154.220.29'];
const SERVER_VERSION = '0.1';

app.get('/', function (req, res) {
  res.sendfile(__dirname + '/public/index.html');
});

app.get('/json', function (req, res) {
  res.send(JSON.stringify(collectedStats));
});

mongoDbConnection(function(databaseConnection) {
    databaseConnection.collection("block").find().sort({_id: -1}).limit(1).toArray(function (error, result) {
        // Check if we have block in database
        if (!result[0]) {
            global.globalCurrentHeight = FIRST_BLOCK;
        } else {
            global.globalCurrentHeight = result[0].block_header.topoheight;
        }

        // USER SOCKET ROOM
        io.of('/website').on('connection', function (socket) { 

            if (collectedStats.hasOwnProperty('get_info')) {
                socket.emit('daemon', collectedStats);
            }

            if(deroDag != null) {
                socket.emit('derodag', deroDag);
            }

            socket.on('latency', function (startTime, cb) {
                cb(startTime);
            });
        });

        // NODE SOCKET ROOM
        io.of('/nodes').on('connection', function (socket) {
            // Sending interval of refresh
            socket.emit('refreshTime', REFRESH_TIME);

            // Get real ip
            var ip = socket.handshake.address.substring(7);

            if (IP_BANNED.indexOf(ip) !== -1) {
                socket.emit('banned', 'You are banned');
                return;
            }

            socket.on('disconnect', function() {
                if (collectedNodes.hasOwnProperty(ip)) {
                    // node disconnect
                    io.of('/website').emit('node-disconnect', collectedNodes[ip]);
                    delete collectedNodes[ip];
                }
            });

            socket.on('version', function(nodeVersion) {
                if (nodeVersion !== SERVER_VERSION) {
                    socket.emit('banned', 'You have to update your node-side version. This version is no longer supported.');
                    return;
                }
            });

            if (!collectedNodes.hasOwnProperty(ip)) {
                collectedNodes[ip] = {};
                // I need to check my database
                mongoDbConnection(function(databaseConnection) {
                    databaseConnection.collection("geo_node").findOne( { 'ip': ip }, function (error, result) {
                        if (!result) {
                            // First time for this node
                            var client = request.createClient('http://api.ipstack.com/');
                            client.headers['Content-Type'] = 'application/json';
                            client.get(ip+'?access_key='+API_KEY, null, function(err, res, body) {
                                if (!err) {
                                    var newEntry = {
                                        ip: ip,
                                        latitude: body.latitude,
                                        longitude: body.longitude
                                    };

                                    databaseConnection.collection("geo_node").insert(newEntry, null, function (error, results) {
                                        if (error) throw error;
                                        winston.log('info', 'nodes --- New GPS entry');
                                        collectedNodes[ip].geo = {
                                            latitude: body.latitude,
                                            longitude: body.longitude
                                        };
                                    });
                                }
                            });
                        } else {
                            collectedNodes[ip].geo = {
                                latitude: result.latitude,
                                longitude: result.longitude
                            };
                        }
                    });
                });

            }

            socket.on('latency', function (startTime, cb) {
                cb(startTime);
            });

            socket.on('nodes', function (data) {
                var ip = socket.handshake.address.substring(7);
                data.informations.name = data.informations.name.replace(/[<>\\?!&"'/]*/ig, '');
                collectedNodes[ip].data = data;
                collectedNodes[ip].block = globalCurrentHeight;

                if (data.lastBlockHeader.topoheight == globalCurrentHeight) {
                    // Node propagation
                    hasNewBlock.push(ip);
                    var myTime = parseInt((Date.now() - data.latency));
                    var myPropagation = myTime - parseInt(baseBlockPropagation);
                    if (myPropagation < 0) myPropagation = 0;
                    collectedNodes[ip].propagation = myPropagation;

                    // Network propagation
                    /*if (Object.keys(collectedNodes).length === hasNewBlock.length) {
                        console.log('block propagation : ' + myTime - parseInt(baseBlockPropagation));
                    }*/
                }
                
                if (data.lastBlockHeader.topoheight > globalCurrentHeight && data.lastBlockHeader.topoheight - globalCurrentHeight == 1) {
                    // New Block -- save the "base time"
                    baseBlockPropagation = Date.now() - data.latency;
                    hasNewBlock.push(ip);
                    collectedNodes[ip].propagation = 0;
                    // Recent Block
                    globalCurrentHeight = data.lastBlockHeader.topoheight;
                    // Ask block_information and store it
                    socket.emit('block_information', globalCurrentHeight);
                    // Now we need use this informations
                    collectedStats = data;
                    // We have to cancel the last refresh socket
                    if (socketRefresh !== null) {
                        socketRefresh.emit('stop-your-refresh', null);
                    }
                    // Your are the faster to have the last block -- you will send broadcast now :)
                    socket.emit('refresh-keep-alive', null);
                    socketRefresh = socket;
                } else if (data.lastBlockHeader.topoheight >= globalCurrentHeight && !collectedStats.hasOwnProperty('get_info')) {
                    // Start daemon we need some informations
                    collectedStats = data;
                    api.getChart();
                } else if (data.lastBlockHeader.topoheight > globalCurrentHeight) {
                    // Synchronised DB 
                    // Je dois lui dire de m'envoyer les blocs
                    maxHeight = data.lastBlockHeader.topoheight;
                    askUpdate(maxHeight);
                }

                /*if (data.lastBlockHeader.topoheight == globalCurrentHeight && !refreshTxPool) {
                    refreshTxPool = true;
                    io.of('/website').emit('broadcast', {'txPool': data.get_info.txPool });
                    refreshTxPool = false;
                }*/

                // Send to website
                if (collectedNodes[ip].hasOwnProperty('geo')) {
                    io.of('/website').emit('node', collectedNodes[ip]);
                }

            });

            socket.on('refresh-keep-alive', function(data) {
                io.of('/website').emit('broadcast', {'txPool': data.txPool });
            });

            socket.on('update_block', function(data) {
                mongoDbConnection(function(databaseConnection) {
                    databaseConnection.collection("block").insert(data.getblock, null, function (error, results) {
                        if (error) throw error;
                        winston.log('info', 'api -- Block '+data.getblock.block_header.topoheight+' enregistré.');
                        var query = { "block_header.topoheight": data.getblock.block_header.topoheight - 50 };
                        databaseConnection.collection("block").remove(query, function (err, obj) {
                            if (obj.result.n > 0) {
                                winston.log('info', 'api -- Block ' + (data.getblock.block_header.topoheight-50) + ' deleted.');
                            }
                        });
                        collectedStats.block_timestamp = (Date.now() / 1000) - data.getblock.block_header.timestamp;
                        // I need refresh chart
                        api.getChart();
                        if (giveUpdateSomeone) {
                            giveUpdateSomeone = false;
                            askUpdate(maxHeight);
                        }
                        api.getDeroDag();
                    });
                });
            });

            function askUpdate(height) {
                if (!giveUpdateSomeone && height > globalCurrentHeight) {
                    giveUpdateSomeone = true;
                    globalCurrentHeight++;
                    socket.emit('block_information', globalCurrentHeight);
                }
            }
        });
    });
});

server.listen(8080);