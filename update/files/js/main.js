/* Traverse panel — runs inside the CEP panel of Illustrator and After Effects */
(function () {
  "use strict";
  var cep = window.__adobe_cep__;
  var host = "ILST", extPath = "";
  try { host = JSON.parse(cep.getHostEnvironment()).appId; } catch (e) {}
  try { extPath = cep.getSystemPath("extension"); } catch (e) {}
  var isAI = host === "ILST";

  var DEFAULTS = {
    split: "top", anchor: "c", parametric: true, newComp: false, center: false, guides: false,
    animateOn: false, animate: "smooth", linkColors: false, link: false,
    aeNewArtboard: false, aeGuides: false, aeAnimate: "smooth"
  };
  var opts = {};
  try { opts = JSON.parse(localStorage.getItem("traverse.opts") || "{}"); } catch (e) { opts = {}; }
  Object.keys(DEFAULTS).forEach(function (k) { if (opts[k] === undefined) opts[k] = DEFAULTS[k]; });
  ["animate", "aeAnimate"].forEach(function (k) { if (["smooth", "bouncy", "snappy", "soft"].indexOf(opts[k]) < 0) opts[k] = "smooth"; });
  opts.newComp = false; // never remembered: every session starts by pushing into the open comp
  function save() { try { localStorage.setItem("traverse.opts", JSON.stringify(opts)); } catch (e) {} }

  function $(id) { return document.getElementById(id); }
  function evalJSX(script) {
    return new Promise(function (resolve) { cep.evalScript(script, function (r) { resolve(r); }); });
  }
  function call(fn, arg) {
    var a = arg === undefined ? "" : JSON.stringify(JSON.stringify(arg));
    return evalJSX("TRV." + fn + "(" + a + ")").then(function (r) {
      try { return JSON.parse(r); } catch (e) { return { ok: false, error: r === "EvalScript error." ? "Script error in " + fn : String(r) }; }
    });
  }
  function loadHost() {
    var p = (extPath + "/jsx/host.jsx").replace(/\\/g, "/");
    return evalJSX('$.evalFile(new File(' + JSON.stringify(p) + ')); "ok"');
  }

  // ---------- UI binding ----------
  function bind() {
    document.querySelectorAll("[data-opt]").forEach(function (el) {
      var k = el.getAttribute("data-opt");
      if (el.classList.contains("seg") || el.classList.contains("grid9")) {
        var btns = el.querySelectorAll("button");
        var paint = function () { btns.forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-v") === opts[k]); }); };
        btns.forEach(function (b) { b.addEventListener("click", function () { opts[k] = b.getAttribute("data-v"); paint(); save(); }); });
        paint();
      } else if (el.type === "checkbox") {
        el.checked = !!opts[k];
        el.addEventListener("change", function () { opts[k] = el.checked; save(); refresh(); });
      } else {
        el.value = opts[k];
        el.addEventListener("change", function () { opts[k] = el.type === "number" ? Math.max(0, parseInt(el.value, 10) || 0) : el.value; save(); });
      }
    });
    refresh();
  }
  function refresh() { var r = $("animRow"); if (r) r.classList.toggle("off", !opts.animateOn); }

  var toastTimer = null;
  function toast(msg, detail, isErr) {
    var t = $("toast");
    t.hidden = false; t.className = "toast" + (isErr ? " err" : "");
    t.textContent = msg;
    if (detail) { var s = document.createElement("small"); s.textContent = detail; t.appendChild(s); }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, isErr ? 12000 : 6000);
  }
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }
  function describe(res) {
    if (!res.ok) return toast(res.error || "Something went wrong", null, true);
    var s = res.stats || {}, parts = [], extra = [];
    if (s.layers) parts.push(plural(s.layers, "layer"));
    if (s.updated) parts.push(plural(s.updated, "layer") + " updated");
    if (s.rebuilt) parts.push(s.rebuilt + " rebuilt");
    if (s.shapes && !s.layers && !s.updated) parts.push(plural(s.shapes, "shape"));
    if (s.texts && !s.layers) parts.push(plural(s.texts, "text"));
    if (s.guides) parts.push(plural(s.guides, "guide"));
    if (s.palette) parts.push(plural(s.palette, "colour"));
    if (s.animated && !s.layers) parts.push(plural(s.animated, "layer") + " animated");
    if (s.gradients) extra.push(plural(s.gradients, "gradient"));
    if (s.parametric) extra.push(s.parametric + " parametric");
    if (s.images) extra.push(plural(s.images, "image"));
    if (s.animated && s.layers) extra.push(s.animated + " animated");
    if (s.still) extra.push(plural(s.still, "background") + " left still");
    if (s.animated && s.animStart) extra.push("entrance starts at " + s.animStart);
    var msg = parts.length ? parts.join(", ") : "Done";
    msg = msg.charAt(0).toUpperCase() + msg.slice(1);
    if (s.created && s.comp) msg += " in a new comp, " + s.comp;
    var detail = extra.join(", ");
    if (s.warnings && s.warnings.length) detail = (detail ? detail + ". " : "") + s.warnings.slice(0, 2).join(" ");
    toast(msg, detail, false);
  }
  function run(btn, fn, payload) {
    var b = btn ? $(btn) : null;
    if (b) { b.disabled = true; }
    return call(fn, payload).then(function (res) {
      if (b) { b.disabled = false; }
      describe(res); status();
      return res;
    });
  }

  // ---------- actions ----------
  function pushOpts(action) {
    return {
      action: action, split: opts.split, anchor: opts.anchor, parametric: !!opts.parametric, newComp: !!opts.newComp,
      place: opts.center ? "center" : "artboard", guides: !!opts.guides,
      animate: opts.animateOn ? opts.animate : "none",
      linkColors: !!opts.linkColors, link: !!opts.link, switchApp: true
    };
  }
  var actions = {
    push: function () { return run("btnPush", "aiPush", pushOpts("push")); },
    sync: function () { var o = pushOpts("sync"); o.animate = "none"; o.newComp = false; o.switchApp = false; o.guides = false; o.linkColors = false; return run("btnSync", "aiPush", o); },
    compOnly: function () { return run("btnComp", "aiPush", { action: "compOnly", switchApp: true }); },
    guides: function () { return run("btnGuides", "aiPush", { action: "guides" }); },
    palette: function () { return run("btnPalette", "aiPush", { action: "palette" }); },
    pull: function () { return run("btnPull", "aePull", { action: "pull", newArtboard: !!opts.aeNewArtboard, guides: !!opts.aeGuides }); },
    artboard: function () { return run("btnArtboard", "aePull", { action: "artboard" }); },
    aeGuides: function () { return run("btnAeGuides", "aePull", { action: "guides" }); },
    animate: function () { return run("btnAnimate", "aeAnimate", { animate: opts.aeAnimate }); },
    explode: function () { return run("btnExplode", "aeExplode"); },
    anchors: function () { return run("btnAnchors", "aeCenterAnchors"); }
  };
  var wiring = { btnPush: "push", btnSync: "sync", btnComp: "compOnly", btnGuides: "guides", btnPalette: "palette", btnPull: "pull", btnArtboard: "artboard", btnAeGuides: "aeGuides", btnAnimate: "animate", btnExplode: "explode", btnAnchors: "anchors" };

  function status() {
    call(isAI ? "aiInfo" : "aeInfo").then(function (r) {
      var el = $(isAI ? "status" : "statusAe"), t = "";
      if (r.ok) {
        if (isAI) t = !r.doc ? "No document open" : (r.selection ? plural(r.selection, "object") + " selected" : "Whole artboard: " + r.artboard);
        else t = !r.comp ? "No composition open" : (r.selection ? plural(r.selection, "layer") + " selected" : "Whole comp: " + r.comp);
      }
      if (isAI && r.ok && r.doc) t += opts.newComp ? ", into a new comp" : "";
      el.textContent = t;
    });
  }
  // The panel takes the host's own background so it reads as part of the app, in any UI brightness.
  function theme() {
    try {
      var c = JSON.parse(cep.getHostEnvironment()).appSkinInfo.panelBackgroundColor.color;
      var r = Math.round(c.red), g = Math.round(c.green), b = Math.round(c.blue);
      document.documentElement.style.setProperty("--bg", "rgb(" + r + "," + g + "," + b + ")");
      document.documentElement.classList.toggle("light", (r * 299 + g * 587 + b * 114) / 1000 > 140);
    } catch (e) {}
  }

  // ---------- updates: checked when the panel opens and every few hours, applied without asking ----------
  function nodeRequire() { return (typeof window.cep_node !== "undefined" && window.cep_node.require) || (typeof require !== "undefined" ? require : null); }
  function updates() {
    var req = nodeRequire(), ver = $("ver"), upd = $("upd");
    if (!req || !window.TraverseUpdater) return;
    var up = window.TraverseUpdater.create(req), loaded = up.currentVersion(extPath);
    ver.textContent = "Traverse " + loaded;
    try { var just = localStorage.getItem("traverse.updated"); if (just) { localStorage.removeItem("traverse.updated"); toast("Updated to version " + just, null, false); } } catch (e) {}
    function run() {
      up.update(extPath, function (err, r) {
        if (!r) return;
        if (r.state === "dev") upd.textContent = "development copy";
        else if (r.state === "off") upd.textContent = "";
        else if (r.state === "current") upd.textContent = "up to date";
        else if (r.state === "error") { upd.textContent = "update check failed"; upd.title = r.error || ""; }
        else if (r.state === "updated") { try { localStorage.setItem("traverse.updated", r.current); } catch (e) {} window.location.reload(); }
      });
    }
    try { run(); } catch (e) { upd.textContent = ""; }
    setInterval(function () { try { run(); } catch (e) {} }, 4 * 60 * 60 * 1000);
    // the other app's panel may have installed an update: pick it up
    setInterval(function () { if (up.cmp(up.currentVersion(extPath), loaded) > 0) window.location.reload(); }, 60 * 1000);
  }

  // ---------- developer hook: lets automated tests press the same buttons ----------
  function devHook() {
    var req = (typeof window.cep_node !== "undefined" && window.cep_node.require) || (typeof require !== "undefined" ? require : null);
    if (!req) return;
    var fs = req("fs"), os = req("os"), path = req("path");
    if (!fs.existsSync(path.join(os.homedir(), ".traverse-dev"))) return;
    var dir = path.join(os.tmpdir(), "traverse-dev"), last = "";
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    var born = Date.now(); // commands written before this panel loaded are stale
    var cmdFile = path.join(dir, "cmd_" + host + ".json"), resFile = path.join(dir, "res_" + host + ".json");
    try { fs.writeFileSync(path.join(dir, "alive_" + host + ".txt"), String(Date.now())); } catch (e) {}
    setInterval(function () {
      var raw; try { if (fs.statSync(cmdFile).mtimeMs < born) return; raw = fs.readFileSync(cmdFile, "utf8"); } catch (e) { return; }
      var cmd; try { cmd = JSON.parse(raw); } catch (e) { return; }
      if (!cmd.id || cmd.id === last) return;
      last = cmd.id;
      if (cmd.action === "reloadPanel") { try { fs.writeFileSync(resFile, JSON.stringify({ id: cmd.id, res: { ok: true } })); } catch (e) {} window.location.reload(); return; }
      // test options apply to this one command only: they must never leak into what the user set in the UI
      var keep = JSON.parse(JSON.stringify(opts));
      if (cmd.opts) { Object.keys(cmd.opts).forEach(function (k) { opts[k] = cmd.opts[k]; }); }
      var p = cmd.reload ? loadHost().then(function () { return { ok: true, reloaded: true }; }) : (actions[cmd.action] ? actions[cmd.action]() : Promise.resolve({ ok: false, error: "unknown action" }));
      Object.keys(keep).forEach(function (k) { opts[k] = keep[k]; });
      p.then(function (res) { try { fs.writeFileSync(resFile, JSON.stringify({ id: cmd.id, res: res })); } catch (e) {} });
    }, 600);
  }

  // ---------- boot ----------
  theme();
  try { cep.addEventListener("com.adobe.csxs.events.ThemeColorChanged", theme); } catch (e) {}
  $(isAI ? "ai" : "ae").hidden = false;
  bind();
  Object.keys(wiring).forEach(function (id) { var b = $(id); if (b) b.addEventListener("click", actions[wiring[id]]); });
  loadHost().then(function () { status(); devHook(); updates(); });
  setInterval(status, 2500);
})();
