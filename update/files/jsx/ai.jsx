// Traverse - Illustrator engine (export to the exchange format + import from it)
(function () {

    var R = function (n) { return Math.round(n * 1000) / 1000; };

    // ---------- colour ----------
    function rgbOf(c) {
        if (!c) return null;
        var t = c.typename, v;
        try {
            if (t === "RGBColor") return [c.red / 255, c.green / 255, c.blue / 255];
            if (t === "GrayColor") { v = 1 - c.gray / 100; return [v, v, v]; }
            if (t === "CMYKColor") {
                v = app.convertSampleColor(ImageColorSpace.CMYK, [c.cyan, c.magenta, c.yellow, c.black], ImageColorSpace.RGB, ColorConvertPurpose.defaultpurpose);
                return [v[0] / 255, v[1] / 255, v[2] / 255];
            }
            if (t === "LabColor") {
                v = app.convertSampleColor(ImageColorSpace.LAB, [c.l, c.a, c.b], ImageColorSpace.RGB, ColorConvertPurpose.defaultpurpose);
                return [v[0] / 255, v[1] / 255, v[2] / 255];
            }
            if (t === "SpotColor") {
                var base = rgbOf(c.spot.color), k = c.tint / 100;
                if (!base) return null;
                return [1 - (1 - base[0]) * k, 1 - (1 - base[1]) * k, 1 - (1 - base[2]) * k];
            }
        } catch (e) {}
        return null;
    }
    function round3(a) { return [R(a[0]), R(a[1]), R(a[2])]; }

    // ---------- geometry ----------
    var AB = [0, 0, 0, 0]; // active artboard rect (doc coords)
    function toArt(p) { return [R(p[0] - AB[0]), R(AB[1] - p[1])]; }
    function boundsArt(b) { return [R(b[0] - AB[0]), R(AB[1] - b[1]), R(b[2] - AB[0]), R(AB[1] - b[3])]; }

    function pathData(p) {
        var pts = [], pp = p.pathPoints, i, a, l, r;
        for (i = 0; i < pp.length; i++) {
            a = pp[i].anchor; l = pp[i].leftDirection; r = pp[i].rightDirection;
            pts.push([R(a[0] - AB[0]), R(AB[1] - a[1]), R(l[0] - a[0]), R(-(l[1] - a[1])), R(r[0] - a[0]), R(-(r[1] - a[1]))]);
        }
        return { closed: p.closed, pts: pts };
    }

    function paintOf(c, forItem) {
        if (!c) return null;
        var t = c.typename;
        if (t === "NoColor") return null;
        if (t === "GradientColor") {
            var g = c.gradient, stops = [], i, s, col;
            for (i = 0; i < g.gradientStops.length; i++) {
                s = g.gradientStops[i];
                col = rgbOf(s.color) || [0, 0, 0];
                stops.push({ pos: R(s.rampPoint / 100), mid: R(s.midPoint / 100), color: round3(col), opacity: R(s.opacity / 100) });
            }
            var radial = (g.type === GradientType.RADIAL);
            var o = c.origin, ang = c.angle * Math.PI / 180, len = c.length;
            var e = [o[0] + len * Math.cos(ang), o[1] + len * Math.sin(ang)];
            // the gradient keeps its own matrix when the object was transformed after the fill was applied
            try {
                var m = c.matrix;
                if (m && !(m.mValueA === 1 && m.mValueB === 0 && m.mValueC === 0 && m.mValueD === 1 && m.mValueTX === 0 && m.mValueTY === 0)) {
                    var ap = function (q) { return [m.mValueA * q[0] + m.mValueC * q[1] + m.mValueTX, m.mValueB * q[0] + m.mValueD * q[1] + m.mValueTY]; };
                    o = ap(o); e = ap(e);
                }
            } catch (em) {}
            var out = { type: "gradient", kind: radial ? "radial" : "linear", stops: stops, start: toArt(o), end: toArt(e) };
            if (radial) { out.hiliteLength = R(c.hiliteLength); out.hiliteAngle = R(c.hiliteAngle); }
            return out;
        }
        if (t === "PatternColor") return { type: "pattern" };
        var rgb = rgbOf(c);
        if (!rgb) return null;
        var res = { type: "solid", color: round3(rgb) };
        try { if (t === "SpotColor") res.swatch = c.spot.name; } catch (e2) {}
        return res;
    }

    function capName(c) { return c === StrokeCap.ROUNDENDCAP ? "round" : (c === StrokeCap.PROJECTINGENDCAP ? "square" : "butt"); }
    function joinName(j) { return j === StrokeJoin.ROUNDENDJOIN ? "round" : (j === StrokeJoin.BEVELENDJOIN ? "bevel" : "miter"); }

    function styleOf(p, node) {
        if (p.filled) { var f = paintOf(p.fillColor); if (f) node.fill = f; }
        if (p.stroked && p.strokeWidth > 0) {
            var s = paintOf(p.strokeColor);
            if (s) {
                node.stroke = { paint: s, width: R(p.strokeWidth), cap: capName(p.strokeCap), join: joinName(p.strokeJoin), miter: R(p.strokeMiterLimit) };
                var d = p.strokeDashes;
                if (d && d.length) { node.stroke.dashes = []; for (var i = 0; i < d.length; i++) node.stroke.dashes.push(R(d[i])); node.stroke.dashOffset = R(p.strokeDashOffset); }
            }
        }
    }

    function blendName(it) {
        try { var s = String(it.blendingMode).replace("BlendModes.", "").toLowerCase(); return s === "normal" ? null : s; } catch (e) { return null; }
    }
    function common(it, node, fallbackName) {
        node.name = it.name && it.name.length ? it.name : fallbackName;
        try { if (it.opacity < 100) node.opacity = R(it.opacity); } catch (e) {}
        var b = blendName(it); if (b) node.blend = b;
        try { node.bounds = boundsArt(it.geometricBounds); } catch (e2) {}
        return node;
    }

    // ---------- persistent ids (for Sync) ----------
    function getId(it, create) {
        try {
            var tags = it.tags, i;
            for (i = 0; i < tags.length; i++) if (tags[i].name === "trvId") return tags[i].value;
            if (create) { var t = tags.add(); t.name = "trvId"; t.value = TRV.uid(); return t.value; }
        } catch (e) {}
        return null;
    }

    // ---------- text ----------
    function justName(j) {
        if (j === Justification.CENTER) return "center";
        if (j === Justification.RIGHT) return "right";
        if (j === Justification.FULLJUSTIFY || j === Justification.FULLJUSTIFYLASTLINELEFT) return "justify";
        return "left";
    }
    function charStyle(ca) {
        var s = {};
        try { s.font = ca.textFont.name; s.family = ca.textFont.family; s.style = ca.textFont.style; } catch (e) {}
        try { s.size = R(ca.size); } catch (e1) {}
        try { var f = paintOf(ca.fillColor); if (f) { if (f.type === "gradient") f = { type: "solid", color: f.stops[0].color }; if (f.type === "solid") s.fill = f.color; } } catch (e2) {}
        try { var st = paintOf(ca.strokeColor); if (st && st.type === "solid" && ca.strokeWeight > 0) { s.stroke = st.color; s.strokeWidth = R(ca.strokeWeight); } } catch (e3) {}
        try { s.tracking = R(ca.tracking); } catch (e4) {}
        try { if (!ca.autoLeading) s.leading = R(ca.leading); } catch (e5) {}
        try { if (ca.baselineShift) s.baseline = R(ca.baselineShift); } catch (e6) {}
        try { if (ca.horizontalScale !== 100) s.hscale = R(ca.horizontalScale); if (ca.verticalScale !== 100) s.vscale = R(ca.verticalScale); } catch (e7) {}
        try {
            if (ca.capitalization === FontCapsOption.ALLCAPS) s.caps = "all";
            else if (ca.capitalization === FontCapsOption.SMALLCAPS) s.caps = "small";
        } catch (e8) {}
        return s;
    }
    function sameStyle(a, b) { return TRV.stringify(a) === TRV.stringify(b); }

    function textNode(tf) {
        var node = common(tf, { type: "text" }, "");
        var contents = tf.contents;
        node.text = contents;
        if (!node.name) node.name = contents.replace(/[\r\n]+/g, " ").substring(0, 40) || "Text";
        var runs = [], i, n = 0, cur = null, ch, st, len;
        try {
            var chars = tf.characters;
            for (i = 0; i < chars.length; i++) {
                ch = chars[i]; len = ch.contents.length || 1;
                st = charStyle(ch.characterAttributes);
                if (cur && sameStyle(cur.style, st)) { cur.end = n + len; }
                else { cur = { start: n, end: n + len, style: st }; runs.push(cur); }
                n += len;
            }
        } catch (e) { runs = []; }
        if (!runs.length || n !== contents.length) {
            runs = [{ start: 0, end: contents.length, style: charStyle(tf.textRange.characterAttributes) }];
        }
        node.runs = runs;
        try { node.justify = justName(tf.paragraphs[0].paragraphAttributes.justification); } catch (e2) { node.justify = "left"; }
        // transform
        var m = tf.matrix;
        var sx = Math.sqrt(m.mValueA * m.mValueA + m.mValueB * m.mValueB);
        var sy = Math.sqrt(m.mValueC * m.mValueC + m.mValueD * m.mValueD);
        var det = m.mValueA * m.mValueD - m.mValueB * m.mValueC;
        if (det < 0) sy = -sy;
        node.rotation = R(-Math.atan2(m.mValueB, m.mValueA) * 180 / Math.PI);
        node.scale = [R(sx * 100), R(sy * 100)];
        if (tf.kind === TextType.AREATEXT) {
            node.kind = "area";
            try {
                var tb = tf.textPath.geometricBounds;
                node.box = boundsArt(tb);
            } catch (e3) { node.box = node.bounds; }
            node.rotation = 0; node.scale = [100, 100];
        } else {
            node.kind = "point";
            try { node.anchor = toArt(tf.anchor); } catch (e4) { node.anchor = [node.bounds[0], node.bounds[3]]; }
        }
        return node;
    }

    // ---------- raster fallback ("nothing gets lost") ----------
    function rasterNode(it, ctx, label) {
        var node = common(it, { type: "image" }, label);
        try {
            var vb = it.visibleBounds;
            var w = Math.max(1, vb[2] - vb[0]), h = Math.max(1, vb[1] - vb[3]);
            var src = app.activeDocument;
            var tmp = app.documents.add(DocumentColorSpace.RGB, w, h);
            var dup = it.duplicate(tmp.layers[0], ElementPlacement.PLACEATBEGINNING);
            var ab = tmp.artboards[0].artboardRect, db = dup.visibleBounds;
            dup.translate(ab[0] - db[0], ab[1] - db[1]);
            var file = new File(TRV.tempDir() + "/img_" + TRV.stamp() + ".png");
            var o = new ImageCaptureOptions();
            o.resolution = 144; o.antiAliasing = true; o.transparency = true; o.matte = false;
            tmp.imageCapture(file, ab, o);
            tmp.close(SaveOptions.DONOTSAVECHANGES);
            src.activate();
            node.file = file.fsName; node.scaleFactor = 2;
            node.bounds = boundsArt(vb);
            ctx.rasterized++;
        } catch (e) { node.error = String(e); ctx.skipped++; }
        return node;
    }

    // ---------- item walker ----------
    function hasPattern(node) { return (node.fill && node.fill.type === "pattern") || (node.stroke && node.stroke.paint.type === "pattern"); }

    function exportItem(it, ctx) {
        var t = it.typename, node, i, kids, c;
        if (it.hidden) return null;
        if (t === "PathItem") {
            if (it.guides) { ctx.guideItems.push(it); return null; }
            if (it.pathPoints.length < 2 && !it.stroked) return null;
            node = common(it, { type: "path", paths: [pathData(it)] }, "Path");
            styleOf(it, node);
            if (hasPattern(node)) return rasterNode(it, ctx, node.name);
            if (!node.fill && !node.stroke && !it.clipping) return null;
            ctx.shapes++;
            return node;
        }
        if (t === "CompoundPathItem") {
            if (!it.pathItems.length) return null;
            node = common(it, { type: "path", paths: [] }, "Compound Path");
            for (i = 0; i < it.pathItems.length; i++) node.paths.push(pathData(it.pathItems[i]));
            styleOf(it.pathItems[0], node);
            try { if (it.pathItems[0].evenodd) node.evenodd = true; } catch (e) {}
            if (hasPattern(node)) return rasterNode(it, ctx, node.name);
            ctx.shapes++;
            return node;
        }
        if (t === "GroupItem") {
            node = common(it, { type: "group", children: [] }, "Group");
            kids = it.pageItems;
            var clipDone = false;
            for (i = 0; i < kids.length; i++) {
                c = kids[i];
                if (it.clipped && !clipDone) {
                    var isClip = false;
                    try { isClip = (c.typename === "PathItem" && c.clipping) || (c.typename === "CompoundPathItem" && c.pathItems.length && c.pathItems[0].clipping); } catch (e2) {}
                    if (isClip) {
                        node.clip = [];
                        if (c.typename === "PathItem") node.clip.push(pathData(c));
                        else for (var k = 0; k < c.pathItems.length; k++) node.clip.push(pathData(c.pathItems[k]));
                        try { node.bounds = boundsArt(c.geometricBounds); } catch (e3) {}
                        clipDone = true;
                        // a clipping path can also carry its own paint
                        var cn = { type: "path", name: "Clip Fill", paths: node.clip };
                        styleOf(c.typename === "PathItem" ? c : c.pathItems[0], cn);
                        if (cn.fill || cn.stroke) node._clipPaint = cn;
                        continue;
                    }
                }
                var ch = exportItem(c, ctx);
                if (ch) node.children.push(ch);
            }
            if (node._clipPaint) { node.children.push(node._clipPaint); delete node._clipPaint; }
            if (!node.children.length) return null;
            return node;
        }
        if (t === "TextFrame") { ctx.texts++; return textNode(it); }
        if (t === "SymbolItem" && ctx.opts.breakSymbols !== false) {
            // expand a throw-away copy so the artwork stays live in the document
            try {
                var d = it.duplicate();
                d.breakLink();
                var grp = app.activeDocument.selection && null;
                // after breakLink the duplicate becomes a group placed at the same stacking spot
                var parent = it.parent, found = null;
                for (i = 0; i < parent.pageItems.length; i++) { if (parent.pageItems[i] === it) { found = i > 0 ? parent.pageItems[i - 1] : null; break; } }
                if (found && found.typename === "GroupItem") {
                    node = exportItem(found, ctx);
                    if (node) node.name = it.name || ("Symbol " + it.symbol.name);
                    found.remove();
                    if (node) return node;
                } else if (found) { found.remove(); }
            } catch (e4) {}
        }
        // placed / raster / mesh / plugin / graph / anything exotic
        return rasterNode(it, ctx, t.replace("Item", ""));
    }

    function intersects(b, r) { return !(b[2] < r[0] || b[0] > r[2] || b[3] > r[1] || b[1] < r[3]); }

    function collectTop(doc, ctx) {
        var out = [], i, sel = doc.selection;
        if (sel && sel.length && sel.typename !== "TextRange") {
            for (i = 0; i < sel.length; i++) out.push(sel[i]);
            // drop items whose parent group is also selected
            ctx.fromSelection = true;
        } else {
            ctx.fromSelection = false;
            (function walkLayers(layers) {
                for (var l = 0; l < layers.length; l++) {
                    var ly = layers[l];
                    if (!ly.visible) continue;
                    for (var k = 0; k < ly.pageItems.length; k++) {
                        var it = ly.pageItems[k];
                        try { if (it.guides) { ctx.guideItems.push(it); continue; } } catch (e) {}
                        try { if (intersects(it.geometricBounds, AB)) out.push(it); } catch (e2) { out.push(it); }
                    }
                    if (ly.layers.length) walkLayers(ly.layers);
                }
            })(doc.layers);
        }
        // order: top-most first
        try {
            out.sort(function (a, b) { return b.absoluteZOrderPosition - a.absoluteZOrderPosition; });
        } catch (e3) {}
        return out;
    }

    function collectGuides(doc, ctx, data) {
        var g = [], i, it, b;
        (function walk(items) {
            for (var k = 0; k < items.length; k++) {
                var p = items[k];
                try { if (p.guides) ctx.guideItems.push(p); } catch (e) {}
            }
        })(doc.pathItems);
        var seen = {};
        for (i = 0; i < ctx.guideItems.length; i++) {
            it = ctx.guideItems[i];
            try {
                b = boundsArt(it.geometricBounds);
                var key, w = Math.abs(b[2] - b[0]), h = Math.abs(b[3] - b[1]);
                if (h < 0.01 && w > 1) { key = "h" + b[1]; if (!seen[key]) { seen[key] = 1; g.push({ o: "h", pos: b[1] }); } }
                else if (w < 0.01 && h > 1) { key = "v" + b[0]; if (!seen[key]) { seen[key] = 1; g.push({ o: "v", pos: b[0] }); } }
            } catch (e2) {}
        }
        data.guides = g;
    }

    // ---------- public: build the exchange document ----------
    TRV.aiExport = function (opts) {
        opts = opts || {};
        if (!app.documents.length) throw new Error("NO_DOC");
        var doc = app.activeDocument;
        var prevCS = app.coordinateSystem;
        app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
        var ctx = { opts: opts, shapes: 0, texts: 0, rasterized: 0, skipped: 0, guideItems: [] };
        var data;
        try {
            var abi = doc.artboards.getActiveArtboardIndex();
            var ab = doc.artboards[abi];
            AB = ab.artboardRect;
            data = {
                format: "traverse", version: 1, source: "ai",
                doc: { name: doc.name.replace(/\.[^.]+$/, ""), artboard: ab.name, width: R(AB[2] - AB[0]), height: R(AB[1] - AB[3]) },
                items: []
            };
            if (!opts.onlyMeta) {
                var top = collectTop(doc, ctx), i, n;
                for (i = 0; i < top.length; i++) {
                    n = exportItem(top[i], ctx);
                    if (n) {
                        if (opts.link) n.id = getId(top[i], true); else { var id0 = getId(top[i], false); if (id0) n.id = id0; }
                        data.items.push(n);
                    }
                }
            }
            if (opts.guides || opts.onlyGuides) collectGuides(doc, ctx, data);
            if (opts.swatches) data.swatches = TRV.aiSwatches(doc);
            data.stats = { shapes: ctx.shapes, texts: ctx.texts, rasterized: ctx.rasterized, skipped: ctx.skipped, fromSelection: ctx.fromSelection };
        } finally {
            app.coordinateSystem = prevCS;
        }
        return data;
    };

    TRV.aiSwatches = function (doc) {
        var out = [], i, s, rgb, sel = [];
        try { sel = doc.swatches.getSelected(); } catch (e) {}
        var list = sel && sel.length ? sel : doc.swatches;
        for (i = 0; i < list.length; i++) {
            s = list[i];
            try {
                if (s.name === "[None]" || s.name === "[Registration]" || s.name === "[Ninguna]" || s.name === "[Registro]") continue;
                if (s.color.typename === "GradientColor" || s.color.typename === "PatternColor" || s.color.typename === "NoColor") continue;
                rgb = rgbOf(s.color);
                if (rgb) out.push({ name: s.name, color: round3(rgb) });
            } catch (e2) {}
        }
        return out;
    };

    // ---------- public: panel entry points ----------
    // action: push | newComp | guides | palette | sync
    TRV.aiPush = function (optsJson) {
        try {
            var opts = typeof optsJson === "string" ? TRV.parse(optsJson) : (optsJson || {});
            if (!app.documents.length) return TRV.fail("Open a document in Illustrator first.");
            var action = opts.action || "push";
            if (action === "guides") { opts.onlyMeta = true; opts.onlyGuides = true; }
            if (action === "palette") { opts.onlyMeta = true; opts.swatches = true; }
            if (action === "compOnly") { opts.onlyMeta = true; opts.newComp = true; }
            if (action === "sync") { opts.link = true; }
            var data = TRV.aiExport(opts);
            data.opts = opts;
            if (action === "push" || action === "sync") {
                if (!data.items.length) return TRV.fail("Nothing to send: select artwork, or put artwork on the active artboard.");
            }
            if (action === "guides" && !data.guides.length) return TRV.fail("No straight guides found in this document.");
            if (action === "palette" && !data.swatches.length) return TRV.fail("No solid swatches found.");
            var path = TRV.tempDir() + "/push_" + TRV.stamp() + ".json";
            TRV.writeFile(path, TRV.stringify(data));
            if (opts.dryRun) return TRV.ok({ file: path, stats: data.stats });
            var res = TRV.sendTo("aftereffects", "TRV.aeReceive(" + TRV.stringify(path.replace(/\\/g, "/")) + ")", 180);
            if (!res.ok) {
                if (res.error === "NOT_RUNNING") return TRV.fail("After Effects is not running. Open it and try again.");
                return TRV.fail(res.error === "TIMEOUT" ? "After Effects did not answer. It may be busy or showing a dialog: check it and try again." : "After Effects did not answer: " + res.error);
            }
            if (opts.switchApp) TRV.bringToFront("aftereffects");
            return res.body; // already JSON from AE
        } catch (e) {
            return TRV.fail(e.message === "NO_DOC" ? "Open a document in Illustrator first." : (e.message + (e.line ? " (ai.jsx:" + e.line + ")" : "")));
        }
    };

    // =====================================================================
    //  IMPORT (After Effects -> Illustrator)
    // =====================================================================
    function rgbColor(c) { var k = new RGBColor(); k.red = c[0] * 255; k.green = c[1] * 255; k.blue = c[2] * 255; return k; }
    var OFF = [0, 0]; // artboard top-left in doc coords
    function toDoc(x, y) { return [OFF[0] + x, OFF[1] - y]; }

    function makeGradient(doc, p) {
        var g = doc.gradients.add(), i, st, n = p.stops.length;
        g.type = p.kind === "radial" ? GradientType.RADIAL : GradientType.LINEAR;
        while (g.gradientStops.length < n) g.gradientStops.add();
        // set from the last to the first so ramp points never cross
        for (i = n - 1; i >= 0; i--) {
            st = g.gradientStops[i];
            st.rampPoint = Math.max(0, Math.min(100, p.stops[i].pos * 100));
        }
        for (i = 0; i < n; i++) {
            st = g.gradientStops[i];
            st.rampPoint = Math.max(0, Math.min(100, p.stops[i].pos * 100));
            st.midPoint = Math.max(13, Math.min(87, (p.stops[i].mid === undefined ? 0.5 : p.stops[i].mid) * 100));
            st.color = rgbColor(p.stops[i].color);
            st.opacity = (p.stops[i].opacity === undefined ? 1 : p.stops[i].opacity) * 100;
        }
        return g;
    }
    function applyPaint(doc, item, paint, isStroke) {
        if (!paint) return;
        if (paint.type === "solid") {
            if (isStroke) item.strokeColor = rgbColor(paint.color); else item.fillColor = rgbColor(paint.color);
            return;
        }
        if (paint.type === "gradient") {
            var gc = new GradientColor();
            gc.gradient = makeGradient(doc, paint);
            var s = toDoc(paint.start[0], paint.start[1]), e = toDoc(paint.end[0], paint.end[1]);
            var dx = e[0] - s[0], dy = e[1] - s[1];
            gc.origin = s;
            gc.angle = Math.atan2(dy, dx) * 180 / Math.PI;
            gc.length = Math.sqrt(dx * dx + dy * dy);
            if (isStroke) item.strokeColor = gc; else item.fillColor = gc;
            // Illustrator ignores origin/angle/length on assignment; fix the geometry afterwards
            if (!isStroke) fixGradient(item, s, e);
        }
    }
    // Re-aim a freshly applied gradient so it runs from s to e (doc coords)
    function fixGradient(item, s, e) {
        try {
            var c = item.fillColor;
            var want = Math.atan2(e[1] - s[1], e[0] - s[0]) * 180 / Math.PI;
            var wantLen = Math.sqrt(Math.pow(e[0] - s[0], 2) + Math.pow(e[1] - s[1], 2));
            if (wantLen < 0.01) return;
            // rotate only the fill gradient
            var dAng = want - c.angle;
            if (Math.abs(dAng) > 0.01) item.rotate(dAng, false, false, true, false, Transformation.CENTER);
            c = item.fillColor;
            var k = wantLen / (c.length || 1);
            if (Math.abs(k - 1) > 0.001) item.resize(k * 100, k * 100, false, false, true, false, 100, Transformation.CENTER);
            c = item.fillColor;
            var o = c.origin;
            var tx = s[0] - o[0], ty = s[1] - o[1];
            if (Math.abs(tx) > 0.01 || Math.abs(ty) > 0.01) item.translate(tx, ty, false, false, true, false);
        } catch (err) {}
    }

    function addPath(container, pd) {
        var p = container.pathItems.add(), i, pt, q, a;
        for (i = 0; i < pd.pts.length; i++) {
            q = pd.pts[i];
            a = toDoc(q[0], q[1]);
            pt = p.pathPoints.add();
            pt.anchor = a;
            pt.leftDirection = [a[0] + q[2], a[1] - q[3]];
            pt.rightDirection = [a[0] + q[4], a[1] - q[5]];
            pt.pointType = (q[2] === 0 && q[3] === 0 && q[4] === 0 && q[5] === 0) ? PointType.CORNER : PointType.SMOOTH;
            if (pt.pointType === PointType.SMOOTH) {
                // keep corners with broken handles as corners
                var cross = q[2] * q[5] - q[3] * q[4];
                if (Math.abs(cross) > 0.01 * (Math.abs(q[2]) + Math.abs(q[3]) + 1) * (Math.abs(q[4]) + Math.abs(q[5]) + 1)) pt.pointType = PointType.CORNER;
            }
        }
        p.closed = !!pd.closed;
        return p;
    }
    function styleItem(doc, p, node) {
        if (node.fill) { p.filled = true; applyPaint(doc, p, node.fill, false); } else p.filled = false;
        if (node.stroke) {
            p.stroked = true;
            applyPaint(doc, p, node.stroke.paint, true);
            p.strokeWidth = node.stroke.width;
            p.strokeCap = node.stroke.cap === "round" ? StrokeCap.ROUNDENDCAP : (node.stroke.cap === "square" ? StrokeCap.PROJECTINGENDCAP : StrokeCap.BUTTENDCAP);
            p.strokeJoin = node.stroke.join === "round" ? StrokeJoin.ROUNDENDJOIN : (node.stroke.join === "bevel" ? StrokeJoin.BEVELENDJOIN : StrokeJoin.MITERENDJOIN);
            if (node.stroke.miter) p.strokeMiterLimit = node.stroke.miter;
            if (node.stroke.dashes && node.stroke.dashes.length) { p.strokeDashes = node.stroke.dashes; p.strokeDashOffset = node.stroke.dashOffset || 0; }
        } else p.stroked = false;
    }

    function findFont(name) {
        try { return app.textFonts.getByName(name); } catch (e) { return null; }
    }
    function importText(doc, container, node) {
        var tf;
        if (node.kind === "area" && node.box) {
            var b = node.box, tl = toDoc(b[0], b[1]);
            var rect = container.pathItems.rectangle(tl[1], tl[0], Math.max(1, b[2] - b[0]), Math.max(1, b[3] - b[1]));
            tf = container.textFrames.areaText(rect);
        } else {
            tf = container.textFrames.add();
        }
        tf.contents = node.text;
        var i, r, rng, ca, s, f;
        var just = node.justify === "center" ? Justification.CENTER : (node.justify === "right" ? Justification.RIGHT : (node.justify === "justify" ? Justification.FULLJUSTIFYLASTLINELEFT : Justification.LEFT));
        try { for (i = 0; i < tf.paragraphs.length; i++) tf.paragraphs[i].paragraphAttributes.justification = just; } catch (e) {}
        for (i = 0; i < node.runs.length; i++) {
            r = node.runs[i]; s = r.style;
            if (r.end <= r.start) continue;
            try {
                rng = tf.textRange;
                // narrow the range to this run
                var chars = tf.characters, a = Math.min(r.start, chars.length - 1), z = Math.min(r.end, chars.length) - 1;
                if (a < 0 || z < a) continue;
                for (var k = a; k <= z; k++) {
                    ca = chars[k].characterAttributes;
                    if (s.font) { f = findFont(s.font); if (f) ca.textFont = f; }
                    if (s.size) ca.size = s.size;
                    if (s.fill) ca.fillColor = rgbColor(s.fill); else if (s.noFill) ca.fillColor = new NoColor();
                    if (s.stroke && s.strokeWidth) { ca.strokeColor = rgbColor(s.stroke); ca.strokeWeight = s.strokeWidth; }
                    if (s.tracking !== undefined) ca.tracking = s.tracking;
                    if (s.leading) { ca.autoLeading = false; ca.leading = s.leading; }
                    if (s.baseline) ca.baselineShift = s.baseline;
                    if (s.hscale) ca.horizontalScale = s.hscale;
                    if (s.vscale) ca.verticalScale = s.vscale;
                    if (s.caps === "all") ca.capitalization = FontCapsOption.ALLCAPS;
                    else if (s.caps === "small") ca.capitalization = FontCapsOption.SMALLCAPS;
                }
            } catch (e2) {}
        }
        if (node.kind !== "area") {
            var p = toDoc(node.anchor[0], node.anchor[1]);
            // place: move so that the text anchor lands on p
            try {
                var an = tf.anchor;
                tf.translate(p[0] - an[0], p[1] - an[1]);
                var sx = node.scale ? node.scale[0] : 100, sy = node.scale ? node.scale[1] : 100;
                if (Math.abs(sx - 100) > 0.01 || Math.abs(sy - 100) > 0.01) {
                    tf.resize(sx, sy, true, true, true, true, sx, Transformation.DOCUMENTORIGIN);
                    an = tf.anchor; tf.translate(p[0] - an[0], p[1] - an[1]);
                }
                if (node.rotation) {
                    tf.rotate(-node.rotation, true, true, true, true, Transformation.DOCUMENTORIGIN);
                    an = tf.anchor; tf.translate(p[0] - an[0], p[1] - an[1]);
                }
            } catch (e3) {}
        }
        tf.name = node.name || "Text";
        if (node.opacity !== undefined) tf.opacity = node.opacity;
        return tf;
    }

    function importNode(doc, container, node, stats) {
        var it = null, i;
        if (node.type === "group") {
            it = container.groupItems.add();
            // children are listed top-first; add bottom-first so the stack matches
            for (i = node.children.length - 1; i >= 0; i--) {
                var ch = importNode(doc, it, node.children[i], stats);
                if (ch) { try { ch.move(it, ElementPlacement.PLACEATBEGINNING); } catch (e) {} }
            }
        } else if (node.type === "path") {
            if (node.paths.length === 1) {
                it = addPath(container, node.paths[0]);
                styleItem(doc, it, node);
            } else {
                it = container.compoundPathItems.add();
                for (i = 0; i < node.paths.length; i++) addPath(it, node.paths[i]);
                if (it.pathItems.length) {
                    styleItem(doc, it.pathItems[0], node);
                    if (node.evenodd) { try { for (i = 0; i < it.pathItems.length; i++) it.pathItems[i].evenodd = true; } catch (e2) {} }
                }
            }
            stats.shapes++;
        } else if (node.type === "text") {
            it = importText(doc, container, node);
            stats.texts++;
        } else if (node.type === "image" && node.file) {
            try {
                it = container.placedItems.add();
                it.file = new File(node.file);
                var b = node.bounds, tl = toDoc(b[0], b[1]);
                it.width = b[2] - b[0]; it.height = b[3] - b[1];
                it.position = tl;
                stats.images++;
            } catch (e3) { it = null; }
        }
        if (it) {
            try { if (node.name) it.name = node.name; } catch (e4) {}
            try { if (node.opacity !== undefined && node.type !== "text") it.opacity = node.opacity; } catch (e5) {}
            try { if (node.blend) it.blendingMode = BlendModes[node.blend.toUpperCase()]; } catch (e6) {}
        }
        return it;
    }

    // Called from After Effects through BridgeTalk
    TRV.aiReceive = function (path) {
        var prevCS = app.coordinateSystem, prevUI = app.userInteractionLevel;
        try {
            var data = TRV.parse(TRV.readFile(path));
            var opts = data.opts || {};
            app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
            var doc;
            var w = data.doc.width, h = data.doc.height;
            if (!app.documents.length || opts.newDoc) {
                doc = app.documents.add(DocumentColorSpace.RGB, w, h);
                try { doc.artboards[0].name = data.doc.name; } catch (e) {}
            } else {
                doc = app.activeDocument;
            }
            app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
            if (opts.newArtboard && !opts.newDoc && app.documents.length) {
                // append an artboard sized like the comp, to the right of the existing ones
                var maxR = -1e9, top = 0, i;
                for (i = 0; i < doc.artboards.length; i++) { var r = doc.artboards[i].artboardRect; if (r[2] > maxR) { maxR = r[2]; top = r[1]; } }
                var nab = doc.artboards.add([maxR + 100, top, maxR + 100 + w, top - h]);
                nab.name = data.doc.name;
                doc.artboards.setActiveArtboardIndex(doc.artboards.length - 1);
            }
            var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect;
            OFF = [ab[0], ab[1]];
            var stats = { shapes: 0, texts: 0, images: 0, guides: 0 };
            if (opts.clear) { try { doc.pageItems.removeAll(); } catch (e0) {} }
            var layer = null;
            if (data.items && data.items.length) {
                try { layer = doc.activeLayer; if (layer.locked || !layer.visible) layer = doc.layers.add(); } catch (e1) { layer = doc.layers.add(); }
                doc.selection = null;
                var made = [], n;
                for (n = data.items.length - 1; n >= 0; n--) {
                    var it = importNode(doc, layer, data.items[n], stats);
                    if (it) { try { it.move(layer, ElementPlacement.PLACEATBEGINNING); } catch (e2) {} made.push(it); }
                }
                try { for (n = 0; n < made.length; n++) made[n].selected = true; } catch (e3) {}
            }
            if (data.guides && data.guides.length) {
                var gl = layer || doc.activeLayer, g, p, k;
                for (k = 0; k < data.guides.length; k++) {
                    g = data.guides[k];
                    p = gl.pathItems.add();
                    if (g.o === "h") p.setEntirePath([toDoc(-2000, g.pos), toDoc(w + 2000, g.pos)]);
                    else p.setEntirePath([toDoc(g.pos, -2000), toDoc(g.pos, h + 2000)]);
                    p.guides = true; stats.guides++;
                }
            }
            app.redraw();
            return TRV.ok({ stats: stats, doc: doc.name });
        } catch (e) {
            return TRV.fail(e.message + (e.line ? " (ai.jsx:" + e.line + ")" : ""));
        } finally {
            app.coordinateSystem = prevCS;
            app.userInteractionLevel = prevUI;
        }
    };

    TRV.aiInfo = function () {
        try {
            if (!app.documents.length) return TRV.ok({ doc: null });
            var doc = app.activeDocument, sel = 0;
            try { sel = doc.selection ? doc.selection.length || 0 : 0; } catch (e) {}
            var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()];
            var r = ab.artboardRect;
            return TRV.ok({ doc: doc.name, artboard: ab.name, w: Math.round(r[2] - r[0]), h: Math.round(r[1] - r[3]), selection: sel });
        } catch (e2) { return TRV.fail(e2.message); }
    };
})();
