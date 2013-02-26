var basex = require('./index.js');
var s = new basex.Session();
s.execute('xquery <foo/>');
s.query('<bar foo="{$foo}" bar="{$bar}"/>',
        { foo: 123, bar: '456' },
        function (err, result) {
            if (err) {
                s.emit('error', new Error(err));
            } else {
                console.log('got query2 result:', result);
            }
        });

s.on('result', function (result) {
    console.log('result event', result);
});

var query = s.query('<bar-prepared foo="{$foo}" bar="{$bar}"/>');
query.execute({ foo: 1, bar: 2 });
query.execute({ foo: 3, bar: 4 }, function (err, data) {
    console.log('prepared query specific handler', err, data);
    s.execute('exit', function () {
        console.log('session exited');
    });
});

query.on('result', function (result) {
    console.log('prepared query result event', result);
});
