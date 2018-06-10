var async = require('async');
var mongoDbConnection = require('./mongodb-singleton.js');
var winston = require('winston');

const reducer = (accumulator, currentValue) => accumulator + currentValue;

const colorRed = '#f74b4b';
const colorOrange = '#ff8a00';
const colorGreen = '#7bcc3a';
const targetTime = 9;
const targetTimeHigh = 27;

var lastBlock = null;
var counterDepth = null;

module.exports= {
    getChart: function() {
    	mongoDbConnection(function(databaseConnection) {
        	databaseConnection.collection("block").find().sort({_id: -1}).limit(50).toArray(function (error, result) {
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
						var elementJSON = JSON.parse(element.json);
						// Count transactions
						if (elementJSON.tx_hashes != null) {
							transactions.push(elementJSON.tx_hashes.length);
						} else {
							transactions.push(0);
						}
					});
				}
				collectedStats.chart = {
					difficulty: {difficulty: difficulty.reverse(), height: height.reverse()},
					blockTime: { data: blockTime.reverse(), color: colorBlockTime.reverse(), height: heightBlockTime.reverse()},
					avgBlockTime: Math.round(((blockTime.reduce(reducer) / blockTime.length) * 10))  / 10,
					transactions: transactions.reverse()
				};
				io.of('/website').emit('daemon', collectedStats);
			});
		});
    },
    getDeroDag: function() {
		mongoDbConnection(function(databaseConnection) {
			databaseConnection.collection("block").find().sort({_id: -1}).limit(1).toArray(function (error, result) {
				//if (!result[0] || result[0] === undefined) callback('error');
				//result.forEach(function(element) {
					counterDepth = 0;
					if (result[0] !== undefined) {
					lastBlock = new node(result[0].block_header.topoheight);
					lastBlock.setDepth(0);
					getParentsFromNode(lastBlock, result[0]);
				}
					
				//});
			});
		});
	}
}

function getParentsFromNode(currentNode, block) {
	mongoDbConnection(function(databaseConnection) {
		block.block_header.tips.forEach(function(hashParent, index) {
		// Chargement du node
			databaseConnection.collection("block").findOne({ "block_header.hash": hashParent }, function (error, result) {
				if(!result) return;
				// Creation d'un nouveau node
				var newNode = new node(result.block_header.topoheight);
				newNode.setDepth(currentNode.depth + 1);
				// Le lien parent
				currentNode.setParent(newNode);

				if (newNode.depth < 15) {
					getParentsFromNode(newNode, result);
				} /* else {
					/*global.deroDag = lastBlock;
					io.of('/website').emit('derodag', lastBlock);
					return;
				} */
			});
		
			if (block.block_header.tips[index + 1] === undefined) {
	            counterDepth++;
	            if (counterDepth == 15) {
	            	global.deroDag = lastBlock;
	                io.of('/website').emit('derodag', lastBlock);
	            }
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
