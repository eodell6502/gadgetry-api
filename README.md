# gadgetry-api v1.0.5

![Gadgetry title](img/gadgetry.jpg)

**New in v1.0.5: Graceful error handling for bad API response.**

Gadgetry is a minimalist web API framework that follows the Unix philosophy of
doing one thing and doing it well. Gadgetry ignores all of the non-essential
details of HTTP and just uses POST to receive JSON requests and send JSON
responses. It doesn't pay attention to URLs or play games with the semantics of
HTTP verbs. The client just fires off requests to named server-side functions,
and those functions return their results. It can run standalone or (preferably)
under PM2 with an Nginx proxy. It even comes with a small client-side wrapper to
hide the few details involved in making a request.

* [Installation](#installation)
* [Quick Start](#quickstart)
* [Features](#features)
* [Server-Side](#serverside)
    * [Initializing the `Gadgetry` Object](#gadgetinit)
    * [API Functions](#apifuncs)
    * [Logging](#logging)
    * [Interceptors](#interceptors)
* [Client-Side](#clientside)
    * [Single Requests](#singlereqs)
    * [Batched Requests](#batchreqs)
    * [Uploading Files](#uploads)
* [GET Requests](#getrequests)
* [File Downloads](#filedownloads)
* [Class Reference](#classreference)
    * [Gadgetry (server side)](#gadgetryclass)
        * [`constructor`](#gadgetryconstructor)
        * [`guid`](#gadgetryguid)
        * [`sendFile`](#gadgetrysendfile)
        * [`sendStream`](#gadgetrysendstream)
    * [GQuery (client side)](#gqueryclass)
        * [`constructor`](#gqueryconstructor)
        * [`addCommand`](#gqueryaddcommand)
        * [`addFile`](#gqueryaddfile)
        * [`benchmark`](#gquerybenchmark)
        * [`exec`](#gqueryexec)
        * [`getFilesFromForm`](#gquerygetfilesfromform)
        * [`ignoreErrors`](#gqueryignoreerrors)
        * [`req`](#gqueryreq)
        * [`reset`](#gqueryreset)
* [Low-Level Request/Response Details](#lowlevel)

## Installation <a name="installation"></a>

Installation of Gadgetry is, of course, as simple as:

```bash
npm install gadgetry-api
```

This is often good enough for testing, but for real world deployment, you
probably want to use a process manager like [PM2](https://pm2.io) to run it, and
use a webserver like [Nginx](https://nginx.org) or [Apache](https://apache.org)
as a reverse proxy.


## Quick Start <a name="quickstart"></a>

Writing a Gadgetry API is _very_ simple. Let's look at a Hello World
implementation:

```javascript
#!/usr/bin/env node

import Gadgetry from "gadgetry-api";

var api = {
    helloWorld: async function(args) {
        return { message: "Hello, " + (args.to ? args.to : "world") + "!" };
    },
}

var g = new Gadgetry(api);

```

And that's it. You now have a Gadgetry server running at the default port, 8080,
ready to receive requests. On the client side, a request can be as simple as
this:

```javascript
<script src="GQuery.js"></script)
<script>
    gq = new GQuery("http://localhost:8080");
    gq.req("helloWorld", { to: "Gadgetry" })
        .then((res) => console.log(res));
</script>

// which sends the following to the console:

{message: 'Hello, Gadgetry!'}

```

It's that simple. You send an arbitrary object to a named function on the server
side, and you get its response back as another object. There are a few extra
details and conventions you'll need to know to write real world APIs with
Gadgetry, but you could fit them all on an index card.


## Features <a name="features"></a>

* Gadgetry lets you ignore nearly all the details of HTTP. As far as your code is concerned, you're just making asynchronous function calls.
* Send individual requests or batch several requests together.
* Extensive, unopinionated logging that you can plug into your preferred logging mechanism.
* Interceptor hooks let you execute custom code before and after HTTP requests and responses, as well as individual API functions.
* Painless handling of file uploads and downloads.
* Optional benchmarking of API function performance.
* Only a few dependencies: `busboy`, `dyna-guid`, and `tmp`.


## Server-Side <a name="serverside"></a>

### Initializing the `Gadgetry` Object <a name="gadgetinit"></a>

```javascript
var g = new Gadgetry(api, config);
```

To spin up a Gadgetry server, all you absolutely have to pass to the constructor
is an API object whose keys are the names of the functions as they will be called
by the client, and whose values are the functions themselves. How you organize your
code to get to this point is your business. After the `api` argument is an optional
`config` object that you will almost certainly want to supply in real world
applications. Its members are:

| Name            | Default       | Description |
|-----------------|---------------|-------------|
| `port`          | `8080`        | Specifies the port that Gadgetry will listen on. |
| `debug`         | `false`       | If `true`, full error information will be returned to the client when an API function throws an exception. |
| `logger`        | `this.logger` | If you'd like to collect Gadgetry's log messages, supply your function here. It should take two arguments, `messageType` and `message`. The default logger just writes to `console.log` |
| `maxFieldCount` | `Infinity`    | Maximum number of form fields in a request. This should always be at least `1` to accommodate the request `payload` field. |
| `maxFieldSize`  | `Infinity`    | Maximum form field size. Since the client submits requests as a form with the request JSON stuffed into a field named `payload`, this should be at least as large as the largest request. |
| `maxFileCount`  | `Infinity`    | Maximum number of uploaded files per request. |
| `maxFileSize`   | `Infinity`    | Maximum uploaded file size. |
| `intPostCmd`    | `false`       | Intercept post-command. See [Interceptors](#interceptors). |
| `intPreCmd`     | `false`       | Intercept pre-command. See [Interceptors](#interceptors). |
| `intPreReq`     | `false`       | Intercept incoming request. See [Interceptors](#interceptors). |
| `intPreRes`     | `false`       | Intercept outgoing response. See [Interceptors](#interceptors). |
| `useGet`        | `false`       | If `true`, GET requests will be accepted. |
| `getTrim`       | `false`       | A leading string to remove from the URL when processing GET requests. |
| `errcodeLabel`  | `"_errcode"`  | The name of the response field which tells Gadgetry that an API error has occurred. Also used for system errors. |
| `idLabel`       | `"_id"`       | The name of the response field containing the API call ID. |
| `errmsgLabel`   | `"_errmsg"`   | The name of the response field containing system error messages. |
| `errlocLabel`   | `"_errloc"`   | The name of the response field containing error locations. |
| `argsLabel`     | `"_args"`     | The name of the response field containing API call arguments when an exception occurs. |
| `eLabel`        | `"_e"`        | If `debug` is true, the name of the response field containing the exception produced by an API call. |

### API Functions <a name="apifuncs"></a>

The basic API function looks like this:

```javascript
async function basicSample(args) {
    // Do something with the args object
    // Return a results object
}
```

Both the `args` object and the result object can contain anything that can be
serialized into JSON. Gadgetry takes care of the serialization and
unserialization behind the scenes.

To tell Gadgetry and the client that an error has occurred, the result object
should contain a `_errcode` element. It doesn't matter what its value is, but
its presence will tell Gadgetry to abort an ongoing batch of requests if it
has been so configured. (This is the default behavior. You can change the name
of this element by setting the `errcodeLabel` config value.)

The full set of arguments available to an API function actually looks like
this:

```javascript
advancedSample(args, files, cguid, req, res)
```

<a name="serveruploads"></a>After the `args` object, `files` is an array of files, if any, that have been
uploaded with the request. These files will be automatically deleted at the end
of the request, so you will have to move or copy them if you want them to be
retained on the server. Elements of that array look like this:

```javascript
{
    field:    "userfile",
    filename: "df940321.jpg",
    encoding: "7bit",
    mimeType: "image/jpeg",
    tmpfile:  "/tmp/tmp-122776-mc3n2QnmnPRR",
    bytes:    111413
}
```

The `cguid` argument is a unique identifier for the current API call. This can
be useful for logging purposes.

Bringing up the rear, the `req` and `res` arguments are the HTTP request and
response objects from Node. In this kind of minimalist framework, you shouldn't
have to mess with them much, but if you do, they're available to every API
function.


### Logging <a name="logging"></a>

By default, the `Gadgetry` object logs everything to `this.logger`, which is a
thin wrapper around `console.log`. By setting the `logger` property in
`Gadgetry.config` to point to an alternative function, logging messages can be
directed to your logging service of choice.

The `logger` function must take two arguments, `type` and `data`, where `type`
is a string identifying the type of log message, and `data` is an object
containing arbitrary data. The possible `type`s are:

| Type            | Description                             |
|-----------------|-----------------------------------------|
| `api`           | Errors arising from API calls.          |
| `commandResult` | Output of API calls.                    |
| `postCommand`   | Completion of API calls.                |
| `preCommand`    | Contents of API calls.                  |
| `request`       | Errors arising from the request itself. |


### Interceptors <a name="interceptors"></a>

As clean and minimalist as Gadgetry is, the real world is full of messes, and
that sometimes requires getting into low-level details. For those (hopefully
rare) occasions, Gadgetry provides four interceptor functions to manipulate
HTTP requests and responses, as well as the arguments and results of your API
functions. You can set these in the constructor or directly in `Gadgetry.cfg`.

`intPreReq(req, res)` is called before any processing with the HTTP request
and response objects.

`intPreRes(req, res)` is called right before the response is sent.

`intPreCmd(req, res, cmd)` is called before each command in the request is
executed.

`intPostCmd(req, res, cmd, result)` is called right after each command is
executed.

## Client-Side <a name="clientside"></a>

### Single Requests <a name="singlereqs"></a>

Thanks to the `GQuery` class, using Gadgetry from the client side is even easier
than working on the server side. You can use either `GQuery.js` for the browser
or the nearly identical `GQuery.mjs` to run under Node. The constructor takes
two arguments:

```javascript
var gq = new GQuery("https://somedomain.com/api", {
    benchmark: false,
    ignoreErrors: false
});
```

The first argument is the URL of the API. The second, optional argument, shown
here with its default values, allows you to turn benchmarking and error handling
on and off. We'll come back to those options in a minute, but first, here's what
the simplest form of making an API call looks like.

```javascript
var result = await gq.req("getCircleArea", { radius: 2.5, unit: "cm" });
```

In this case, the API function being called is `getCircleArea` with two
arguments, `radius` and `unit`. The result that comes back would look something
like this:

```javascript
{ area: 19.63495, unit: "cm^2" }
```

You can re-use the `GQuery` object to make multiple calls to the `req` method,
of course. It really doesn't get any easier than that.

### Multiple Requests <a name="batchreqs"></a>

Firing off calls to API functions one at a time works fine for some things, but
it's terribly slow and inefficient if you have a bunch of API functions to hit
at once. Fortunately, `GQuery` makes it easy to do this:

```javascript
gq.addCommand("getCircleArea", { radius: 2.5, unit: "cm" }, "circle");
gq.addCommand("getSquareArea", { side: 3.24, unit: "ft" }, "square");
gq.addCommand("getTriangleArea", { base: 5, height: 15, unit: "in" }, "triangle");

var results = await gq.exec();
```

Instead of using the `req` method, you use `addCommand` to queue individual API
calls and then call `exec` to fire the whole batch off to the server in a single
request.

The `results` come back as an array of objects in the same order as the
individual API functions were added to the batch. Even so, it can sometimes be
hard to keep track of which result goes with which function, so we've used the
optional third `id` argument of `addCommand` that will come back in each result
as `_id`:

```javascript
console.log(results);

[
    { area: 19.63495, unit: "cm^2", _id: "circle" },
    { area: 10.4976, unit: "ft^2", _id: "square" },
    { area: 37.5, unit: "in^2", _id: "triangle" }
]
```

When the results come back, they are also available as `gq.results`, along with
a bunch of statistical information about the batch:

```javascript
gq.cmds     =  // The original array of outbound function calls
gq.worked   =  // The number of calls that succeeded
gq.failed   =  // The number of calls that failed by issuing errors
gq.aborted  =  // The number of calls that were not executed due to earlier errors
gq.cmdcnt   =  // The total number of calls in the batch
gq.exectime =  // If benchmarking was turned on, the total time required in ms
```

We have to make the distinction between `failed` and `aborted` function calls
when the `ignoreErrors` option is false because the server will terminate
execution of the batch and return the successful results of earlier functions
whenever a call fails. (From the server side, this means returning a result
containing an `_errcode` element.) This avoids situations where a later call
depends on the results of an earlier failed call. If all of the function calls
in the batch are independent of each other, you can defeat this behavior by
setting the `ignoreErrors` option to `true`.

Finally, there is also the `benchmark` option to consider. When this is `true`
(the default is `false`), each result will have an additional element named
`_exectime` which contains the execution time of the function in milliseconds.
This is an excellent tool for testing because it gives you the actual execution
time on the server, as distinct from the total round trip timing you can see in
the browser. The same information can be logged server-side as well.

### Uploading Files <a name="uploads"></a>

We already [discussed](#serveruploads) how file uploads look on the server side,
so how about the client side? Easy as pie:

```javascript
gq.addFile("fieldname", fileObj);
```

All you have to do is call the `addFile` method with a form field name and a
browser `File` object. Why bother with a form field name? Uploaded files are
associated with (and accessible to) all of the function calls in the batch
rather than being part of any individual function's arguments. If you are
uploading multiple files and need a way to distinguish between them on the
server side, the field name is a good way to handle that.

## GET Requests <a name="getrequests"></a>

While Gadgetry is focused on being a JSON-over-POST API server, certain
situations require the occasional GET request, so Gadgetry handles those as
well. To enable GET support, set the `useGet` config value to `true` when
calling the `Gadgetry` constructor. Depending on your setup, you will probably
have to set the `getTrim` config value as well, but we'll come back to that
shortly.

A Gadgetry GET URL consists of an optional leading section, which is removed if
it matches `getTrim`, a function name, optional key/value pairs separated by
slashes, and an optional query string:

```
http://yourdomain.com/leading/stuff/getCircleArea/radius/2.5?unit=cm
```

In this example, the protocol and domain (`http://yourdomain.com`) is discarded,
and if `getTrim` is set to `"/leading/stuff/"`, that is discarded as well. The
API function being called is `getCircleArea`, and it receives two parameters,
`radius` and `unit`, which are set to `2.5` and `"cm"`, respectively. All of the
following are equivalent:

```
http://yourdomain.com/leading/stuff/getCircleArea/radius/2.5?unit=cm
http://yourdomain.com/leading/stuff/getCircleArea/radius/2.5/unit/cm
http://yourdomain.com/leading/stuff/getCircleArea?radius=2.5&unit=cm
```

As you can see, it doesn't matter if you pack your function arguments into the
URL itself or the query string or both; whatever works best for your use case
is fine. It is worth noting that if there are any duplicate argument names, later
uses override earlier ones.

## File Downloads <a name="filedownloads"></a>

Instead of sending a JSON response, a Gadgetry API function can send a file,
either copied from a file on disk or produced from any readable stream. No JSON
results are returned, and any other functions in a batch are preempted, so
function calls producing files should generally not be batched with other calls.

To send a file, call the `Gadgetry` object's [`sendFile`](#gadgetrysendfile)
from within an API function. (In the example below, we assume that it is named
`$G`.)

```javascript
// Don't forget that req and res are arguments to every API function

$G.sendFile(req, res, "/path/to/file", "sample.txt", "text/plain");
```

At this point, Gadgetry sends the appropriate headers and begins streaming the
file to the client. As noted above, this terminates processing of the current
function batch. To send an arbitrary stream to the client, simply use the
[`sendStream`](#gadgetrysendstream) method instead of `sendFile`.


## Class Reference <a name="classreference"></a>

### Gadgetry (server side) <a name="gadgetryclass"></a>

#### `constructor(api, config = { })` <a name="gadgetryconstructor"></a>

The constructor takes two arguments. The first, `api`, is required and is an
object whose keys are the names of API functions and whose values are the actual
JavaScript functions that carry them out. The second argument, `config`, is
optional, but will be used by most real world applications. The possible values
of `config` and their defaults are as follows:

| Name            | Default       | Description                                                                                                           |
|-----------------|---------------|-----------------------------------------------------------------------------------------------------------------------|
| `debug`         | `false`       | If `true`, returns error data as `_e` to the client when an exception occurs during the execution of an API function. |
| `intPostCmd`    | `false`       | A function to intercept the results of API function calls. See [Interceptors](#interceptors) for details.             |
| `intPreCmd`     | `false`       | A function to fire before API function calls. See [Interceptors](#interceptors) for details.                          |
| `intPreReq`     | `false`       | A function called with the initial request. See [Interceptors](#interceptors) for details.                            |
| `intPreRes`     | `false`       | A function called with the response before sending to the client. See [Interceptors](#interceptors) for details.      |
| `logger`        | `this.logger` | A function to receive logging data. See [Logging](#logging) for details.                                              |
| `maxFieldCount` | `Infinity`    | Maximum number of form fields.                                                                                        |
| `maxFieldSize`  | `Infinity`    | Maximum size of individual form fields.                                                                               |
| `maxFileCount`  | `Infinity`    | Maximum number of files allowed with each request or batch of requests.                                               |
| `maxFileSize`   | `Infinity`    | Maximum file size.                                                                                                    |
| `port`          | `8080`        | Port to listen on.                                                                                                    |
| `useGet`        | `false`       | If `true`, GET requests will be accepted. |
| `getTrim`       | `false`       | A leading string to remove from the URL when processing GET requests. |
| `errcodeLabel`  | `"_errcode"`  | The name of the response field which tells Gadgetry that an API error has occurred. Also used for system errors. |
| `idLabel`       | `"_id"`       | The name of the response field containing the API call ID. |
| `errmsgLabel`   | `"_errmsg"`   | The name of the response field containing system error messages. |
| `errlocLabel`   | `"_errloc"`   | The name of the response field containing error locations. |
| `argsLabel`     | `"_args"`     | The name of the response field containing API call arguments when an exception occurs. |
| `eLabel`        | `"_e"`        | If `debug` is true, the name of the response field containing the exception produced by an API call. |


---

#### `guid()` <a name="gadgetryguid"></a>

Gadgetry generates GUIDs for each inbound API function call. This method exposes
that functionality to the user. Calling it returns a new GUID string.

---

#### `sendFile(req, res, filepath, filename, contentType = false)` <a name="gadgetrysendfile"></a>

This method interrupts the normal flow of request handling to send a file to the
client. It should be called from within an API function. For more information about
how to use it, see [File Downloads](#filedownloads).

**Arguments:**

| name        | description                                                                   |
|-------------|-------------------------------------------------------------------------------|
| req         | The inbound request object.                                                   |
| res         | The outbound response object.                                                 |
| filepath    | The path to the file to be transferred.                                       |
| filename    | The filename to be given to the client.                                       |
| contentType | The value of the Content-Type header. Defaults to `application/octet-stream`. |

**Returns:** `undefined`

---

#### `sendStream(req, res, filepath, filename, contentType = false, size = false)` <a name="gadgetrysendstream"></a>

Interrupts the normal flow of request handling to send an arbitrary stream as a
file to the client. It should be called from within an API function. For more
information about how to use it, see [File Downloads](#filedownloads).

**Arguments:**

| name        | description                                                                   |
|-------------|-------------------------------------------------------------------------------|
| req         | The inbound request object.                                                   |
| res         | The outbound response object.                                                 |
| filepath    | The path to the file to be transferred.                                       |
| filename    | The filename to be given to the client.                                       |
| contentType | The value of the Content-Type header. Defaults to `application/octet-stream`. |
| size        | If supplied, the total size of the streamed data in bytes.                    |

**Returns:** `undefined`



### GQuery (client side) <a name="gqueryclass"></a>

#### `constructor(url, params = { })` <a name="gqueryconstructor"></a>

**Arguments:**

| name   | description                                                                                                  |
|--------|--------------------------------------------------------------------------------------------------------------|
| url    | The complete URL to the server side API resource.                                                            |
| params | An object containing boolean values for one or both of `benchmark` and `ignoreErrors`, both default `false`. |

**Returns:** a new `GQuery` object.

---

#### `addCommand(cmd, args = { }, id = null)` <a name="gqueryaddcommand"></a>

Adds a new API request to the pending batch to be sent to the server when the
[`exec`](#gqueryexec) method is called.

**Arguments:**

| name | description                                           |
|------|-------------------------------------------------------|
| cmd  | The name of the requested API function                |
| args | An object containing its arguments.                   |
| id   | An optional ID to be returned in the results as `_id` |

**Returns:** `this`

---

#### `addFile(name, fileObject)` <a name="gqueryaddfile"></a>

**Arguments:**

| name       | description                |
|------------|----------------------------|
| name       | A field name for the file. |
| fileObject | A `File` object.           |

**Returns:** `this`

---

#### `benchmark(val)` <a name="gquerybenchmark"></a>

This method sets the value of the internal `benchmark` flag. While this is `true`,
responses from the server will include `_exectime` elements containing the number
of milliseconds required to execute the requested API function.

**Arguments:**

| name | description                                                                      |
|------|----------------------------------------------------------------------------------|
| val  | A boolean indicating whether to use benchmarking or not. The default is `false`. |

**Returns:** `this`

---

#### `async exec()` <a name="gqueryexec"></a>

The `exec` method sends the whole pending batch of API calls created with [`addCommand`](#gqueryaddcommand)
to the server for execution and returns the results array when it arrives, which it
also assigns to its `results` member. Upon completion of the request, several additional
members will be set with statistical values from the transaction:

| name    | description                                                                        |
|---------|------------------------------------------------------------------------------------|
| cmdcnt  | Total number of commands in the batch                                              |
| worked  | Number of commands that executed successfully                                      |
| failed  | Number of commands that failed, i.e., returned an _errcode element                 |
| aborted | Number of commands that were not executed at all because an earlier command failed |

**Arguments:** none

**Returns:** A results array.

---

#### `getFilesFromForm(formobj)` <a name="querygetfilesfromform"></a>

This convenience method takes a `Form` object with file inputs and calls
`addFile` on each one, sparing you the inconvenience of instantiating a
bunch of `File` objects.

**Arguments:**

| name    | description             |
|---------|-------------------------|
| formobj | A browser `Form` object |

**Returns:** `this`

---

#### `ignoreErrors(val)` <a name="gqueryignoreerrors"></a>

Sets the internal `ignoreErrors` flag. If `false`, a batch of API functions will
be halted when the first one fails, i.e., returns an object containing `_errcode`.
If `true`, the server will attempt to execute all of the functions in the request
regardless of success or failure.

**Arguments:**

| name | description                                                                   |
|------|-------------------------------------------------------------------------------|
| val  | A boolean indicating whether to ignore errors or not. The default is `false`. |

**Returns:** `this`

---

#### `async req(cmd, args, id = null)` <a name="gqueryreq"></a>

Sends a single API call to the server for immediate execution.

**Arguments:**

| name | description                                           |
|------|-------------------------------------------------------|
| cmd  | The name of the requested API function                |
| args | An object containing its arguments.                   |
| id   | An optional ID to be returned in the results as `_id` |

**Returns:** a single result object

---

#### `reset()` <a name="gqueryreset"></a>

After a batch request has been sent to the server and the results received,
you must call the `reset` method to clear out the internal state so the `GQuery`
object can be reused for further traffic. This is not necessary when using
the single-function `req` method.

**Arguments:** none

**Returns:** `this`

## Low-Level Request/Response Details <a name="lowlevel"></a>

The Gadgetry request format appears below. It is POSTed by the client as a
JSON-encoded string in a form field named `payload`. All other fields are file
uploads.

```javascript
{
    params: {                     // optional, governs whole request
        benchmark: true,              // default false
        ignoreErrors: false           // default false
    },
    cmds: [                       // contains one or more API function calls
        {
            cmd: "getPrices",              // name of API function
            args: {                        // named, unordered arguments to function
                dept:   "tools",
                subset: "saleItems",
                limit:  500,
            }
            id: "price query"              // optional, returned with results
         },
        {
            cmd: "getSales",
            args: {
                saleType: "weekend",
                expires:  "2019-05-15"
            }
         },

    ]
}
```

The optional `params` member specifies parameters that apply to the whole
request. Currently, two parameters are supported. The `benchmark` flag (default
`false`) enables timing information in the response. The `ignoreErrors` flag
(default `false`) will cause all of the commands in the request to be processed
regardless of any errors; the default behavior is to stop processing after the
first error.

The `cmds` member is mandatory, and its value is an array of commands/endpoints
to execute. The only required member of each is the `cmd` element, which specifies
the function name, but most commands will include an `args` object containing
named, unordered arguments to the function. Finally, the optional `id` element is
attached to the command results to make it easier to identify.

For the purposes of this example, we'll assume that the second command,
`"getSales"` failed. The response, also JSON-encoded in transit, would look
something like this:

```javascript
{
    cmdcnt:   2,            // total number of commands in request
    worked:   1,            // number of commands that succeeded
    failed:   1,            // number of commands that failed
    aborted:  0,            // number of commands not executed after an earlier error
    exectime: 4,            // total execution time (may be greater than the sum of
                            //     the individual commands' execution times due to
                            //     system overhead)

    results: [             // array of results, in same order as in request
        {
            resultField:  "....",      // output of command, can be any type
            _exectime: 2,              // runtime of command in milliseconds (if params.benchmark == true)
            _id:       "price query"   // id string passed with request
        },
        {
            _errcode:  "DARNIT",         // invariant short error code (see below)
            _errmsg:   "Bad date",       // human-readable error message (optional)
            _errloc:   "funcname code",  // location of error in server-side source (optional)
            _exectime: 1                 // in milliseconds, if params.benchmark is true
        }
    ]
}
```

The first four elements, `cmdcnt`, `worked`, `failed`, and `aborted`, specify
how many commands were in the request, how many succeeded, how many failed, and
how many were skipped after the first error, respectively.

The `results` element contains an array of command results in the same order as
in the request. Each result consists of the object returned by the API function,
possibly containing elements generated by Gadgetry, conventionally prefixed with
underscores. If the `params.benchmark` flag is on, an `_exectime` element will
contain the number of milliseconds elapsed during command execution. If a
command `id` was supplied, it will also be included as `_id`.

Failed commands will contain `_errcode`. The optional convention shown here
includes an `_errmsg` element that contains a human-readable error message
which, depending on the situation, might be intended for display to an end user
in a user interface, but which may be expected to change over time as the API
evolves. The `_errcode` element, on the other hand, is intended to be a short,
invariant code that client-side code can depend on.


<!--

TODO:

    * Multiple file downloads

-->


