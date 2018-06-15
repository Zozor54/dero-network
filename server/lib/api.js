var async = require('async');
var mongoDbConnection = require('./mongodb-singleton.js');
var winston = require('winston');

const colorRed = '#f74b4b';
const colorOrange = '#ff8a00';
const colorGreen = '#7bcc3a';
const colorBlue = '#10a0de';
const colorYellow = '#ffd162';

const targetTime = 9;
const targetTimeHigh = 27;

var lastBlock = null;

var nextIteration = [];
var depthMax = 15;

module.exports= {
    getChart: function() {
    	mongoDbConnection(function(databaseConnection) {
        	databaseConnection.collection("block").find().sort({"block_header.topoheight": -1}).limit(50).toArray(function (error, result) {
        		if (result.length < 2) {
        			return;
        		}
        		var difficulty = [];
        		var height = [];
        		var heightBlockTime = [];
        		var blockTime = [];
        		var colorBlockTime = [];
        		var lastBlockTime = '';
        		var transactions = [];
        		var sumTx = 0;
        		var i = 1;
				if (result[0]) {
					// First : la difficulté des 50 derniers blocs
					result.forEach(function(element) {
						// Difficulty Chart
						difficulty.push(element.block_header.difficulty);
						height.push(element.block_header.topoheight);
						// BlockTime chart
						if (lastBlockTime != '') {
							var tmpBlockTime = lastBlockTime - element.block_header.timestamp;
							if (tmpBlockTime < 0) tmpBlockTime = 0;
							var color = '';
							blockTime.push(tmpBlockTime);
							heightBlockTime.push(element.block_header.topoheight+1);
							if (tmpBlockTime > targetTimeHigh) {
								colorBlockTime.push(colorRed);
							} else if (tmpBlockTime > targetTime) {
								colorBlockTime.push(colorOrange);
							} else {
								colorBlockTime.push(colorGreen);
							}
						}
						lastBlockTime = element.block_header.timestamp;
						transactions.push(element.block_header.txcount);
						if (i <= 10) {
							sumTx += element.block_header.txcount;
							i++;
						}
						/*var elementJSON = JSON.parse(element.json);
						// Count transactions
						if (elementJSON.tx_hashes != null) {
							transactions.push(elementJSON.tx_hashes.length);
						} else {
							transactions.push(0);
						}*/
					});
				}
				collectedStats.chart = {
					difficulty: {difficulty: difficulty.reverse(), height: height.reverse()},
					blockTime: { data: blockTime.reverse(), color: colorBlockTime.reverse(), height: heightBlockTime.reverse()},
					avgBlockTime: Math.round(((blockTime.reduce(reducer) / blockTime.length) * 10))  / 10,
					transactions: transactions.reverse(),
					avgTransactions: Math.round(sumTx / i)
				};
				io.of('/website').emit('daemon', collectedStats);
			});
		});
    },
    getDeroDag: function() {
		mongoDbConnection(function(databaseConnection) {
			databaseConnection.collection("block").find().sort({"block_header.topoheight": -1}).limit(1).toArray(function (error, result) {
				nextIteration = [];
				if (result[0] !== undefined) {
					depthMax = 15;
					lastBlock = new node(result[0].block_header.topoheight);
					lastBlock.setDepth(1);
					nextIteration.push({ tips: result[0].block_header.tips, node: lastBlock });
					recursive(nextIteration);
				}

			});
		});
	},
	getColorPropagation: function(blockPropagation) {
		if (blockPropagation === 0) return colorBlue;
		else if (blockPropagation < 500) return colorGreen;
		else if (blockPropagation < 1500) return colorYellow;
		else if (blockPropagation < 2500) return colorOrange;
		else return colorRed;
	}
}

function recursive(arrayObject) {
	nextIteration = [];
	mongoDbConnection(function(databaseConnection) {
		async.eachOfSeries(arrayObject, function(object, index, outerCallback) {

			if (object.node.depth === (depthMax - 1) && object.tips.length > 1) {
				depthMax--;
			}

			async.eachOfSeries(object.tips, function(hashParent, index2, innerCallback) {
				databaseConnection.collection("block").findOne({ "block_header.hash" : hashParent}, function (error, previousBlock) {
					if (!previousBlock) {
						nextIteration = [];
						innerCallback();
					} else {
						var newNode = new node(previousBlock.block_header.topoheight);
						newNode.setDepth(object.node.depth + 1);
						object.node.setParent(newNode);

						if (object.node.depth + 1 <= depthMax) {
							//console.log('DEPTH : '+ (object.node.depth + 1));
							nextIteration.push({ tips: previousBlock.block_header.tips, node: newNode });
						}

						innerCallback();
					}

					if (object.tips[index2 + 1]  === undefined) {
						outerCallback();
					}
				});
			});

		}, function(err) {
		    if (err) console.error(err.message);
		    if (nextIteration.length !== 0) {
				recursive(nextIteration);
			} else {
			   // console.log('done');
			    global.deroDag = lastBlock;
	    		io.of('/website').emit('derodag', lastBlock);
    		}
		});
	});
}

var node = class {
  constructor(value) {
    this.value = value;
    this.parents = [];
  }
  setParent(parent) {
  	this.parents.push(parent);
  }
  setDepth(depth) {
  	this.depth = depth;
  }
}
