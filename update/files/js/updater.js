/* Traverse updater. Runs in the panel (CEP + Node) and in plain Node for tests.
   An update is a signed list of files: nothing is written unless the signature and every file hash check out. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  if (root) root.TraverseUpdater = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  function create(req) {
    var fs = req("fs"), path = req("path"), crypto = req("crypto");

    function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; } }
    function currentVersion(dir) { var v = readJSON(path.join(dir, "version.json")); return v && v.version ? String(v.version) : "0.0.0"; }
    function cmp(a, b) {
      var x = String(a).split("."), y = String(b).split("."), i, n;
      for (i = 0; i < 3; i++) { n = (parseInt(x[i], 10) || 0) - (parseInt(y[i], 10) || 0); if (n) return n > 0 ? 1 : -1; }
      return 0;
    }
    function sha256(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }
    // the exact text that is signed: version plus every file with its hash and size
    function canonical(m) {
      var files = m.files.slice().sort(function (a, b) { return a.path < b.path ? -1 : (a.path > b.path ? 1 : 0); });
      return "traverse-update-v1\n" + m.version + "\n" + files.map(function (f) { return f.path + " " + f.sha256 + " " + f.size; }).join("\n");
    }
    function verify(m, dir) {
      try {
        var key = fs.readFileSync(path.join(dir, "update.pub"), "utf8");
        return crypto.verify(null, Buffer.from(canonical(m), "utf8"), key, Buffer.from(String(m.signature), "base64"));
      } catch (e) { return false; }
    }
    function safeRel(rel) {
      if (typeof rel !== "string" || !rel || rel.length > 200) return false;
      if (!/^[A-Za-z0-9._@\-\/ ]+$/.test(rel)) return false;
      if (rel.charAt(0) === "/" || rel.indexOf("..") >= 0 || rel.indexOf("//") >= 0) return false;
      return true;
    }
    function allowedUrl(u) {
      return /^https:\/\//i.test(u) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(u); // plain http only for local testing
    }
    function fetch(url, cb, hops) {
      if (!allowedUrl(url)) return cb(new Error("Update address must use https"));
      var lib = req(/^https:/i.test(url) ? "https" : "http"), done = false;
      function fin(e, b) { if (!done) { done = true; cb(e, b); } }
      var r = lib.get(url, { headers: { "Cache-Control": "no-cache" } }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (hops || 0) < 3) {
          res.resume(); return fetch(new URL(res.headers.location, url).toString(), cb, (hops || 0) + 1);
        }
        if (res.statusCode !== 200) { res.resume(); return fin(new Error("HTTP " + res.statusCode + " for " + url)); }
        var chunks = [], size = 0;
        res.on("data", function (c) { size += c.length; if (size > 50 * 1024 * 1024) { r.destroy(); fin(new Error("File too large")); } else chunks.push(c); });
        res.on("end", function () { fin(null, Buffer.concat(chunks)); });
      });
      r.setTimeout(20000, function () { r.destroy(); fin(new Error("Timed out")); });
      r.on("error", function (e) { fin(e); });
    }
    function channel(dir) {
      var c = readJSON(path.join(dir, "channel.json")), u = c && c.url ? String(c.url) : "";
      if (u && u.charAt(u.length - 1) !== "/") u += "/";
      return u;
    }
    // -> {state: dev | off | current | available | error, current, latest, manifest, base, error}
    function check(dir, cb) {
      var cur = currentVersion(dir);
      if (fs.existsSync(path.join(dir, ".dev"))) return cb({ state: "dev", current: cur });
      var base = channel(dir);
      if (!base) return cb({ state: "off", current: cur });
      fetch(base + "update.json?t=" + Date.now(), function (err, buf) {
        if (err) return cb({ state: "error", current: cur, error: err.message });
        var m; try { m = JSON.parse(buf.toString("utf8")); } catch (e) { return cb({ state: "error", current: cur, error: "Bad update list" }); }
        if (!m || !m.version || !(m.files instanceof Array) || !m.files.length) return cb({ state: "error", current: cur, error: "Bad update list" });
        if (!verify(m, dir)) return cb({ state: "error", current: cur, error: "Update signature does not match" });
        for (var i = 0; i < m.files.length; i++) if (!safeRel(m.files[i].path)) return cb({ state: "error", current: cur, error: "Unsafe path in update" });
        if (cmp(m.version, cur) <= 0) return cb({ state: "current", current: cur, latest: m.version });
        cb({ state: "available", current: cur, latest: m.version, manifest: m, base: base });
      });
    }
    function mkdirp(d) { fs.mkdirSync(d, { recursive: true }); }
    function pause(ms) { var end = Date.now() + ms; while (Date.now() < end) { /* short blocking wait between retries */ } }
    // On Windows an antivirus scan or the other app's panel can hold a file for a moment: retry before giving up
    function replaceFile(from, to) {
      var tries = 0;
      for (;;) {
        try { fs.renameSync(from, to); return; }
        catch (e) {
          if (++tries > 12 || ["EPERM", "EBUSY", "EACCES"].indexOf(e.code) < 0) { try { fs.unlinkSync(from); } catch (e2) {} throw e; }
          pause(150);
        }
      }
    }
    // Illustrator and After Effects each run a panel: only one of them may install at a time
    function lock(dir) {
      var p = path.join(dir, ".updating");
      try { var st = fs.statSync(p); if (Date.now() - st.mtimeMs < 5 * 60 * 1000) return null; fs.unlinkSync(p); } catch (e) {}
      try { fs.writeFileSync(p, String(Date.now()), { flag: "wx" }); return p; } catch (e2) { return null; }
    }
    // download what changed into memory, verify everything, only then touch the installed files
    function apply(dir, base, m, cb) {
      var todo = [], i, f, local;
      for (i = 0; i < m.files.length; i++) {
        f = m.files[i];
        try { local = sha256(fs.readFileSync(path.join(dir, f.path))); } catch (e) { local = null; }
        if (local !== f.sha256) todo.push(f);
      }
      var got = {}, n = 0;
      (function next() {
        if (n >= todo.length) return write();
        var item = todo[n++];
        fetch(base + "files/" + item.path.split("/").map(encodeURIComponent).join("/"), function (err, buf) {
          if (err) return cb(err);
          if (buf.length !== item.size || sha256(buf) !== item.sha256) return cb(new Error("Download does not match the signed list: " + item.path));
          got[item.path] = buf; next();
        });
      })();
      function write() {
        try {
          var k, dest;
          for (k in got) if (got.hasOwnProperty(k)) {
            dest = path.join(dir, k);
            if (path.resolve(dest).indexOf(path.resolve(dir) + path.sep) !== 0) throw new Error("Unsafe path");
            mkdirp(path.dirname(dest));
            fs.writeFileSync(dest + ".trvnew", got[k]);
          }
          for (k in got) if (got.hasOwnProperty(k)) replaceFile(path.join(dir, k) + ".trvnew", path.join(dir, k));
          fs.writeFileSync(path.join(dir, "version.json"), JSON.stringify({ version: m.version }) + "\n");
          cb(null, { version: m.version, files: todo.length });
        } catch (e) { cb(e); }
      }
    }
    function update(dir, cb) {
      check(dir, function (r) {
        if (r.state !== "available") return cb(null, r);
        var held = lock(dir);
        if (!held) return cb(null, { state: "busy", current: r.current, latest: r.latest });
        apply(dir, r.base, r.manifest, function (err, res) {
          try { fs.unlinkSync(held); } catch (e) {}
          if (err) return cb(null, { state: "error", current: r.current, latest: r.latest, error: err.message });
          cb(null, { state: "updated", current: res.version, previous: r.current, files: res.files, notes: r.manifest.notes || "" });
        });
      });
    }
    return { check: check, apply: apply, update: update, currentVersion: currentVersion, cmp: cmp, canonical: canonical, sha256: sha256 };
  }
  return { create: create };
});
