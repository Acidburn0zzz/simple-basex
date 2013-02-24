# simple-basex - Node.JS client interface to the BaseX XML database

simple-basex attempts to implement a simple to use client interface to
the [BaseX](http://basex.org/) XML database.  It deviates from the
client API proposed in the BaseX documentation in particular with
respect to the bound query interface.

## Installation

simple-basex is self contained and uses only core Node.JS
functionality.  It can be installed using [npm](http://npmjs.org/):

`npm install basex`

A simple test script is provided which requires a BaseX server running
on the local machine.  By default, the username "admin" and the
password "admin" are used to access BaseX.  See "Environment
Variables" below if you need to use different credentials.

## Usage

simple-basex implements a client interface that is simple to use in
the asynchronous context of Node.JS.  Commands can be sent to the
database server without waiting for responses.  Responses can either
be collected by callbacks, or by the way of events emitted by the
client session object.

A example might look like this:

```javascript
var basex = require('simple-basex');
var s = new basex.Session();
s.execute('open mydatabase');
s.query('//product', function (err, result) {
    if (err) throw err;
    console.log('product', result);
});
```

All interaction with BaseX is mediated through a Session object which
needs to be allocated using the `new` operator.  Database commands can
be executed through the `execute` function.  Queries are typically
sent using the `query` function, which also supports bound variables.

## Environment variables

The authentication credentials used to log in to the BaseX server can
be supplied to the `Session` constructor.  If no explicit credentials
are provided, the built-in defaults of simple-basex can be overridden
using the following environment variables:

### BASEX_HOST

Sets the host on which the BaseX server runs, defaults to `localhost`.

### BASEX_PORT

Port number of the BaseX server, defaults to 1984.

### BASEX_USERNAME

User name, defaults to `admin`.

### BASEX_PASSWORD

Password, defaults to `admin`.

## API functions

### new Session(options)

Creates a new database client session.  `options` can be passed to
override the default and environment credentials.  It needs to be an
object with any of the `host`, `port`, `username` or `password` keys
set to the desired value.

The returned session object handles the context for all database
interactions.

### session.execute(command, [handler])

Execute the `command` on the database server.  Upon completion, the
handler callback is invoked with two arguments.  The first argument is
either null or an Error object if an error occured executing the
command.  The second argument is an object with `reply` and `info`
keys which contain the data that the command yielded and the
diagnostic information for the command execution, respectively.  If no
handler is provided, an 'error' or 'result' event will be emitted by
the Session object.

### session.query(query, [bindings], [handler])

Execute the `query`, which needs to contain an XQuery string.
`bindings` can contain variable bindings which need to be passed as
object.  The data types of the bound variables will be automatically
determined from the value types in the `bindings` object.

`handler` is an optional handler with the conventional `(err, data)`
signature.  `err` will be an Error object if an error occured during
query execution.  `data` will contain the result string.  Query
diagnostics are not currently returned for bound query execution.
