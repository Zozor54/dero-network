var nUserConnected = 0;

io.of('/website').on('connection', function (socket) { 
	nUserConnected++;

	socket.on('disconnect', function (socket) {
		nUserConnected--;
	});

    if (collectedStats.hasOwnProperty('get_info')) {
        socket.emit('daemon', collectedStats);
    }

    if(deroDag != null) {
        socket.emit('derodag', deroDag);
    }

    for (var node in collectedNodes) {
    	if (collectedNodes[node].hasOwnProperty('geo')) {
            socket.emit('node', collectedNodes[node]);
        }
    }

    socket.on('latency', function (startTime, cb) {
        cb({ startTime: startTime, userConnected: nUserConnected });
    });
    
});