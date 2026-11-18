// Traverse - shared helpers (ExtendScript / ES3)
TRV.version = "1.1.0";
TRV.__dev = true; // reload engines on every panel load / message

TRV.stringify = function (v) {
    var t = typeof v, i, a, k;
    if (v === null || v === undefined) return "null";
    if (t === "number") return isFinite(v) ? String(Math.round(v * 10000) / 10000) : "null";
    if (t === "boolean") return v ? "true" : "false";
    if (t === "string") {
        var s = '"', c, code;
        for (i = 0; i < v.length; i++) {
            c = v.charAt(i); code = v.charCodeAt(i);
            if (c === '"') s += '\\"';
            else if (c === "\\") s += "\\\\";
            else if (c === "\n") s += "\\n";
            else if (c === "\r") s += "\\r";
            else if (c === "\t") s += "\\t";
            else if (code < 32 || code > 126) { var h = code.toString(16); while (h.length < 4) h = "0" + h; s += "\\u" + h; }
            else s += c;
        }
        return s + '"';
    }
    if (v instanceof Array) {
        a = [];
        for (i = 0; i < v.length; i++) a.push(TRV.stringify(v[i]));
        return "[" + a.join(",") + "]";
    }
    if (t === "object") {
        a = [];
        for (k in v) { if (v.hasOwnProperty(k) && typeof v[k] !== "function" && v[k] !== undefined) a.push(TRV.stringify(String(k)) + ":" + TRV.stringify(v[k])); }
        return "{" + a.join(",") + "}";
    }
    return "null";
};
TRV.parse = function (s) { return eval("(" + s + ")"); };

TRV.readFile = function (path) {
    var f = new File(path); f.encoding = "UTF-8";
    if (!f.open("r")) throw new Error("Cannot read " + path);
    var s = f.read(); f.close(); return s;
};
TRV.writeFile = function (path, s) {
    var f = new File(path); f.encoding = "UTF-8";
    f.lineFeed = "Unix"; // Windows would otherwise turn every \n into \r\n, also inside the generated .aepx
    if (!f.open("w")) throw new Error("Cannot write " + path + " (" + f.error + ")");
    f.write(s); f.close(); return f.fsName;
};
// Shared exchange folder. (After Effects' own temp folder is private to it, Illustrator cannot read it.)
TRV.tempDir = function () {
    var base = new Folder(Folder.userData.fsName + "/Traverse");
    if (!base.exists) base.create();
    var d = new Folder(base.fsName + "/exchange");
    if (!d.exists) d.create();
    if (!TRV._cleaned) {
        TRV._cleaned = true;
        try {
            var files = d.getFiles(), now = new Date().getTime(), i;
            for (i = 0; i < files.length; i++) { if (files[i] instanceof File && now - files[i].modified.getTime() > 86400000) files[i].remove(); }
        } catch (e) {}
    }
    return d.fsName;
};
TRV.stamp = function () { return String(new Date().getTime()) + "_" + Math.floor(Math.random() * 1000); };
TRV.uid = function () {
    var s = "", c = "abcdefghijklmnopqrstuvwxyz0123456789";
    for (var i = 0; i < 10; i++) s += c.charAt(Math.floor(Math.random() * c.length));
    return s;
};
TRV.ok = function (o) { o = o || {}; o.ok = true; return TRV.stringify(o); };
TRV.fail = function (msg, extra) { var o = extra || {}; o.ok = false; o.error = String(msg); return TRV.stringify(o); };

// Find the running instance of another Adobe app (avoids hitting the wrong installed version)
TRV.findTarget = function (appName) {
    var targets = BridgeTalk.getTargets(null), i, best = null;
    for (i = 0; i < targets.length; i++) {
        if (targets[i].indexOf(appName) === 0 && BridgeTalk.isRunning(targets[i])) best = targets[i];
    }
    if (!best && BridgeTalk.isRunning(appName)) best = appName;
    return best;
};
// Send a script to another app and wait for the answer. Returns {ok, body|error}
TRV.sendTo = function (appName, call, timeoutSec) {
    var target = TRV.findTarget(appName);
    if (!target) return { ok: false, error: "NOT_RUNNING" };
    var bt = new BridgeTalk();
    bt.target = target;
    var hostPath = (TRV.root + "/jsx/host.jsx").replace(/\\/g, "/");
    bt.body = "$.evalFile(new File(" + TRV.stringify(hostPath) + ")); " + call + ";";
    var res = { ok: false, error: "TIMEOUT" };
    bt.onResult = function (m) { res = { ok: true, body: m.body }; };
    bt.onError = function (m) { res = { ok: false, error: m.body }; };
    bt.send(timeoutSec || 120);
    return res;
};
TRV.bringToFront = function (appName) {
    try { var t = TRV.findTarget(appName); if (t) BridgeTalk.bringToFront(t); } catch (e) {}
};
TRV.hex = function (rgb) {
    function h(x) { var v = Math.max(0, Math.min(255, Math.round(x * 255))).toString(16); return v.length < 2 ? "0" + v : v; }
    return (h(rgb[0]) + h(rgb[1]) + h(rgb[2])).toUpperCase();
};
