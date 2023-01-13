#!/usr/bin/env node

/*

TODO:

    * Gadgetry
        * Do something about console output and/or logging of system messages.

    * GQuery
        * url and params get/set
        * single request shortcut

Gadgetry is a minimalist web API-only framework designed to be as quick and easy
to use as possible. By using its own request protocol, it supports API requests
over POST, including batched requests and file uploads. All you have to do is
set a few config values and provide it with a set of functions with names
matching the inbound requests. From the browser side, making API calls is as
simple as calling any other asynchronous function. From the server side, you're
also just writing simple functions.

This simplicity is accomplished through a simple protocol that disposes with the
needlessly complicated conventions used by other frameworks. Gadgetry has its
own error codes, so HTTP response codes are largely ignored. All requests are
JSON-over-POST. Gadgetry also largely ignores URLs. As far as both client and
server are concerned, functions are being called and results returned, and HTTP
just happens to be how that happens.

If that sounds a lot like a traditional remote procedure call, you're not wrong.
Unlike other RPC protocols, e.g., SOAP, however, Gadgetry's model is dead simple
(and free of XML).

Gadgetry is developed using PM2 as a process manager and Nginx as a reverse
proxy, but is capable of running standalone or with other process managers and
proxies.

*/

// Standard Node modules -------------------------------------------------------

import fs           from "fs";
import http         from "http";
import {inspect}    from "util";
import os           from "os";
import qs           from "querystring";
import stream       from "stream";

// Third-party modules ---------------------------------------------------------

import Busboy       from "busboy";
import {guid}       from "dyna-guid";
import tmp          from "tmp";


//##############################################################################

export class Gadgetry {


    //==========================================================================

    constructor(api, cfg) { // FN: Gadgetry.constructor
        this.cfg    = cfg ? cfg : { };
        this.api    = api ? api : { };

        // Fill in default config values where they are undefined in this.cfg.

        const defaults = {
            apiLog:        false,      // function to store log entry
            getBase:       false,      // if non-false, the base for GET queries
            intPreReq:     false,      // if non-false, intercept for incoming requests
            intPreCmd:     false,      // if non-false, intercept pre-command
            intPostCmd:    false,      // if non-false, intercept post-command
            intPreRes:     false,      // if non-false, intercept response                           /* TODO */
            maxFieldCount: Infinity,   // max number of form fields
            maxFieldSize:  Infinity,   // max form field size
            maxFileCount:  Infinity,   // max file uploads per request
            maxFileSize:   Infinity,   // max uploaded file size
            port:          8080,       // port to listen on
        };

        this.requestCount = 0;

        for(var k in defaults)
            if(this.cfg[k] === undefined)
                this.cfg[k] = defaults[k];

        // Launch the server ---------------------------------------------------

        this.core(this.cfg);
    }


    //==========================================================================

    async core(cfg) { // FN: Gadgetry.core

        http.createServer(async function(req, res) { //-----------------------------------

            this.requestCount++;

            if(this.cfg.intPreReq)
                this.cfg.intPreReq(req, res);

            if(req.method == "POST") {

                try {
                    var bb = Busboy({
                        headers: req.headers,
                        limits: {
                            fieldSize: this.cfg.maxFieldSize,
                        }
                    });
                } catch(e) {
                    console.log("Busboy initialization error", e, req.headers);
                    process.exit(1);
                    return;
                }

                req.params = { };
                req.files  = [ ];

                //--------------------------------------------------------------
                // Here we intercept inbound files, and after checking them
                // against the configured limits, we write them to local
                // temporary files and add to the req.files data structure.
                //--------------------------------------------------------------

                bb.on("file", function(fieldname, file, filename, encoding, mimetype) {

                    if(req.files.length >= this.cfg.maxFileCount) {
                        for(var f of req.files)
                            try { fs.unlinkSync(f.tmpfile, function() { }); } catch(e) { };
                        console.log("maxFileCount exceeded.");
                        this.finalizeResponse(req, res, 413);
                    }

                    var tmpobj = tmp.fileSync({detachDescriptor: true});
                    var filerec = {
                        field:     fieldname,
                        filename:  filename.filename,
                        encoding:  filename.encoding,
                        mimeType:  filename.mimeType,
                        tmpfile:   tmpobj.name,
                        fd:        tmpobj.fd,
                        bytes:     0,
                    };
                    req.files.push(filerec);

                    file.on("data", function(data) {
                        filerec.bytes += data.length;
                        if(filerec.bytes > this.cfg.maxFileSize) {
                            for(var f of req.files)
                               try { fs.unlinkSync(f.tmpfile, function() { }); } catch(e) { };
                            req.files = [ ];
                            console.log("maxFileSize exceeded");
                            this.finalizeResponse(req, res, 413);
                        } else {
                            fs.writeSync(filerec.fd, data);
                        }
                    }.bind(this));

                    file.on("end", function() {
                        fs.closeSync(filerec.fd);
                        delete filerec.fd;
                    });
                }.bind(this));

                req.pipe(bb);

                //--------------------------------------------------------------
                // This event handler assembles all of the non-file field
                // parameters into req.params.
                //--------------------------------------------------------------

                bb.on("field", function(fieldname, val, fieldnameTruncated, valTruncated, encoding, mimetype) {
                    if(req.params.length >= this.cfg.maxFieldCount)
                        this.finalizeResponse(req, res, 413);
                    req.params[fieldname] = val;
                }.bind(this));

                //--------------------------------------------------------------
                // When this event handler is called, we are done assembling the
                // components of the request and ready to dispatch (or not) the
                // appropriate API function.
                //--------------------------------------------------------------

                bb.on("finish", async function() {
                    var payload;

                    if(req.params === undefined || req.params.payload === undefined) {
                        console.log("PARAMS OR PAYLOAD UNDEFINED");
                        this.finalizeResponse(req, res);
                    }

                    try {
                        payload = JSON.parse(req.params.payload);
                        if(!payload)
                            console.log("PAYLOAD EMPTY", req.params);
                    } catch(e) {
                        console.log("EMPTY PAYLOAD");
                        this.finalizeResponse(req, res);
                    }

                    try {
                        var content = await this.commandLoop(payload, req.files, req, res);
                    } catch(e) {
                        console.log(e);
                        this.finalizeResponse(req, res, 500);
                    }

                    if(content === undefined) {
                        this.finalizeResponse(req, res);
                    } else {
                        try {
                            this.finalizeResponse(req, res, 200, JSON.stringify(content));
                        } catch(e) {
                            console.log(content);
                        }
                    }
                }.bind(this));

            } else if(req.method == "OPTIONS") {

                res.writeHead(204, {
                    "Allow": "OPTIONS, GET, HEAD, POST",
                    "Cache-Control": "max-age=86400",
                    "Access-Control-Allow-Origin":  (req.headers.origin || "none"),
                    "Access-Control-Allow-Credentials": "true",
                    Connection: "close",
                }).end();

            } else if(req.method == "GET") {

                if(this.cfg.getBase) {

                    var payload = this.getQueryToPayload(req.url, this.cfg.getBase);

                    try {
                        var content = await this.commandLoop(payload, [], req, res);
                    } catch(e) {
                        console.log(e);
                        this.finalizeResponse(req, res);
                    }

                    if(content === undefined) {
                        this.finalizeResponse(req, res);
                    } else {
                        try {
                            this.finalizeResponse(req, res, 200, JSON.stringify(content));
                        } catch(e) {
                            console.log(content);
                        }
                    }

                } else {
                     this.finalizeResponse(req, res, 204);
                }

            }

        }.bind(this)).listen(this.cfg.port, function() {
            console.log("Listening for connections on port " + this.cfg.port);
        }.bind(this));

    }


    //--------------------------------------------------------------------------
    // Main API command-processing loop.
    //--------------------------------------------------------------------------

    async commandLoop(payload, files, req, res) {  // FN: commandLoop

        if(payload === undefined) {
            console.log("Missing payload.");
            return undefined;
        }

        var benchmarkStart = Date.now();
        var benchmark, ignoreErrors;
        if(payload.params !== undefined) {
            ignoreErrors = payload.params.ignoreErrors ? true : false;
            benchmark    = payload.params.benchmark    ? true : false;
        }

         var result = { worked: 0, failed: 0, aborted: 0, results: [ ] };

         if(payload.cmds !== undefined && Array.isArray(payload.cmds)) {
            var cmds = payload.cmds;
            var clen = cmds.length;
            result.cmdcnt = clen;

            for(var i = 0; i < clen; i++) {

                if(this.cfg.intPreCmd)
                    this.cfg.intPreCmd(req, res, cmd[i]);

                var cmd      = cmds[i].cmd;
                var args     = cmds[i].args;
                var id       = cmds[i].id;
                var cfunc    = this.api[cmd];
                var cguid    = guid();
                var cmdStart = benchmark ? Date.now() : 0;

                                                                console.log(cmd + "...");   // FIXME

                if(cfunc) {
                    try {
                        if(this.cfg.apiLog)
                            await this.cfg.apiLog("preCommand", { cguid: cguid, cmd: cmd, args: args});
                        var cres = await cfunc(args, files, req, res, cguid);
                        files = [ ];

                    } catch(e) {
                        console.log("API EXCEPTION", cmd, e);
                        var cres = { _errcode: "SYSERR", _errmsg: "System error.", _errloc: cmd, _args: args, _e: e };  // TODO: hide _e unless debug turned on
                    }

                    var exectime = Date.now() - cmdStart;
                    if(benchmark && typeof cres == "object")
                        cres._exectime = exectime;
                    console.log("..." + cmd + " " + exectime + " msec");  // FIXME

                    if(id !== undefined)
                        cres._id = id;

                    if(this.cfg.intPostCmd)
                        this.cfg.intPostCmd(req, res, cmd[i], cres);

                    result.results.push(cres);
                    if(cres._errcode) {
                        result.failed++;
                        if(!ignoreErrors) {
                            result.aborted = result.cmdcnt - (i + 1);
                            break;
                        }
                    } else {
                        result.worked++;
                    }
                    if(this.cfg.apilog)
                        await this.cfg.apiLog("postCommand", { cguid: cguid, result: cres });
                } else {
                    return undefined;
                }
            }
            for(var f of files)
                try { fs.unlinkSync(f.tmpfile, function() { }); } catch(e) { };
            if(benchmark)
                result._exectime = Date.now() - cmdStart;
            return result;
        } else {
            return undefined;
        }
    }


    //==========================================================================
    // Converts an inbound GET URL into a payload object suitable for passing to
    // commandLoop. Returns false if the beginning of the URL does not match
    // this.cfg.getBase.
    //==========================================================================

    getQueryToPayload(getString, base) { // FN: Gadgetry.getQueryToPayload
        var [path, query] = getString.split("?");
        path = path.replace(/\/+/g, "/");
        if(base != path.substr(0, base.length))
            return false;
        path = path.substr(base.length);

        var args;

        if(query !== undefined && query.length) {
            args = qs.parse(query);
        } else
            args = { };

        path = path.split("/");
        var cmd = path.shift();
        for(var i = 0; i < path.length; i += 2)
            if(path[i].length)
                args[path[i]] = path[i+1];


        return { cmds: [{ cmd: cmd, args: args }] };
    }


    //==========================================================================
    // Sends the response.
    //==========================================================================

    finalizeResponse(req, res, status = 400, content = "") { // FN: Gadgetry.finalizeResponse
        if(res.gadgetryStatus !== undefined)
            status = res.gadgetryStatus;
        if(this.cfg.intPreRes)
            this.cfg.intPreRes(req, res);
        res.writeHead(status, {
            Connection: "close",
            "Access-Control-Allow-Origin": (req.headers.origin || "none"),
            "Access-Control-Allow-Credentials": "true",
            "Content-Type": "application/json"
        }).end(content);

    }



}

export default Gadgetry;
