var async = require('async');
var request = require('request-json');
var socketIo = require('socket.io-client');
//var config = require('./config.json');
var fs = require('fs');
var readlineSync = require('readline-sync');

// Don't modify this URL
const serverURL = 'http://54.37.72.72:8080/nodes';
const VERSION = '0.3';

var config = null;
var socket = null;
var refreshTime = 0;
var timeout = null;
var currentBlockHeight = 0;
var intervalRefresh = null;

if (!fs.existsSync('config.json')) {
	var configFile = {};

	configFile.myDaemon = "http://127.0.0.1:30306";
	var name = readlineSync.question('What is the public name of your node?');
	while (name.length < 3 || name.length > 24) {
		name = readlineSync.question('What is the public name of your node? (3 charac min - 24 max)');
	}
	configFile.myName = name;
	var description = readlineSync.question('What is your public node description? ');
	while (description.length > 512) {
		description = readlineSync.question('What is your public node description? (512 charac max)');
	}
	configFile.myDescription = description;
	fs.writeFile("config.json", JSON.stringify(configFile), 'utf8', function(err) {
	    if(err) {
	        return console.log(err);
	    }

	    console.log("Config.json created.");
	    config = JSON.parse(fs.readFileSync('config.json'));
		init();
	});

} else {
	config = JSON.parse(fs.readFileSync('config.json'));
	init();
}

function init() {
	socket = socketIo.connect(serverURL);

	socket.on('connect', function () {
        socket.emit('version', VERSION);
    });

	socket.on('refreshTime', function(interval) {
		console.log('--- New refresh time '+interval);
		if (timeout) clearTimeout(timeout);
		if (intervalRefresh) clearInterval(intervalRefresh);
		refreshTime = interval;
		timeout = setTimeout(broadcastDaemon, refreshTime);
	});

	socket.on('block_information', function(hash) {
		async.parallel({ 
			getBlockHeader: function(callback) {
				var paramsRequest = {
				  "jsonrpc": '2.0',
				  "id": 0,
				  "method": "getblockheaderbyhash",
				  "params": { "hash": hash }
				};
				var client = request.createClient(config.myDaemon);
			    client.headers['Content-Type'] = 'application/json';
			    client.post('json_rpc', paramsRequest, function(err, res, body) {
			        var info = body.result;
			        callback(null, info);
			    });
			}
		}, function (error, result) {
	       socket.emit('update_block', result);
		});
	});

	socket.on('refresh-keep-alive', function() {
		getInfoFromDaemon();
		intervalRefresh = setInterval(function() {
			getInfoFromDaemon();
		}, 4000);
	});

	socket.on('stop-your-refresh', function() {
		clearInterval(intervalRefresh);
	});

	socket.on('banned', function (reason) {
		console.error('BANNED -- '+reason);
		return process.exit(22);
	});

	socket.on('security-check', function (hash) {
		console.log('Security check asked');
		var paramsRequest = {
		  "jsonrpc": '2.0',
		  "id": 0,
		  "method": "getblockheaderbyhash",
		  "params": { "hash": hash }
		};
		var client = request.createClient(config.myDaemon);
	    client.headers['Content-Type'] = 'application/json';
	    client.post('json_rpc', paramsRequest, function(err, res, body) {
	    	if (body === undefined) {
	    		console.error('Error : The daemon did not respond or the data verification failed');
	    		process.exit(22);
	    	}

	        var info = (body.result !== undefined ? body.result : body);
	        socket.emit('security-check', info);
	    });
	});

	socket.on('security-result', function(state) {
		switch (state) {
			case "SUCCESS": {
				console.log('Security checks completed. Welcome.');
				break;
			}
			case "WAITING": {
				console.log('You seem to be in sync. The security check is currently in progress. A new control will soon be realized');
				break;
			}
		}
	});

}

function broadcastDaemon() {
	if (config.myName == "") {
		console.error('you must fill out all required fields. NAME, DAEMON NODE');
		return process.exit(22);
	}
	async.parallel({
		latency: function(callback) {
			socket.emit('latency', Date.now(), function(startTime) {
			    var latency = Date.now() - startTime;
			    callback(null, latency);
			});
		}, 
		get_info: function(callback) {
			var paramsRequest = {
			  "jsonrpc": '2.0',
			  "id": 0,
			  "method": "get_info"
			};
			var client = request.createClient(config.myDaemon);
		    client.headers['Content-Type'] = 'application/json';
		    client.post('json_rpc', paramsRequest, function(err, res, body) {
		    	if (body === undefined) {
		    		callback('Error Daemon', null);
		    		return;
		    	}

		        var info = body.result;
		        callback(null, {
                    target: info.target,
                    total_supply: info.total_supply,
                    incoming_connections: info.incoming_connections_count,
                    outgoing_connections: info.outgoing_connections_count,
                    txPool: info.tx_pool_size,
                    version: info.version
                });
		    });
		},
		lastBlockHeader: function (callback) {
            var paramsRequest = {
			  "jsonrpc": '2.0',
			  "id": 0,
			  "method": "getlastblockheader"
			};
			var client = request.createClient(config.myDaemon);
		    client.headers['Content-Type'] = 'application/json';
            client.post('json_rpc', paramsRequest, function(err, res, body) {
            	if (body === undefined) {
		    		callback('Error Daemon', null);
		    		return;
		    	}
                var blockHeader = body.result.block_header;
                callback(null, {
                    difficulty: blockHeader.difficulty,
                    hash: blockHeader.hash,
                    height: blockHeader.height,
                    topoheight: blockHeader.topoheight,
                    timestamp: blockHeader.timestamp,
                    tips: blockHeader.tips,
                    reward: blockHeader.reward
                });
            });
        },
		informations: function(callback) {
			callback(null, {
				'updated': Date.now(),
				'name': config.myName,
				'description': config.myDescription
			 });
		}
	}, function (error, result) {
			if (error) {
				console.error('Error - Probably daemon');
				timeout = setTimeout(broadcastDaemon, refreshTime);
				return;
			}
			if (currentBlockHeight < result.lastBlockHeader.topoheight) {
				currentBlockHeight = result.lastBlockHeader.topoheight;
	       		socket.emit('nodes', result);
       		}
	       timeout = setTimeout(broadcastDaemon, refreshTime);
	});
}

function getInfoFromDaemon() {
	var paramsRequest = {
	  "jsonrpc": '2.0',
	  "id": 0,
	  "method": "get_info"
	};
	var client = request.createClient(config.myDaemon);
    client.headers['Content-Type'] = 'application/json';
    client.post('json_rpc', paramsRequest, function(err, res, body) {
    	if (body === undefined) {
    		console.error('Error with daemon');
    		return;
    	}

        var info = body.result;
        socket.emit('refresh-keep-alive', { txPool: info.tx_pool_size });
    });
}

