
io.of('/website').on('connection', function (socket) { 

    if (collectedStats.hasOwnProperty('get_info')) {
        socket.emit('daemon', collectedStats);
    }

    if(deroDag != null) {
        socket.emit('derodag', deroDag);
    }

    for (var node in collectedNodes) {
    	if (collectedNodes[node].hasOwnProperty('geo')) {
            io.of('/website').emit('node', collectedNodes[node]);
        }
    }

    socket.on('latency', function (startTime, cb) {
        cb(startTime);
    });
    
});