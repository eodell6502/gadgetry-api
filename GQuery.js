
class GQuery {

    //--------------------------------------------------------------------------

    constructor(url, params = { }) {
        this.url          = url;
        this.benchmark    = false;
        this.ignoreErrors = false;
        this.cmds         = null;
        this.results      = null;
        this.worked       = null;
        this.failed       = null;
        this.aborted      = null;
        this.cmdcnt       = null;
        this.exectime     = null;
        this.files        = null;

        for(var k in params)
            if(this[k] !== undefined)
                this[k] = params[k];
    }

    //--------------------------------------------------------------------------

    addCommand(cmd, args = { }, id = null) {
        var cmd = { cmd: cmd, args: args };
        if(id !== null)
            cmd.id = id;
        if(this.cmds === null)
            this.cmds = [ ];
        this.cmds.push(cmd);
        return this;
    }

    //--------------------------------------------------------------------------

    benchmark(val) {
        this.benchmark = val ? true : false;
        return this;
    }

    //--------------------------------------------------------------------------

    ignoreErrors(val) {
        this.ignoreErrors = val ? true : false;
        return this;
    }

    //--------------------------------------------------------------------------

    addFile(name, fileObject) {
        if(this.files === null)
            this.files = [ ];
        this.files.push([name, fileObject]);
        return this;
    }

    //--------------------------------------------------------------------------

    reset() {
        this.cmds     = null;
        this.results  = null;
        this.worked   = null;
        this.failed   = null;
        this.aborted  = null;
        this.cmdcnt   = null;
        this.exectime = null;
        this.files    = null;
        return this;
    }

    //--------------------------------------------------------------------------

    async exec() {
        var payload = { cmds: this.cmds };
        if(this.params !== null)
            payload.params = this.params;

        var data = new FormData();
        data.append("payload", JSON.stringify(payload));
        if(Array.isArray(this.files))
            for(var i = 0; i < this.files.length; i++)
                data.append(this.files[i][0], this.files[i][1]);

        const requestOptions = { method: "POST", headers: { }, body: data };
        var response = await fetch(this.url, requestOptions);
        var body = await response.text();
        body = JSON.parse(body);

        this.results  = body.results;
        this.worked   = body.worked;
        this.failed   = body.failed;
        this.aborted  = body.aborted;
        this.cmdcnt   = body.cmdcnt !== undefined   ? body.cmdcnt  : null;
        this.exectime = body.exectime !== undefined ? body.exectime : null;

        return this.results;
    }

    //--------------------------------------------------------------------------

    async req(cmd, args, id = null) {
        this.reset();
        this.addCommand(cmd, args, id);
        await this.exec();
        return this.results[0];
    }

    //--------------------------------------------------------------------------

    getFilesFromForm(formobj) {
        var fd = new FormData(formobj);
        for(var item of fd.entries())
            if(typeof item[1] == "object")        // FIXME: try instanceof instead
                this.addFile(item[0], item[1]);
        return this;
    }



}


