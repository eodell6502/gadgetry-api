
class GQuery {

    //--------------------------------------------------------------------------

    constructor(url, params = { }) {
        this.url      = url;
        this.params   = params;
        this.cmds     = null;
        this.results  = null;
        this.worked   = null;
        this.failed   = null;
        this.aborted  = null;
        this.cmdcnt   = null;
        this.exectime = null;
        this.files    = null;
    }

    //--------------------------------------------------------------------------

    addCommand(cmd, args = { }, id = null) {
        var cmd = { cmd: cmd, args: args };
        if(id !== null)
            cmd.id = id;
        if(this.cmds === null)
            this.cmds = [ ];
        this.cmds.push(cmd);
    }

    //--------------------------------------------------------------------------

    setParams(params) {
        this.params = params;
    }


    //--------------------------------------------------------------------------

    addFile(name, fileObject) {
        if(this.files === null)
            this.files = [ ];
        this.files.push([name, fileObject]);
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

    getFilesFromForm(formobj) {
        var fd = new FormData(formobj);
        for(var item of fd.entries())
            if(typeof item[1] == "object")
                this.addFile(item[0], item[1]);
    }



}


