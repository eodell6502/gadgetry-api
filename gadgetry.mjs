#!/usr/bin/env node

// Standard Node modules -------------------------------------------------------

import fs           from "fs";
import http         from "http";
import {inspect}    from "util";
import os           from "os";
import stream       from "stream";
import qs           from "querystring";

// Third-party modules ---------------------------------------------------------

import Busboy       from "busboy";
import {guid}       from "dyna-guid";
import tmp          from "tmp";


//##############################################################################

export class Gadgetry {


    //==========================================================================

    constructor(api, config) { // FN: Gadgetry.constructor
        this.config = config ? config : { };
        this.api    = api ? api : { };

        // Fill in default config values where they are undefined in this.config.

        const defaults = {
            debug:         false,       // if true, returns error data to client
            getTrim:       false,       // If non-false, the leading part of the URL to trim
            intPostCmd:    false,       // if non-false, intercept post-command
            intPreCmd:     false,       // if non-false, intercept pre-command
            intPreReq:     false,       // if non-false, intercept for incoming requests
            intPreRes:     false,       // if non-false, intercept response
            logger:        this.logger, // function to store log entry
            maxFieldCount: Infinity,    // max number of form fields
            maxFieldSize:  Infinity,    // max form field size
            maxFileCount:  Infinity,    // max file uploads per request
            maxFileSize:   Infinity,    // max uploaded file size
            port:          8080,        // port to listen on
            useGet:        false,       // if true, allow GET requests
            errcodeLabel:  "_errcode",  // name of response key to indicate API call error
            idLabel:       "_id",       // name of returned call ID
            errmsgLabel:   "_errmsg",   // name of returned error message
            errlocLabel:   "_errloc",   // name of returned error location
            argsLabel:     "_args",     // name of returned args
            eLabel:        "_e",        // name of returned exception
        };

        this.requestCount = 0;

        for(var k in defaults)
            if(this.config[k] === undefined)
                this.config[k] = defaults[k];

        // Launch the server ---------------------------------------------------

        this.core();
    }


    //==========================================================================

    async core() { // FN: Gadgetry.core

        http.createServer(async function(req, res) { //-----------------------------------

            this.requestCount++;

            if(this.config.intPreReq)
                this.config.intPreReq(req, res);

            if(req.method == "POST") {

                try {
                    var bb = Busboy({ headers: req.headers });
                } catch(e) {
                    console.log("Fatal Busboy initialization error", e, req.headers);
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

                bb.on("file", function(fieldname, stream, fileinfo) {

                    if(req.files.length >= this.config.maxFileCount) {
                        for(var f of req.files)
                            try { fs.unlinkSync(f.tmpfile, function() { }); } catch(e) { };
                        this.config.logger("request", { errcode: "REQERROR", errmsg: "maxFileCount exceeded."});
                        this.finalizeResponse(req, res, 413);
                        return;
                    }

                    var tmpobj = tmp.fileSync({detachDescriptor: true});
                    var filerec = {
                        field:     fieldname,
                        filename:  fileinfo.filename,
                        encoding:  fileinfo.encoding,
                        mimeType:  fileinfo.mimeType,
                        tmpfile:   tmpobj.name,
                        fd:        tmpobj.fd,
                        bytes:     0,
                    };
                    req.files.push(filerec);

                    stream.on("data", function(data) {
                        filerec.bytes += data.length;
                        if(filerec.bytes > this.config.maxFileSize) {
                            for(var f of req.files)
                               try { fs.unlinkSync(f.tmpfile, function() { }); } catch(e) { };
                            req.files = [ ];
                            this.config.logger("request", { errcode: "REQERROR", errmsg: "maxFileSize exceeded."});
                            this.finalizeResponse(req, res, 413);
                            return;
                        } else {
                            fs.writeSync(filerec.fd, data);
                        }
                    }.bind(this));

                    stream.on("end", function() {
                        fs.closeSync(filerec.fd);
                        delete filerec.fd;
                    });
                }.bind(this));

                req.pipe(bb);

                //--------------------------------------------------------------
                // This event handler assembles all of the non-file field
                // parameters into req.params. It also checks to make sure the
                // field limits have not been exceeded, bailing out with a
                // 413 response if they are.
                //--------------------------------------------------------------

                bb.on("field", function(fieldname, val, fieldnameTruncated, valTruncated, encoding, mimetype) {
                    if(req.params.length > this.config.maxFieldCount ) {
                        this.config.logger("request", { errcode: "REQERROR", errmsg: "maxFieldCount exceeded."});
                        this.finalizeResponse(req, res, 413);
                        return;
                    }
                    if(val.length > this.config.maxFieldSize ) {
                        this.config.logger("request", { errcode: "REQERROR", errmsg: "maxFieldSize exceeded."});
                        this.finalizeResponse(req, res, 413);
                        return;
                    }
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
                        this.config.logger("api", { errcode: "REQERROR", errmsg: "Params or payload undefined."});
                        return this.finalizeResponse(req, res, 400);
                    }

                    try {
                        payload = JSON.parse(req.params.payload);
                        if(!payload)
                            this.config.logger("api", { errcode: "REQERROR", errmsg: "Empty payload."});
                    } catch(e) {
                        this.config.logger("api", { errcode: "REQERROR", errmsg: "Unable to parse payload."});
                        return this.finalizeResponse(req, res, 400);
                    }

                    await this.response(payload, req, res);
                    return;

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

                if(this.config.useGet) {
                    var payload = this.getToPayload(req);
                    if(payload === null) {
                        this.config.logger("api", { errcode: "REQERROR", errmsg: "Params or payload undefined."});
                        return this.finalizeResponse(req, res, 400);
                    }

                    await this.response(payload, req, res);
                    return;

                } else {
                    return this.finalizeResponse(req, res, 405);
                }

            }

        }.bind(this)).listen(this.config.port, function() {
            console.log("Listening for connections on port " + this.config.port);
        }.bind(this));

    }


    //--------------------------------------------------------------------------
    // Generic response subroutine.
    //--------------------------------------------------------------------------

    async response(payload, req, res) {
        try {
            var content = await this.commandLoop(payload, req.files, req, res);
        } catch(e) {
            this.config.logger("api", { errcode: "APIERROR", errmsg: "Exception thrown during command loop", error: e });
            return this.finalizeResponse(req, res, 500);
        }

        if(res._gadgetryFile)
            return;

        if(content === undefined) {
            return this.finalizeResponse(req, res, 400);
        } else {
            try {
                return this.finalizeResponse(req, res, 200, JSON.stringify(content));
            } catch(e) {
                this.config.logger("api", { errcode: "APIERROR", errmsg: "Unable to serialize response content.", error: e });
                return;
            }
        }
    }


    //--------------------------------------------------------------------------
    // Main API command-processing loop.
    //--------------------------------------------------------------------------

    async commandLoop(payload, files, req, res) {  // FN: commandLoop

        if(payload === undefined) {
            this.config.logger("api", { errcode: "CMDERROR", errmsg: "Payload is undefined." });
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

                if(this.config.intPreCmd)
                    this.config.intPreCmd(req, res, cmds[i]);

                var cmd      = cmds[i].cmd;
                var args     = cmds[i].args === undefined ? { } : cmds[i].args;
                var id       = cmds[i].id;
                var cfunc    = this.api[cmd];
                var cguid    = this.guid();
                var cmdStart = Date.now();
                var cres     = { };

                if(cfunc) {
                    try {
                        if(this.config.logger)
                            this.config.logger("preCommand", { cguid: cguid, cmd: cmd, args: args});
                        cres = await cfunc(args, files, cguid, req, res);
                        if(cres === undefined || typeof cres != "object")
                            cres = { };
                        files = [ ];
                    } catch(e) {
                        this.config.logger("api", { errcode: "CMDERROR", errmsg: "Exception thrown by command " + cmd, error: e });
                        cres[this.config.errcodeLabel] = "SYSERR";
                        cres[this.config.errmsgLabel]  = "System error.";
                        cres[this.config.errlocLabel]  = cmd;
                        cres[this.config.argsLabel]    = args;
                        cres[this.config.eLabel]       = this.config.debug ? e : null;
                    }

                    var exectime = Date.now() - cmdStart;
                    if(benchmark && typeof cres == "object")
                        cres._exectime = exectime;
                    if(this.config.logger)
                        this.config.logger("postCommand", { cmd: cmd, cguid: cguid, exectime: exectime });

                    if(id !== undefined)
                        cres[this.config.idLabel] = id;

                    if(this.config.intPostCmd)
                        this.config.intPostCmd(req, res, cmd[i], cres);

                    result.results.push(cres);

                    if(cres[this.config.errcodeLabel]) {
                        result.failed++;
                        if(!ignoreErrors) {
                            result.aborted = result.cmdcnt - (i + 1);
                            break;
                        }
                    } else {
                        result.worked++;
                    }
                    if(this.config.logger)
                        this.config.logger("commandResult", { cguid: cguid, result: cres });
                    if(res._gadgetryFile) {
                        return;
                    }
                } else {
                    this.config.logger("api", { errcode: "REQERROR", errmsg: "Invalid command " + cmd });
                    return undefined;
                }


            }
            if(Array.isArray(files))
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
    // Converts URL with GET query string into payload.
    //==========================================================================

    getToPayload(req) {
        var url = req.url;
        if(this.config.getTrim && url.substr(0, this.config.getTrim.length) == this.config.getTrim)
            url = url.substr(this.config.getTrim.length);
        var [url, query] = url.split("?");
        url = url.split("/");
        if(!url.length)                       // no command?
            return null;
        var cmd = url.shift(); console.log(cmd, url);
        if(url.length % 2)                    // odd number of post-command parts?
            return null;
        var args = { };
        for(var i = 0; i < url.length; i += 2)
            args[url[i]] = url[i+1];
        if(query) {
            var qargs = qs.parse(query);
            for(var k in qargs)
                args[k] = qargs[k];
        }
        return { cmds: [ { cmd: cmd, args: args} ] };
    }


    //==========================================================================
    // Method for API code to use to respond with a stream download
    //==========================================================================

    async sendStream(req, res, fstream, filename, contentType = false, size = false) {
        var headers = {
            "Content-Type": contentType ? contentType : "application/octet-stream",
            "Content-Disposition": "attachment; filename=" + filename,
        };
        if(size)
            headers["Content-Length"] = size;

        res.writeHead(200, headers);
        res._gadgetryFile = true;
        fstream.pipe(res);
    }


    //==========================================================================
    // Wrapper around this.sendStream that takes a filepath instead of a stream.
    //==========================================================================

    async sendFile(req, res, filepath, filename, contentType = false) {
        try {
            var size = fs.statSync(filepath).size;
            var fstream = fs.createReadStream(filepath);
            this.sendStream(req, res, fstream, filename, contentType, size);
        } catch(e) { console.log(e);
            this.finalizeResponse(req, res, 404);
        }
        return;
    }


    //==========================================================================
    // Sends the response.
    //==========================================================================

    finalizeResponse(req, res, status = 400, content = "") { // FN: Gadgetry.finalizeResponse
        var origin = (req.headers && req.headers.origin) ? req.headers.origin : "none";

        if(res.gadgetryStatus !== undefined)
            status = res.gadgetryStatus;
        if(this.config.intPreRes)
            this.config.intPreRes(req, res);
        res.writeHead(status, {
            Connection: "close",
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Content-Type": "application/json"
        }).end(content);

    }

    //==========================================================================
    // Generates and returns a new GUID.
    //==========================================================================

    guid() {
        return guid();
    }

    //==========================================================================
    // Default logger.
    //==========================================================================

    async logger(type, data) {
        console.log(type, data);
    }

}

export default Gadgetry;
