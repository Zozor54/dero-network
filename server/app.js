 var express = require('express'),
    app = express(),
    server = require('http').createServer(app),
    socketIo = require('socket.io'),
    async = require('async'),
    request = require('request-json'),
    bodyParser = require('body-parser');


var MongoClient = require("mongodb").MongoClient;
var winston = require('winston');
var mongoDbConnection = require('./lib/mongodb-singleton.js');

app.use(express.static(__dirname + '/website'));
app.use(bodyParser());

var api = require('./lib/api.js');
var config = require('./config.json');
var securityPending = [];

global.collectedStats = {};
global.collectedNodes = {};
global.deroDag = null;
global.globalCurrentHeight = 0;
global.reducer = (accumulator, currentValue) => accumulator + currentValue;

global.io = socketIo.listen(server);

var socketRefresh = null;
var baseBlockPropagation = null;
var endBlockPropagation = null;
var hasNewBlock = [];
var blocktimePropagation = new Map();
var blockInProgress = [];

const SERVER_PORT = 8080;
const API_KEY = 'c3295d20321531f9207bbc435f04971c';
const IP_BANNED = [];
const SERVER_VERSION = '0.3';

app.get('/', function (req, res) {
  res.sendfile(__dirname + '/website/index.html');
});

app.get('/json', function (req, res) {
  res.send(JSON.stringify(collectedStats));
});

require('./lib/website.js');

mongoDbConnection(function(databaseConnection) {
    databaseConnection.collection("block").drop(function (error, delOk) {

        // EVERY 60s we request security check for sync node
        setInterval(function() {
            if (securityPending.length !== 0) {
                winston.log('info', securityPending.length + ' nodes are in security checks pending.');
                securityPending.forEach(function(socket) {
                    socket.emit('security-check', config.security.hash);
                });
            }
        }, 1000 * 60 * config.security.time_check);

        // NODE SOCKET ROOM
        io.of('/nodes').on('connection', function (socket) {
            // Get real ip
            var ip = socket.handshake.address.substring(7);

            if (IP_BANNED.indexOf(ip) !== -1) {
                socket.emit('banned', 'You are banned');
                return;
            }

            // First things : security check
            socket.emit('security-check', config.security.hash);

            socket.on('security-check', function(json) {

                if(!collectedNodes.hasOwnProperty(ip)) {
                    collectedNodes[ip] = {};
                    collectedNodes[ip].propagation = {};
                    collectedNodes[ip].propagation.historyData = [];
                    collectedNodes[ip].propagation.historyLabels = [];
                    collectedNodes[ip].propagation.historyColors = [];
                }

                // Controle de sécurité
                if (json.block_header !== undefined &&
                    (json.block_header.topoheight !== undefined && json.block_header.topoheight == config.security.topoheight) &&
                    (json.block_header.hash !== undefined && json.block_header.hash == config.security.hash) &&
                    (json.block_header.nonce !== undefined && json.block_header.nonce == config.security.nonce)) {

                    // This node is no more in pending
                    if (securityPending.indexOf(socket) !== -1) {
                        securityPending.splice(securityPending.indexOf(socket), 1);
                    }

                    collectedNodes[ip].isSecure = true;
                    geoNode(ip);
                    socket.emit('security-result', 'SUCCESS');
                    // Sending interval of refresh
                    socket.emit('refreshTime', config.nodes.refresh_time);
                } else if (json.error !== undefined && json.error.code === -32602) {
                    // This node has not yet sync security block
                    if (securityPending.indexOf(socket) === -1) {
                        securityPending.push(socket);
                        collectedNodes[ip].isSecure = false;
                        geoNode(ip);
                    }
                    socket.emit('security-result', 'WAITING');
                } else {
                    // Wrong blockchain or wrong daemon
                    socket.emit('banned', 'Data verification failed');
                    winston.log('error', ip + ' was banned. Security checks failed.');
                }
            });

            socket.on('disconnect', function() {
                if (collectedNodes.hasOwnProperty(ip)) {
                    // node disconnect
                    io.of('/website').emit('node-disconnect', collectedNodes[ip]);
                    if (collectedNodes.hasOwnProperty(ip)) {
                        delete collectedNodes[ip];
                    }

                    if (securityPending.indexOf(socket) !== -1) {
                        securityPending.splice(securityPending.indexOf(socket), 1);
                    }
                }
            });

            socket.on('version', function(nodeVersion) {
                if (nodeVersion !== SERVER_VERSION) {
                    socket.emit('banned', 'You have to update your node-side version. This version is no longer supported.');
                    return;
                }
            });

            function geoNode(ip) {
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
                                        socket.myId = newEntry._id.toString();
                                        collectedNodes[ip].geo = {
                                            latitude: body.latitude,
                                            longitude: body.longitude
                                        };

                                    });
                                }
                            });
                        } else {
                            socket.myId = result._id.toString();
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
                if (!collectedNodes.hasOwnProperty(ip) && !collectedNodes[ip].isSecure) {
                    return;
                }
                data.informations.id = socket.myId;
                data.informations.name = data.informations.name.replace(/[<>\\?!&"'/]*/ig, '');
                data.informations.description = data.informations.description.replace(/[<>\\?!&"'/]*/ig, '');
                collectedNodes[ip].data = data;
                collectedNodes[ip].block = globalCurrentHeight;

                if (data.lastBlockHeader.topoheight == globalCurrentHeight) {
                    // Node propagation
                    //hasNewBlock.push(ip);
                    storeblockPropagation(data, ip, false);

                    // Network propagation
                    /*if (Object.keys(collectedNodes).length === hasNewBlock.length) {
                        blocktimePropagation.set(globalCurrentHeight, myTime - parseInt(baseBlockPropagation));
                        hasNewBlock = [];
                        console.dir(blocktimePropagation);
                    }*/

                }

                askUpdate(data.lastBlockHeader);
                
                if (data.lastBlockHeader.topoheight > globalCurrentHeight) {
                    // Block propagation
                    storeblockPropagation(data, ip, true);
                    // Recent Block
                    globalCurrentHeight = data.lastBlockHeader.topoheight;
                    // Now we need use this informations
                    collectedStats = data;
                    collectedStats.block_timestamp = (Date.now() / 1000) - data.lastBlockHeader.timestamp;
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
                    //api.getDeroDag();
                }

                // Send to website
                if (collectedNodes[ip].hasOwnProperty('geo')) {
                    io.of('/website').emit('node', collectedNodes[ip]);
                }

            });

            socket.on('refresh-keep-alive', function(data) {
                io.of('/website').emit('broadcast', {'txPool': data.txPool });
            });

            socket.on('update_block', function(data) {
                if (!blockAlreadyExist(data.getBlockHeader.block_header.hash)) {
                    mongoDbConnection(function(databaseConnection) {
                        databaseConnection.collection("block").insert(data.getBlockHeader, null, function (error, results) {
                            if (error) throw error;
                            winston.log('info', 'api -- Block '+data.getBlockHeader.block_header.topoheight+' saved.');
                            var query = { "block_header.topoheight": data.getBlockHeader.block_header.topoheight - 50 };
                            databaseConnection.collection("block").remove(query, function (err, obj) {
                                if (obj.result.n > 0) {
                                    winston.log('info', 'api ---------- Block ' + (data.getBlockHeader.block_header.topoheight-50) + ' deleted.');
                                    blockInProgress.splice(0, 1);
                                }
                            });
                            api.getChart();
                            api.getDeroDag();
                        });
                    });
                }
            });

            function askUpdate(block_header) {

                block_header.tips.forEach(function (hash, index) {
                    if (!blockAlreadyExist(hash) && blockInProgress.indexOf(hash) === -1 && (globalCurrentHeight - block_header.topoheight) < 50) {
                        blockInProgress.push(hash);
                        socket.emit('block_information', hash);
                    }
                });

                /*if (!blockAlreadyExist(block_header.hash)) {
                    socket.emit('block_information', block_header.hash);
                }*/
            }

        });

        function blockAlreadyExist(hash) {
        	mongoDbConnection(function(databaseConnection) {
        		databaseConnection.collection("block").findOne({"block_header.hash" : hash }, function(error, result) {
        			return !result;
        		});
        	});
        }

        function storeblockPropagation(data, ip, newBlock) {
            if (newBlock) {
                baseBlockPropagation = Date.now() - data.latency;
                var myPropagation = 0;
            } else {
                var myPropagation = parseInt((Date.now() - data.latency)) - parseInt(baseBlockPropagation);
                if (myPropagation < 0) myPropagation = 0;
            }
             
            collectedNodes[ip].propagation.lastBlock = myPropagation;
            if (collectedNodes[ip].propagation.historyData.length > 50) {
                collectedNodes[ip].propagation.historyData.splice(0, 1);
                collectedNodes[ip].propagation.historyLabels.splice(0, 1);
                collectedNodes[ip].propagation.historyColors.splice(0, 1);
            }
            collectedNodes[ip].propagation.historyData.push(myPropagation);
            collectedNodes[ip].propagation.historyLabels.push(data.lastBlockHeader.topoheight);
            collectedNodes[ip].propagation.historyColors.push(api.getColorPropagation(myPropagation));
            collectedNodes[ip].propagation.average = Math.round(collectedNodes[ip].propagation.historyData.reduce(reducer) / collectedNodes[ip].propagation.historyData.length);
        }
        
    });
});

server.listen(SERVER_PORT);

