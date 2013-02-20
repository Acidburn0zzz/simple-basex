/* simple-basex - Node.JS client for BaseX
 * http://docs.basex.org/wiki/Server_Protocol
 */

/* The BaseX protocol uses zero terminated strings with escaping for
 * zero bytes in strings.
 *
 * The decoding of incoming messages needs to be deferred until the
 * type of the data is known, which is dependent on the type of
 * exchange being executed.  In order to support this, two buffering
 * levels are used - Incoming data buffers are stored until they are
 * consumed and a second decoding buffer for strings is used so that
 * UTF-8 decoding can be performed on one buffer.  When reading a
 * string, bytes are pulled from the input buffers until a zero byte
 * is read.  When an escape byte (0xff) is seen, the next byte is put
 * into the string buffer verbatim.  As soon as the zero terminator is
 * encountered, the rest of the buffer is kept in the input buffer
 * chain, the string is decoded and the handler is invoked.
 *
 * This convoluted mechanism is used to make sure that UTF-8 multi
 * byte sequences which are split across incoming packet boundaries
 * are correctly decoded.
 */

var net = require('net');
var events = require('events');
var util = require('util');
var crypto = require('crypto');

exports.sessionDefaults = {
    host: 'localhost',
    port: 1984,
    user: 'admin',
    password: 'admin',
    initialStringBufferSize: 0x10000
};

function md5(str) {
    return crypto.createHash('md5').update(str).digest("hex");
}

function Session(options) {
    events.EventEmitter.call(this);

    this.options = options || {};
    this.options.__proto__ = exports.sessionDefaults;

    this.stringBuffer = new Buffer(this.options.initialStringBufferSize);
    this.stringBufferOffset = 0;
    this.inEscape = false;
    this.waiting = []; // [ reader, handler ] currently waiting
    this.buffers = []; // list of buffers with unconsumed data
    this.busy = true;
    this.queue = [];

    this.socket = net.createConnection(this.options.port, this.options.host);
    this.socket.setNoDelay();

    var session = this;
    this.socket.on('connect', function () { session.performHandshake(); });
    this.socket.on('data', function (data) { session.handleData(data); });
    this.socket.on('end', function () { session.busy = true; });
}

util.inherits(Session, events.EventEmitter);

Session.prototype.writeStrings = function() {
    var bufferSize = 0;
    var stringCount = 0;
    for (; stringCount < arguments.length; stringCount++) {
        if (typeof arguments[stringCount] == 'string') {
            bufferSize += Buffer.byteLength(arguments[stringCount]) + 1;
        } else {
            break;
        }
    }
    var handler = arguments[stringCount];
    var buffer = new Buffer(bufferSize);
    var offset = 0;
    for (var i = 0; i < stringCount; i++) {
        offset += buffer.write(arguments[i], offset);
        buffer[offset++] = 0;
    }
    this.socket.write(buffer, handler.bind(this));
}

Session.prototype.pushToStringBuffer = function (byte) {
    if (this.stringBuffer.length == this.stringBufferOffset) {
        var newBuffer = new Buffer(this.stringBufferOffset * 2);
        this.stringBuffer.copy(newBuffer);
        this.stringBuffer = newBuffer;
    }
    this.stringBuffer[this.stringBufferOffset++] = byte;
}

Session.prototype.getStringFromBuffers = function() {
    while (this.buffers.length > 0) {
        var buffer = this.buffers.shift();
        for (var i = 0; i < buffer.length; i++) {
            var byte = buffer[i];
            if (this.inEscape) {
                this.pushToStringBuffer(byte);
                this.inEscape = false;
            } else if (byte == 0xff) {
                this.inEscape = true;
            } else if (byte == 0x00) {
                var retval = this.stringBuffer.toString('utf8', 0, this.stringBufferOffset);
                this.stringBufferOffset = 0;
                i++;                                        // skip over terminating 0
                if (buffer.length > i) {
                    this.buffers.unshift(buffer.slice(i)); // return unconsumed part of buffer to buffer list
                }
                return retval;
            } else {
                this.pushToStringBuffer(byte);
            }
        }
    }
    return null;
}

Session.prototype.popAndInvokeHandler = function (arg) {
    var handler = this.waiting[1];
    this.waiting = [];
    handler.call(this, arg);
}

Session.prototype.handleData = function(data) {
    this.buffers.push(data);

    if (this.waiting[0] === this.readString) {
        var string = this.getStringFromBuffers();
        if (string !== null) {
            this.popAndInvokeHandler(string);
        }
    } else if (this.waiting[0] === this.readByte) {
        this.popAndInvokeHandler(this.getByteFromBuffers());
    }
}

Session.prototype.getByteFromBuffers = function () {
    var byte = this.buffers[0][0];
    if (this.buffers[0].length > 1) {
        this.buffers[0] = this.buffers[0].slice(1);
    } else {
        this.buffers.shift();
    }
    return byte;
}

Session.prototype.readByte = function(handler) {
    if (this.buffers.length) {
        handler.call(this, this.getByteFromBuffers());
    } else {
        this.waiting = [ this.readByte, handler ];
    }
}

Session.prototype.readString = function(handler) {
    var string = this.getStringFromBuffers();
    if (string) {
        handler.call(this, string);
    } else {
        this.waiting = [ this.readString, handler ];
    }
}

Session.prototype.performHandshake = function() {
    this.readString(function(timestamp) {
        this.writeStrings(this.options.user, md5(md5(this.options.password) + timestamp), this.getLoginStatus);
    }.bind(this));
}

Session.prototype.checkQueue = function () {
    this.busy = false;
    if (this.queue.length) {
        (this.queue.pop())();
    }
}

Session.prototype.getLoginStatus = function () {
    this.readByte(function(loginStatus) {
        if (loginStatus == 0) {
            this.checkQueue();
            this.emit('loggedIn');
        } else {
            this.emit('error', new Error('authorization failed'));
        }
    });
}

Session.prototype.chain = function (handler, first) {
    var session = this;
    var args = [];
    var functions = Array.prototype.slice.call(arguments, 2);

    function maybeInvokeNext(arg) {
        args.push(arg);
        if (functions.length) {
            functions.shift().call(session, maybeInvokeNext);
        } else {
            handler.apply(session, args);
        }
    }

    first.call(session, maybeInvokeNext);
}

Session.prototype.defaultHandler = function(result, info, code) {
    this.emit('result', { result: result, info: info, code: code });
}

Session.prototype.execute = function (query, handler) {
    handler = handler || this.defaultHandler;
    if (this.busy) {
        this.queue.unshift(arguments.callee.bind(this, query, handler));
        return;
    }
    this.busy = true;

    function invokeHandler (result, info, code) {
        if (code == 0) {
            handler.call(this, result, info);
            this.checkQueue();
        } else {
            this.emit('error', new Error('BaseX query failed\nquery: ' + query + '\n' + 'message: ' + info));
        }
    }

    this.writeStrings(query, function () {
        this.chain(invokeHandler, this.readString, this.readString, this.readByte);
    }.bind(this));
}

function Query() {
}

Query.prototype.bind = function(name, value, type) {
}

Query.prototype.close = function(handler) {
}

Query.prototype.execute = function(handler) {
}

Query.prototype.info = function(handler) {
}

exports.Session = Session;
