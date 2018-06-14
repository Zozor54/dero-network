$(function() {
    var allChart = {};
    var nodes = {};
    var map = null;
    var mapNode = [];
    var coinUnits = 1000000000000;
    var mapInit = false;
    var currentHeight = 0;
    var network = null;

    var $mLastBlock = $('#networkLastBlock > span.minutes'),
        $sLastBlock = $('#networkLastBlock > span.seconds');
    var intervalLastBlock = null;
    // Connexion à socket.io
    var socket = io.connect('/website');

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
            if (socket.connected) {
                clearInterval(intervalLastBlock);
                for (var node in nodes) {
                    clearInterval(nodes[node].interval);
                } 
                socket.close();
            }      
        } else {
            if (!socket.connected) {
                socket.open();
            }
        }
    }, false);

    socket.on('daemon', function(data) {
        $('#networkBlockHeight').html(data.lastBlockHeader.height + ' / ' + data.lastBlockHeader.topoheight);
        $('#networkDifficulty').html(getReadableHashRateString(data.lastBlockHeader.difficulty));
        //$('#networkLastBlock').timeago('update', new Date(data.lastBlockHeader.timestamp * 1000).toISOString());
        $('#networkHashrate').html(getReadableHashRateString(data.lastBlockHeader.difficulty / data.get_info.target));
        $('#networkTotalSupply').html(data.get_info.total_supply.toLocaleString());
        $('#networkLastReward').html(Math.round(data.lastBlockHeader.reward / coinUnits * 100) / 100);
        $('#networkAVGBlockTime').html(data.chart.avgBlockTime + 's');
        $('#networkCurrentTx').html(data.get_info.txPool);
        $('#networkAvgTx').html(data.chart.avgTransactions);
        
        drawChartBar('chartDifficulty', 'Difficulty', data.chart.difficulty.height, data.chart.difficulty.difficulty, null);
        drawChartBar('chartBlockTime', 'BlockTime', data.chart.blockTime.height, data.chart.blockTime.data, data.chart.blockTime.color);
        drawChartBar('chartTransactions', 'Transactions', data.chart.difficulty.height, data.chart.transactions, null);
        drawChartBar('chartBlockPropagation', 'Block', data.chart.difficulty.height, data.chart.transactions, null);
        lastBlockMoment(data.block_timestamp);

        currentHeight = data.lastBlockHeader.topoheight;
        for (var node in nodes) {
		  if (nodes[node].data.data.informations.name != data.informations.name) {
        		updateNode(nodes[node].data);
        	}
		} 
        //chartDifficulty(data.chart.difficulty);    
    });

    socket.on('broadcast', function(data) {
        $('#networkCurrentTx').stop(true, true).html(data.txPool);
    });

    socket.on('derodag', function(data) {
        createDeroDag(data);
    });

    socket.on('node', function (data) {
        updateNode(data);
    });

    socket.on('node-disconnect', function(node) {
        // Remove node
        $('tr[nodeName="'+node.data.informations.name+'"]').remove();
        // Clear interval
        clearInterval(nodes[node.data.informations.name].interval);
        // Remove from map
        mapNode = mapNode.filter(nodeBubble => nodeBubble.name != node.data.informations.name);
        updateBubbles();
        delete nodes[node.data.informations.name];
    });

    setInterval(function() {
        if (socket.connected) {
            socket.emit('latency', Date.now(), function(object) {
                var latency = Date.now() - object.startTime;
                $('span#myLatency').html(latency+' ms').attr('class', getColorLatency(latency));
                $('span#userConnected').html(object.userConnected);
            });
        }
    }, 5000);

    function createMap() {
        var width = $('#container').parent().width(),
        height = $('#container').parent().height();
        $('#container').css('height', height+'px');
        map = new Datamap({
            element: document.getElementById('container'),
            scope: 'world',
            fills: {
                'bg-green': '#7BCC3A',
                'bg-yellow': '#ffd162',
                'bg-orange': '#FF8A00',
                'bg-red': '#f74b4b',
                defaultFill: '#aaa'
            },
            geographyConfig: {
                borderWidth: 0,
                borderColor: '#000',
                popupOnHover: false,
                hideAntarctica: true,
                highlightOnHover: false
            },
            bubblesConfig: {
                borderWidth: 1,
                borderColor: '#000',
                animate: true,
                highlightOnHover: false,
                popupOnHover: true
            },
            done: function(datamap) {
                var ev;

                var zoomListener = d3.behavior.zoom()
                    .size([width, height])
                    .scaleExtent([1, 4])
                    .on("zoom", redraw)
                    .on("zoomend", animadraw);

                function redraw() {
                    datamap.svg.select(".datamaps-subunits").attr("transform", "translate(" + d3.event.translate + ")scale(" + d3.event.scale + ")");
                    /*datamap.svg.select(".bubbles").selectAll("circle")
                        .attr("transform", "translate(" + d3.event.translate + ")scale(" + d3.event.scale + ")")
                        .attr("r", 3/d3.event.scale);*/

                    ev = d3.event;
                }

                zoomListener(datamap.svg);

                function animadraw() {
                    var x = Math.min(0, Math.max(ev.translate[0], (-1) * width * (ev.scale-1)));
                    var y = Math.min(0, Math.max(ev.translate[1], (-1) * height * (ev.scale-1)));

                    /*datamap.svg.select(".datamaps-subunits")
                        .transition()
                        .delay(150)
                        .duration(450)
                        .attr("transform", "translate(" + x  + "," + y + ")scale(" + ev.scale + ")");*/

                    datamap.svg.select(".bubbles").selectAll("circle")
                        .transition()
                        .delay(150)
                        .duration(450)
                        .attr("transform", "translate(" + ev.translate + ")scale(" + ev.scale + ")")
                        .attr("r", 3/ev.scale);

                    zoomListener.translate([x,y]);
                }
            }
        });
    }

    function updateBubbles() {
        // 
        map.bubbles(mapNode, {
            popupTemplate: function (geo, data) {
                    return ['<div class="hoverinfo '+data.fillKey+'"><div class="propagationBox"></div> <strong>' +  data.name +'</strong></div>'].join('');
            }
        });
    }

    function updateNode(node) {
        if (!nodes.hasOwnProperty(node.data.informations.name)) {
            // Create new node
            var sNewNode = '<tr nodeName="'+node.data.informations.name+'" class="text-center"><td scope="row" name="node"></td><td name="latency"></td><td name="height"></td><td name="propagation"></td><td name="peers_inc"></td><td name="peers_out"></td><td name="version"></td><td name="updated"><span class="seconds" ></span><span class="milliseconds" ></span></td></tr>';
            $('#rowNodes').append(sNewNode);
            nodes[node.data.informations.name] = {};
        }
        var oColor = getBlockColor(node.data.lastBlockHeader.topoheight, currentHeight);
        // Update
       // $('#rowNodes > tr[nodeName="' + node.name + '"]').css('color', (node.isOnline ? '#7bcc3a' : 'red'));
        $('#rowNodes > tr[nodeName="' + node.data.informations.name + '"]').attr('class', 'text-center '+oColor.text);
        $('#rowNodes > tr[nodeName="' + node.data.informations.name + '"] > td[name="node"]').html(node.data.informations.name);
        $('#rowNodes > tr[nodeName="' + node.data.informations.name + '"] > td[name="latency"]').html(node.data.latency+' ms').attr('class', getColorLatency(node.data.latency));
        $('#rowNodes > tr[nodeName="' + node.data.informations.name + '"] > td[name="height"]').html(node.data.lastBlockHeader.height + ' / ' + node.data.lastBlockHeader.topoheight);
        if (!isNaN(node.propagation)) {
        	$('#rowNodes > tr[nodeName="' + node.data.informations.name + '"] > td[name="propagation"]').html(node.propagation+ ' ms');
    	} else {
    		$('#rowNodes > tr[nodeName="' + node.data.informations.name + '"] > td[name="propagation"]').html('-');
    	}
        $('#rowNodes > tr[nodeName="' + node.data.informations.name + '"] > td[name="peers_inc"]').html(node.data.get_info.incoming_connections);
        $('#rowNodes > tr[nodeName="' + node.data.informations.name + '"] > td[name="peers_out"]').html(node.data.get_info.outgoing_connections);
        $('#rowNodes > tr[nodeName="' + node.data.informations.name + '"] > td[name="version"]').html(node.data.get_info.version);
        /*if (node.isOnline || $('#rowNodes > tr[nodeName="' + node.name + '"] > td[name="updated"] > span.seconds').html() == '') {
            createMoment(node);
        } */
        createMoment(node);

        if (map !== null) {
            var bubble = {};
            bubble.name = node.data.informations.name;
            bubble.radius = 4;
            bubble.fillKey = oColor.bgColor;
            bubble.latitude = node.geo.latitude;
            bubble.longitude = node.geo.longitude;
            mapNode = mapNode.filter(nodeBubble => nodeBubble.name != bubble.name);
            mapNode.push(bubble);
            updateBubbles();
        }
        nodes[node.data.informations.name].data = node;
    }

    function createMoment(node) {
        var $clock = $('#rowNodes > tr[nodeName="' + node.data.informations.name + '"] > td[name="updated"]'),
        updateTime = node.data.informations.updated,
        currentTime = moment().unix() * 1000,
        duration = moment.duration(0, 'milliseconds'),
        interval = 1000;

        if(nodes.hasOwnProperty(node.data.informations.name)) {
            // Clear Interval
            clearInterval(nodes[node.data.informations.name].interval);
        } else {
            nodes[node.data.informations.name] = {};
        }

        var $s = $('#rowNodes > tr[nodeName="' + node.data.informations.name + '"] > td[name="updated"] > span.seconds'),
            $ms = $('#rowNodes > tr[nodeName="' + node.data.informations.name + '"] > td[name="updated"] > span.milliseconds');

        $s.text('');
        $ms.text('');

        function momentNode(lastDuration) {
            var duration = moment.duration(lastDuration.asMilliseconds() + interval, 'milliseconds');
            var s = moment.duration(duration).seconds(),
                ms = moment.duration(duration).asMilliseconds();

           /* if (d != '0') $d.text(d+'d');
            if (h != '0') $d.text(h+ 'h');
            if (m != '0') $d.text(m+ 'm'); */
            $s.stop(true, true).text(s + 's ago');
            return duration;
        }
        duration = momentNode(duration);
        
        nodes[node.data.informations.name].interval = setInterval(function() {
            duration = momentNode(duration);
        }, interval);
    }

    function lastBlockMoment(timestamp) {
       /* var secondSinceLastBlock = moment().unix() - timestamp;
        if (secondSinceLastBlock < 0) secondSinceLastBlock = 0; */
        var duration = moment.duration(timestamp, 'seconds');
        var interval = 1;

        if(intervalLastBlock) {
            clearInterval(intervalLastBlock);
        }

        $mLastBlock.text('');
        $sLastBlock.text('');

        function incrementMoment(lastDuration) {
            var duration = moment.duration(lastDuration.asSeconds() + interval, 'seconds');
            var m = moment.duration(duration).minutes(),
                s = moment.duration(duration).seconds();
            var color;
            var seconds = duration.asSeconds();

            if (seconds > 27) {
                color = 'text-red';
            } else if (seconds >= 18) {
                color = 'text-orange';
            } else if (seconds > 9) {
                color = 'text-yellow';
            } else {
                color = 'text-green';
            }

            $('#networkLastBlock').attr('class', 'value-stats '+color);

            if (m != '0') $mLastBlock.stop(true, true).text(m+ 'm');
            $sLastBlock.stop(true, true).text(s + 's');
            return duration;
        }

        duration = incrementMoment(duration);
        intervalLastBlock = setInterval(function() {
            duration = incrementMoment(duration);
        }, 1000);

    }

    function drawChartBar(idChart, label, arrayLabels, arrayData, color) {
        var ctx = document.getElementById(idChart).getContext('2d');
        var baseColor = '#f74b4b';
        if (color) {
            baseColor = color;
        }

        if (allChart.hasOwnProperty(idChart)) {
            allChart[idChart].data.labels = arrayLabels;
            allChart[idChart].data.datasets[0].data = arrayData;
            allChart[idChart].data.datasets[0].backgroundColor = baseColor;
            allChart[idChart].update();
            return;
            /*allChart[idChart].destroy();
            delete allChart[idChart];*/
        }

        var myChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: arrayLabels,
                datasets: [{
                    label: label,
                    data: arrayData,
                    borderWidth: 1,
                    backgroundColor: baseColor
                }]
            },
            options: {
               maintainAspectRatio: false,
                legend: {
                    display: false
                },
                tooltips: {
                    titleFontColor: '#000',
                    backgroundColor: '#fff',
                    bodyFontColor: '#000',
                    displayColors: false
                },
                scales: {
                    xAxes: [{
                        categoryPercentage: 1.0,
                        barPercentage: 1.0,
                        ticks: {
                            display: false,
                            padding: 0
                        }
                        /*gridLines: {
                            tickMarkLength: 0
                        } */
                    }],
                    yAxes: [{
                        ticks: {
                            display: false,
                            padding: 0
                        },
                        gridLines: {
                            tickMarkLength: 0
                        }
                    }]
                }
            }
        });
        allChart[idChart] = myChart;
        if (!mapInit) {
            mapInit = true;
            createMap();
        }
    }

    function getReadableHashRateString(hashrate){
        var i = 0;
        var byteUnits = [' H', ' KH', ' MH', ' GH', ' TH', ' PH' ];
        while (hashrate > 1000){
            hashrate = hashrate / 1000;
            i++;
        }
        return hashrate.toFixed(2) + byteUnits[i];
    }

    function getBlockColor(height, maxHeight) {
        // isForMap need background color
        var textColor;
        var bgColor;

        if (height === maxHeight || height > maxHeight) textColor = 'text-green';
        else if (maxHeight - height === 1) textColor = 'text-yellow';
        else if (maxHeight - height === 2) textColor = 'text-orange';
        else textColor = 'text-red';

        if (height === maxHeight || height > maxHeight) bgColor = 'bg-green';
        else if (maxHeight - height === 1) bgColor = 'bg-yellow';
        else if (maxHeight - height === 2) bgColor = 'bg-orange';
        else bgColor = 'bg-red';

        return { text: textColor, bgColor: bgColor };
    }

    function getColorLatency(latency) {
        if (latency < 100) return 'text-green';
        if (latency < 200) return 'text-yellow';
        if (latency < 400) return 'text-orange';
        return 'text-red';
    }

    $('table#nodesTable > thead > tr > th').on('click', function() {
        n = $(this)[0].cellIndex;
        var table, rows, switching, i, x, y, shouldSwitch, dir, switchcount = 0;
        var regex2 = new RegExp('/[A-Z]*[a-z]* */gi');
        switching = true;
        dir = "asc"; 
        while (switching) {
            switching = false;
            rows = $('table#nodesTable > tbody > tr');
            for (i = 0; i < (rows.length - 1); i++) {
              shouldSwitch = false;
              x = rows[i].getElementsByTagName("TD")[n].innerHTML.toLowerCase();
              y = rows[i + 1].getElementsByTagName("TD")[n].innerHTML.toLowerCase();

              if (n == 1 || n == 3 || n == 8) {
                ///[A-Z]*[a-z]* * [<->\"]*/gi
                // number comparaison - ms column
                var x = parseInt(x.replace(/[A-Za-z]*[<>\"=/ -]*/gi,''));
                var y = parseInt(y.replace(/[A-Za-z]*[<>\"=/ -]*/gi, ''));
              }
              if (dir == "asc") {
                if (x > y) {
                  shouldSwitch = true;
                  break;
                }
              } else if (dir == "desc") {
                if (x < y) {
                  shouldSwitch = true;
                  break;
                }
              }
            }
            if (shouldSwitch) {
              rows[i].parentNode.insertBefore(rows[i + 1], rows[i]);
              switching = true;
              switchcount ++; 
            } else {
              if (switchcount == 0 && dir == "asc") {
                dir = "desc";
                switching = true;
              }
            }
        }  
    });

    function createDeroDag(deroDag) {
        var data = [];
        var blockLink = [];
        var tmp = [];

        tmp.push(deroDag.value);
        data.push({ id: deroDag.value, font: { multi: 'html' }, label: '<b>'+deroDag.value.toString()+'</b>', color: "#7bcc3a", level: deroDag.depth, shapeProperties:{borderDashes:[5,0]} });
        recursiveDeroDag(deroDag);

        var container = document.getElementById('derodag');
 
        var data = {
            nodes: data,
            edges: blockLink
        };
        var options = {
            nodes: {
                borderWidth:2
            },
            edges: {
                smooth: {
                    type: 'cubicBezier',
                    forceDirection: 'horizontal',
                    roundness: 0.4
                }
            },
            layout: {
                hierarchical: {
                    direction: "RL",
                    levelSeparation: 100,
                    edgeMinimization: false
                }
            },
            physics:false,
            interaction:{
                dragNodes:false,
                dragView: false
            }
        };

        if (network !== null) {
            network.destroy();
            network = null;
        }
  
        network = new vis.Network(container, data, options);

        network.on("doubleClick", function (params) {
            window.open('http://212.8.242.60:8081/block/'+params.nodes[0]);
        });

        function recursiveDeroDag(parents) {
            var color = "#97c2fc";
            parents.parents.forEach(function(enfant) {
                if (parents.parents.length > 1) {
                    // Yellow for DAG
                    color = "#ffd162";
                }

                if (tmp.indexOf(parents.value+'-'+enfant.value) == -1) {
                    blockLink.push({from: parents.value, to: enfant.value});
                    tmp.push(parents.value+'-'+enfant.value);
                }

                if (tmp.indexOf(enfant.value) == -1) {
                    data.push({ id: enfant.value, font: { multi: 'html' }, label: '<b>'+enfant.value.toString()+'</b>', color: color, level: enfant.depth });
                    tmp.push(enfant.value);
                }
                recursiveDeroDag(enfant);
            });
        }
    }


});