// Traverse - After Effects engine (build layers from the exchange format + export to it)
(function () {

    var PALETTE_NAME = "Traverse Palette";
    var ASSET_FOLDER = "Traverse Assets";

    function R(n) { return Math.round(n * 1000) / 1000; }
    // The comp the user is working in. app.project.activeItem is empty whenever the Project panel has
    // focus on something else, so fall back to the comp shown in the active viewer before giving up.
    function activeComp() {
        var it = app.project.activeItem;
        if (it && it instanceof CompItem) return it;
        try {
            var v = app.activeViewer;
            if (v && v.type === ViewerType.VIEWER_COMPOSITION) {
                v.setActive();
                it = app.project.activeItem;
                if (it && it instanceof CompItem) return it;
            }
        } catch (e) {}
        return null;
    }

    // =====================================================================
    //  Gradient skeletons (After Effects cannot script gradient colours,
    //  so gradient fills are born inside a generated .aepx and copied in)
    // =====================================================================
    function mn(name) {
        var hex = "", i;
        for (i = 0; i < 40; i++) {
            var c = i < name.length ? name.charCodeAt(i) : 0;
            var h = c.toString(16); if (h.length < 2) h = "0" + h; hex += h;
        }
        return '<tdmn bdata="' + hex + '"/>';
    }
    var GROUP_END = mn("ADBE Group End");
    function propXML(matchName, tdsb, name, inner) {
        return mn(matchName) + '<tdgp><tdsb bdata="' + tdsb + '"/><tdsn><string>' + name + '</string></tdsn>' + (inner || "") + GROUP_END + '</tdgp>';
    }
    function num(n) { var s = String(Math.round(n * 1000000) / 1000000); return s; }
    function gradStopsXML(stops) {
        var i, s, x = "<?xml version='1.0'?>\n<prop.map version='4'>\n<prop.list>\n<prop.pair>\n<key>Gradient Color Data</key>\n<prop.list>\n<prop.pair>\n<key>Alpha Stops</key>\n<prop.list>\n<prop.pair>\n<key>Stops List</key>\n<prop.list>\n";
        for (i = 0; i < stops.length; i++) {
            s = stops[i];
            x += "<prop.pair>\n<key>Stop-" + i + "</key>\n<prop.list>\n<prop.pair>\n<key>Stops Alpha</key>\n<array>\n<array.type><float/></array.type>\n<float>" + num(s.pos) + "</float>\n<float>" + num(s.mid === undefined ? 0.5 : s.mid) + "</float>\n<float>" + num(s.opacity === undefined ? 1 : s.opacity) + "</float>\n</array>\n</prop.pair>\n</prop.list>\n</prop.pair>\n";
        }
        x += "</prop.list>\n</prop.pair>\n<prop.pair>\n<key>Stops Size</key>\n<int type='unsigned' size='32'>" + stops.length + "</int>\n</prop.pair>\n</prop.list>\n</prop.pair>\n<prop.pair>\n<key>Color Stops</key>\n<prop.list>\n<prop.pair>\n<key>Stops List</key>\n<prop.list>\n";
        for (i = 0; i < stops.length; i++) {
            s = stops[i];
            x += "<prop.pair>\n<key>Stop-" + i + "</key>\n<prop.list>\n<prop.pair>\n<key>Stops Color</key>\n<array>\n<array.type><float/></array.type>\n<float>" + num(s.pos) + "</float>\n<float>" + num(s.mid === undefined ? 0.5 : s.mid) + "</float>\n<float>" + num(s.color[0]) + "</float>\n<float>" + num(s.color[1]) + "</float>\n<float>" + num(s.color[2]) + "</float>\n<float>1</float>\n</array>\n</prop.pair>\n</prop.list>\n</prop.pair>\n";
        }
        x += "</prop.list>\n</prop.pair>\n<prop.pair>\n<key>Stops Size</key>\n<int type='unsigned' size='32'>" + stops.length + "</int>\n</prop.pair>\n</prop.list>\n</prop.pair>\n</prop.list>\n</prop.pair>\n<prop.pair>\n<key>Gradient Colors</key>\n<string>1.0</string>\n</prop.pair>\n</prop.list>\n</prop.map>\n";
        return x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    function gradColorsXML(stops) {
        return mn("ADBE Vector Grad Colors") + '<GCst><tdbs><tdsb bdata="00000001"/><tdsn><string>-_0_/-</string></tdsn><tdb4 bdata="db99000100070000ffffffff000060003f1a36e2eb1c432d3ff00000000000003ff00000000000003ff00000000000003ff00000000000000001000800000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"/><cdat bdata="00000000"/></tdbs><GCky><string>' + gradStopsXML(stops) + '</string></GCky></GCst>';
    }
    function isGrad(p) { return p && p.type === "gradient"; }
    function nodeHasGradient(n) {
        if (n.type === "group") { for (var i = 0; i < n.children.length; i++) if (nodeHasGradient(n.children[i])) return true; return false; }
        if (n.type === "path") return isGrad(n.fill) || (n.stroke && isGrad(n.stroke.paint));
        return false;
    }
    function skeletonXML(node, ctx) {
        var inner = "", i;
        node._sk = "trv" + (ctx.n++);
        if (node.type === "group") {
            for (i = 0; i < node.children.length; i++) inner += skeletonXML(node.children[i], ctx);
        } else if (node.type === "path") {
            if (node.stroke && isGrad(node.stroke.paint)) {
                inner += propXML("ADBE Vector Graphic - G-Stroke", "00000001", node._sk + "s",
                    gradColorsXML(node.stroke.paint.stops) +
                    propXML("ADBE Vector Stroke Dashes", "00000001", "-_0_/-", "") +
                    propXML("ADBE Vector Stroke Taper", "00000001", "-_0_/-", "") +
                    propXML("ADBE Vector Stroke Wave", "00000001", "-_0_/-", ""));
            }
            if (isGrad(node.fill)) inner += propXML("ADBE Vector Graphic - G-Fill", "00000001", node._sk + "f", gradColorsXML(node.fill.stops));
        }
        return propXML("ADBE Vector Group", "00000001", node._sk,
            (inner ? propXML("ADBE Vectors Group", "00000401", "-_0_/-", inner) : "") +
            propXML("ADBE Vector Transform Group", "00000001", "-_0_/-", "") +
            propXML("ADBE Vector Materials Group", "00000001", "-_0_/-", ""));
    }
    function hex8(n) { var h = n.toString(16); while (h.length < 8) h = "0" + h; return h; }

    // Builds one .aepx holding a single skeleton layer; every gradient spec owns a range of its root groups
    function importSkeletons(specs) {
        var tplProject = TRV.readFile(TRV.root + "/assets/tpl_project.xml");
        var tplLayer = TRV.readFile(TRV.root + "/assets/tpl_layer.xml");
        var i, k, ctx = { n: 0 }, content = "", at = 1;
        for (i = 0; i < specs.length; i++) {
            specs[i]._skStart = at;
            for (k = 0; k < specs[i].nodes.length; k++) content += skeletonXML(specs[i].nodes[k], ctx);
            at += specs[i].nodes.length;
            specs[i]._skEnd = at - 1;
        }
        var layerXML = tplLayer.split("%%NAME%%").join("trvSkeleton").split("%%ID%%").join(hex8(1000)).split("%%CONTENT%%").join(content);
        var path = TRV.tempDir() + "/grad_" + TRV.stamp() + ".aepx";
        TRV.writeFile(path, tplProject.split("%%LAYERS%%").join(layerXML));
        // importFile's return value is not reliable for projects, so find what is new by item id
        var before = {}, fresh = [], comp = null;
        for (i = 1; i <= app.project.numItems; i++) before[app.project.item(i).id] = 1;
        app.project.importFile(new ImportOptions(new File(path)));
        for (i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (!before[it.id]) { fresh.push(it); if (it instanceof CompItem && !comp) comp = it; }
        }
        var folder = { remove: function () {
            var k2, pass;
            for (pass = 0; pass < 2; pass++) for (k2 = fresh.length - 1; k2 >= 0; k2--) {
                try { if ((pass === 0) === (fresh[k2] instanceof FolderItem)) fresh[k2].remove(); } catch (e) {}
            }
        } };
        try { new File(path).remove(); } catch (e) {}
        return { folder: folder, comp: comp, total: at - 1 };
    }
    // Copies the skeleton layer into the comp and keeps only the root groups of one spec
    function skeletonLayerFor(skel, spec, comp) {
        skel.comp.layer(1).copyToComp(comp);
        var layer = comp.layer(1), i;
        if (layer.name !== "trvSkeleton") { layer = null; for (i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === "trvSkeleton") { layer = comp.layer(i); break; } }
        if (!layer) throw new Error("skeleton copy failed");
        // the skeleton comes from a one-second template comp: stretch it over the whole target comp
        try { layer.startTime = 0; layer.inPoint = 0; layer.outPoint = comp.duration; } catch (e) {}
        for (i = skel.total; i >= 1; i--) {
            if (i < spec._skStart || i > spec._skEnd) layer.property("ADBE Root Vectors Group").property(i).remove();
        }
        return layer;
    }

    // =====================================================================
    //  Planner: decide which nodes become which layers
    // =====================================================================
    function unionBounds(a, b) {
        if (!a) return b ? [b[0], b[1], b[2], b[3]] : null;
        if (!b) return a;
        return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
    }
    function pathsBounds(paths) {
        var b = null, i, k, p;
        for (i = 0; i < paths.length; i++) for (k = 0; k < paths[i].pts.length; k++) { p = paths[i].pts[k]; b = unionBounds(b, [p[0], p[1], p[0], p[1]]); }
        return b;
    }
    function nodeBounds(n) {
        if (n.type === "path") return pathsBounds(n.paths) || n.bounds;
        if (n.type === "group" && !n.clip) { var b = null; for (var i = 0; i < n.children.length; i++) b = unionBounds(b, nodeBounds(n.children[i])); return b || n.bounds; }
        return n.bounds;
    }
    function isPureVector(n) {
        if (n.type === "path") return true;
        if (n.type === "group") {
            if (n.clip) return false;
            for (var i = 0; i < n.children.length; i++) if (!isPureVector(n.children[i])) return false;
            return true;
        }
        return false;
    }
    function plan(items, split) {
        var specs = [], merge = null;
        function flush() { merge = null; }
        function shapeSpec(nodes, name, id) { var s = { kind: "shape", nodes: nodes, name: name, id: id }; specs.push(s); return s; }
        function walk(list, prefix) {
            for (var i = 0; i < list.length; i++) {
                var n = list[i];
                if (n.type === "text") { flush(); specs.push({ kind: "text", node: n, name: n.name, id: n.id }); continue; }
                if (n.type === "image") { flush(); if (n.file) specs.push({ kind: "image", node: n, name: n.name, id: n.id }); continue; }
                if (n.type === "group" && n.clip) {
                    flush();
                    var vec = [], k, rest = [];
                    for (k = 0; k < n.children.length; k++) { if (isPureVector(n.children[k])) vec.push(n.children[k]); else rest.push(n.children[k]); }
                    if (rest.length) walk(rest, n.name + " / ");
                    if (vec.length) { var cs = shapeSpec(vec, n.name, n.id); cs.clip = n.clip; cs.opacity = n.opacity; }
                    flush();
                    continue;
                }
                if (n.type === "group" && !isPureVector(n)) { flush(); walk(n.children, ""); flush(); continue; }
                // pure vector
                if (split === "merge") {
                    if (!merge) merge = shapeSpec([], "Artwork", null);
                    merge.nodes.push(n);
                } else if (split === "all" && n.type === "group") {
                    walk(n.children, "");
                } else {
                    shapeSpec([n], n.name, n.id);
                }
            }
        }
        walk(items, "");
        for (var s = 0; s < specs.length; s++) {
            var sp = specs[s], b = null;
            if (sp.kind === "shape") {
                for (var q = 0; q < sp.nodes.length; q++) b = unionBounds(b, nodeBounds(sp.nodes[q]));
                sp.grad = false;
                for (q = 0; q < sp.nodes.length; q++) if (nodeHasGradient(sp.nodes[q])) { sp.grad = true; break; }
            } else b = sp.node.bounds;
            sp.bounds = b || [0, 0, 0, 0];
        }
        return specs;
    }

    // =====================================================================
    //  Parametric detection (rectangles, rounded rectangles, ellipses)
    // =====================================================================
    function dist(a, b) { return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1])); }
    function zeroT(p) { return Math.abs(p[2]) < 0.01 && Math.abs(p[3]) < 0.01 && Math.abs(p[4]) < 0.01 && Math.abs(p[5]) < 0.01; }
    function normAngle(deg) { while (deg > 45) deg -= 90; while (deg <= -45) deg += 90; return deg; }
    function detectParametric(pd) {
        var p = pd.pts, n = p.length, i;
        if (!pd.closed) return null;
        if (n === 4) {
            var allZero = true;
            for (i = 0; i < 4; i++) if (!zeroT(p[i])) { allZero = false; break; }
            var cx = (p[0][0] + p[1][0] + p[2][0] + p[3][0]) / 4, cy = (p[0][1] + p[1][1] + p[2][1] + p[3][1]) / 4;
            if (allZero) {
                var e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1]], e2 = [p[2][0] - p[1][0], p[2][1] - p[1][1]];
                var l1 = dist(p[0], p[1]), l2 = dist(p[1], p[2]);
                if (l1 < 0.01 || l2 < 0.01) return null;
                if (Math.abs(e1[0] * e2[0] + e1[1] * e2[1]) > 0.002 * l1 * l2) return null;
                if (Math.abs(dist(p[2], p[3]) - l1) > 0.02 || Math.abs(dist(p[3], p[0]) - l2) > 0.02) return null;
                var ang = Math.atan2(e1[1], e1[0]) * 180 / Math.PI, rot = normAngle(ang);
                var swap = Math.abs(Math.round((ang - rot) / 90)) % 2 === 1;
                return { kind: "rect", center: [cx, cy], size: swap ? [l2, l1] : [l1, l2], rotation: rot, round: 0 };
            }
            // ellipse: 4 points, symmetric handles perpendicular to the radius
            var r = [], K = 0.5523;
            for (i = 0; i < 4; i++) r.push(dist([p[i][0], p[i][1]], [cx, cy]));
            if (Math.abs(r[0] - r[2]) > 0.02 * (r[0] + 1) || Math.abs(r[1] - r[3]) > 0.02 * (r[1] + 1)) return null;
            for (i = 0; i < 4; i++) {
                var rv = [p[i][0] - cx, p[i][1] - cy], other = r[(i + 1) % 4];
                var tin = Math.sqrt(p[i][2] * p[i][2] + p[i][3] * p[i][3]), tout = Math.sqrt(p[i][4] * p[i][4] + p[i][5] * p[i][5]);
                if (Math.abs(tin - K * other) > 0.03 * other + 0.05 || Math.abs(tout - K * other) > 0.03 * other + 0.05) return null;
                if (Math.abs(rv[0] * p[i][4] + rv[1] * p[i][5]) > 0.01 * r[i] * tout + 0.01) return null;
                if (Math.abs(p[i][2] + p[i][4]) > 0.05 || Math.abs(p[i][3] + p[i][5]) > 0.05) return null;
            }
            var a0 = Math.atan2(p[0][1] - cy, p[0][0] - cx) * 180 / Math.PI, rot2 = normAngle(a0);
            var sw = Math.abs(Math.round((a0 - rot2) / 90)) % 2 === 1;
            return { kind: "ellipse", center: [cx, cy], size: sw ? [r[1] * 2, r[0] * 2] : [r[0] * 2, r[1] * 2], rotation: rot2 };
        }
        if (n === 8) {
            // rounded rectangle: 4 straight edges + 4 corner arcs
            var straight = [];
            for (i = 0; i < 8; i++) {
                var a = p[i], b = p[(i + 1) % 8];
                if (Math.abs(a[4]) < 0.01 && Math.abs(a[5]) < 0.01 && Math.abs(b[2]) < 0.01 && Math.abs(b[3]) < 0.01) straight.push(i);
            }
            if (straight.length !== 4) return null;
            if ((straight[1] - straight[0]) !== 2 || (straight[2] - straight[1]) !== 2 || (straight[3] - straight[2]) !== 2) return null;
            var s0 = straight[0], A = p[s0], B = p[(s0 + 1) % 8];
            var ux = B[0] - A[0], uy = B[1] - A[1], ul = Math.sqrt(ux * ux + uy * uy);
            if (ul < 0.01) return null;
            ux /= ul; uy /= ul;
            var vx = -uy, vy = ux, minU = 1e9, maxU = -1e9, minV = 1e9, maxV = -1e9, pu, pv;
            for (i = 0; i < 8; i++) {
                pu = p[i][0] * ux + p[i][1] * uy; pv = p[i][0] * vx + p[i][1] * vy;
                if (pu < minU) minU = pu; if (pu > maxU) maxU = pu; if (pv < minV) minV = pv; if (pv > maxV) maxV = pv;
            }
            var W = maxU - minU, H = maxV - minV, rad = (W - ul) / 2;
            if (rad <= 0.01) return null;
            var C = p[(s0 + 2) % 8], D = p[(s0 + 3) % 8], vl = dist(C, D);
            if (Math.abs((H - vl) / 2 - rad) > 0.03 * rad + 0.05) return null;
            // corner handle length must match a circular arc
            var hl = Math.sqrt(B[4] * B[4] + B[5] * B[5]);
            if (Math.abs(hl - 0.5523 * rad) > 0.06 * rad + 0.05) return null;
            var mu = (minU + maxU) / 2, mv = (minV + maxV) / 2;
            var ang8 = Math.atan2(uy, ux) * 180 / Math.PI, rot8 = normAngle(ang8);
            var sw8 = Math.abs(Math.round((ang8 - rot8) / 90)) % 2 === 1;
            return { kind: "rect", center: [mu * ux + mv * vx, mu * uy + mv * vy], size: sw8 ? [H, W] : [W, H], rotation: rot8, round: rad };
        }
        return null;
    }

    // =====================================================================
    //  Shape layer builder
    // =====================================================================
    var BLEND_SHAPE = { normal: 1, darken: 3, multiply: 4, colorburn: 5, lighten: 9, screen: 10, colordodge: 11, overlay: 15, softlight: 16, hardlight: 17, difference: 23, exclusion: 24, hue: 26, saturationblend: 27, colorblend: 28, luminosity: 29 };
    function layerBlend(name) {
        var m = { multiply: BlendingMode.MULTIPLY, darken: BlendingMode.DARKEN, colorburn: BlendingMode.COLOR_BURN, lighten: BlendingMode.LIGHTEN, screen: BlendingMode.SCREEN, colordodge: BlendingMode.COLOR_DODGE, overlay: BlendingMode.OVERLAY, softlight: BlendingMode.SOFT_LIGHT, hardlight: BlendingMode.HARD_LIGHT, difference: BlendingMode.DIFFERENCE, exclusion: BlendingMode.EXCLUSION, hue: BlendingMode.HUE, saturationblend: BlendingMode.SATURATION, colorblend: BlendingMode.COLOR, luminosity: BlendingMode.LUMINOSITY };
        return m[name] || null;
    }
    function contentsAt(layer, path) {
        var c = layer.property("ADBE Root Vectors Group"), i;
        for (i = 0; i < path.length; i++) c = c.property(path[i]).property("ADBE Vectors Group");
        return c;
    }
    function makeShape(pd, ox, oy) {
        var s = new Shape(), v = [], it = [], ot = [], i, q;
        for (i = 0; i < pd.pts.length; i++) {
            q = pd.pts[i];
            v.push([q[0] - ox, q[1] - oy]); it.push([q[2], q[3]]); ot.push([q[4], q[5]]);
        }
        s.vertices = v; s.inTangents = it; s.outTangents = ot; s.closed = !!pd.closed;
        return s;
    }
    function rgba(c) { return [c[0], c[1], c[2], 1]; }
    function capVal(c) { return c === "round" ? 2 : (c === "square" ? 3 : 1); }
    function joinVal(j) { return j === "round" ? 2 : (j === "bevel" ? 3 : 1); }

    function linkColor(prop, color, ctx) {
        if (!ctx.palette) return;
        var name = ctx.palette.names[TRV.hex(color)];
        if (!name) return;
        try { prop.expression = 'thisComp.layer("' + PALETTE_NAME + '").effect("' + name.replace(/"/g, '\\"') + '")("ADBE Color Control-0001")'; } catch (e) {}
    }
    function setStrokeCommon(st, s) {
        st.property("ADBE Vector Stroke Width").setValue(s.width);
        st.property("ADBE Vector Stroke Line Cap").setValue(capVal(s.cap));
        st.property("ADBE Vector Stroke Line Join").setValue(joinVal(s.join));
        if (s.join !== "round" && s.join !== "bevel" && s.miter) { try { st.property("ADBE Vector Stroke Miter Limit").setValue(s.miter); } catch (e) {} }
    }
    function setDashes(getStroke, s) {
        if (!s.dashes || !s.dashes.length) return;
        var names = ["ADBE Vector Stroke Dash 1", "ADBE Vector Stroke Gap 1", "ADBE Vector Stroke Dash 2", "ADBE Vector Stroke Gap 2", "ADBE Vector Stroke Dash 3", "ADBE Vector Stroke Gap 3"], i;
        for (i = 0; i < s.dashes.length && i < 6; i++) {
            try { getStroke().property("ADBE Vector Stroke Dashes").addProperty(names[i]).setValue(s.dashes[i]); } catch (e) {}
        }
        if (s.dashOffset) { try { getStroke().property("ADBE Vector Stroke Dashes").addProperty("ADBE Vector Stroke Offset").setValue(s.dashOffset); } catch (e2) {} }
    }
    function setGradientGeometry(g, paint, toLocal) {
        g.property("ADBE Vector Grad Type").setValue(paint.kind === "radial" ? 2 : 1);
        g.property("ADBE Vector Grad Start Pt").setValue(toLocal(paint.start));
        g.property("ADBE Vector Grad End Pt").setValue(toLocal(paint.end));
        if (paint.kind === "radial" && paint.hiliteLength) {
            try {
                var len = dist(paint.start, paint.end) || 1;
                g.property("ADBE Vector Grad HiLite Length").setValue(Math.max(-100, Math.min(100, paint.hiliteLength / len * 100)));
                g.property("ADBE Vector Grad HiLite Angle").setValue(-(paint.hiliteAngle || 0));
            } catch (e) {}
        }
    }

    function buildNode(layer, parentPath, idx, node, ctx) {
        var C = contentsAt(layer, parentPath), g;
        if (node._sk) g = C.property(node._sk); else g = C.addProperty("ADBE Vector Group");
        g.name = node.name || (node.type === "group" ? "Group" : "Path");
        var myPath = parentPath.concat([idx]);
        function G() { return contentsAt(layer, parentPath).property(idx); }
        function GC() { return contentsAt(layer, myPath); }
        if (node.opacity !== undefined) G().property("ADBE Vector Transform Group").property("ADBE Vector Group Opacity").setValue(node.opacity);
        if (node.blend && BLEND_SHAPE[node.blend]) { try { G().property("ADBE Vector Blend Mode").setValue(BLEND_SHAPE[node.blend]); } catch (e) {} }

        if (node.type === "group") {
            for (var i = 0; i < node.children.length; i++) buildNode(layer, myPath, i + 1, node.children[i], ctx);
            return;
        }
        // ----- leaf: paths + stroke + fill
        var ox = ctx.origin[0], oy = ctx.origin[1], nP = 0, k, sh;
        var toLocal = function (p) { return [p[0] - ox, p[1] - oy]; };
        var par = (ctx.opts.parametric !== false && node.paths.length === 1) ? detectParametric(node.paths[0]) : null;
        if (par) {
            var tg = G().property("ADBE Vector Transform Group");
            tg.property("ADBE Vector Position").setValue([par.center[0] - ox, par.center[1] - oy]);
            if (Math.abs(par.rotation) > 0.001) tg.property("ADBE Vector Rotation").setValue(par.rotation);
            var cs = Math.cos(-par.rotation * Math.PI / 180), sn = Math.sin(-par.rotation * Math.PI / 180);
            toLocal = function (p) { var dx = p[0] - par.center[0], dy = p[1] - par.center[1]; return [dx * cs - dy * sn, dx * sn + dy * cs]; };
            if (par.kind === "rect") {
                sh = GC().addProperty("ADBE Vector Shape - Rect");
                sh.property("ADBE Vector Rect Size").setValue(par.size);
                if (par.round) sh.property("ADBE Vector Rect Roundness").setValue(par.round);
            } else {
                sh = GC().addProperty("ADBE Vector Shape - Ellipse");
                sh.property("ADBE Vector Ellipse Size").setValue(par.size);
            }
            nP = 1;
            if (sh.propertyIndex !== 1) sh.moveTo(1);
            ctx.stats.parametric++;
        } else {
            for (k = 0; k < node.paths.length; k++) {
                sh = GC().addProperty("ADBE Vector Shape - Group");
                sh.property("ADBE Vector Shape").setValue(makeShape(node.paths[k], ox, oy));
                nP++;
                if (sh.propertyIndex !== nP) sh.moveTo(nP);
            }
        }
        ctx.stats.shapes++;
        if (node.stroke) {
            var s = node.stroke, st;
            if (isGrad(s.paint) && node._sk) {
                st = GC().property(node._sk + "s");
                if (st) {
                    st.name = "Gradient Stroke";
                    setGradientGeometry(st, s.paint, toLocal);
                    setStrokeCommon(st, s);
                    var sIdx = st.propertyIndex;
                    setDashes(function () { return GC().property(sIdx); }, s);
                    ctx.stats.gradients++;
                }
            } else {
                var col = isGrad(s.paint) ? s.paint.stops[0].color : s.paint.color;
                st = GC().addProperty("ADBE Vector Graphic - Stroke");
                st.property("ADBE Vector Stroke Color").setValue(rgba(col));
                linkColor(st.property("ADBE Vector Stroke Color"), col, ctx);
                setStrokeCommon(st, s);
                if (st.propertyIndex !== nP + 1) st.moveTo(nP + 1);
                setDashes(function () { return GC().property(nP + 1); }, s);
            }
        }
        if (node.fill) {
            var f;
            if (isGrad(node.fill) && node._sk) {
                f = GC().property(node._sk + "f");
                if (f) {
                    f.name = "Gradient Fill";
                    setGradientGeometry(f, node.fill, toLocal);
                    if (node.evenodd) f.property("ADBE Vector Fill Rule").setValue(2);
                    ctx.stats.gradients++;
                }
            } else {
                var fc = isGrad(node.fill) ? node.fill.stops[0].color : node.fill.color;
                f = GC().addProperty("ADBE Vector Graphic - Fill");
                f.property("ADBE Vector Fill Color").setValue(rgba(fc));
                linkColor(f.property("ADBE Vector Fill Color"), fc, ctx);
                if (node.evenodd) f.property("ADBE Vector Fill Rule").setValue(2);
            }
        }
    }

    function anchorFor(b, mode, comp) {
        var cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
        switch (mode) {
            case "comp": return null;
            case "tl": return [b[0], b[1]]; case "tc": return [cx, b[1]]; case "tr": return [b[2], b[1]];
            case "ml": return [b[0], cy]; case "mr": return [b[2], cy];
            case "bl": return [b[0], b[3]]; case "bc": return [cx, b[3]]; case "br": return [b[2], b[3]];
        }
        return [cx, cy];
    }

    function buildShapeLayer(comp, spec, ctx, layer) {
        if (!layer) layer = comp.layers.addShape();
        layer.name = spec.name || "Shape";
        var a = anchorFor(spec.bounds, ctx.opts.anchor, comp);
        var origin = a ? a : [comp.width / 2 - ctx.off[0], comp.height / 2 - ctx.off[1]];
        ctx.origin = origin;
        var tr = layer.property("ADBE Transform Group");
        tr.property("ADBE Anchor Point").setValue([0, 0]);
        tr.property("ADBE Position").setValue([origin[0] + ctx.off[0], origin[1] + ctx.off[1]]);
        for (var i = 0; i < spec.nodes.length; i++) buildNode(layer, [], i + 1, spec.nodes[i], ctx);
        if (spec.clip) {
            for (var k = 0; k < spec.clip.length; k++) {
                var m = layer.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
                m.property("ADBE Mask Shape").setValue(makeShape(spec.clip[k], origin[0], origin[1]));
                m.name = "Clip";
            }
        }
        if (spec.opacity !== undefined) tr.property("ADBE Opacity").setValue(spec.opacity);
        // a single top-level node can carry its blend mode on the layer itself
        if (spec.nodes.length === 1 && spec.nodes[0].blend) { var bm = layerBlend(spec.nodes[0].blend); if (bm) { try { layer.blendingMode = bm; contentsAt(layer, []).property(1).property("ADBE Vector Blend Mode").setValue(1); } catch (e) {} } }
        layer.comment = "trv:" + (spec.id || "") + ";" + R(origin[0]) + ";" + R(origin[1]);
        return layer;
    }

    // =====================================================================
    //  Text layer builder
    // =====================================================================
    function setStyle(o, s, whole) {
        try { if (s.font) o.font = s.font; } catch (e) {}
        try { if (s.size) o.fontSize = s.size; } catch (e1) {}
        try { if (s.fill) { o.applyFill = true; o.fillColor = s.fill; } else if (whole) { o.applyFill = false; } } catch (e2) {}
        try { if (s.stroke && s.strokeWidth) { o.applyStroke = true; o.strokeColor = s.stroke; o.strokeWidth = s.strokeWidth; } else if (whole) { o.applyStroke = false; } } catch (e3) {}
        try { if (s.tracking !== undefined) o.tracking = s.tracking; } catch (e4) {}
        try { if (s.leading) o.leading = s.leading; else o.autoLeading = true; /* write only: reading autoLeading on a mixed document raises an uncatchable AE error */ } catch (e5) {}
        try { if (s.baseline) o.baselineShift = s.baseline; } catch (e6) {}
        try { if (s.hscale) o.horizontalScale = s.hscale / 100; if (s.vscale) o.verticalScale = s.vscale / 100; } catch (e7) {}
        try { if (s.caps === "all") o.allCaps = true; else if (s.caps === "small") o.smallCaps = true; } catch (e8) {}
    }
    function justVal(j) {
        if (j === "center") return ParagraphJustification.CENTER_JUSTIFY;
        if (j === "right") return ParagraphJustification.RIGHT_JUSTIFY;
        if (j === "justify") return ParagraphJustification.FULL_JUSTIFY_LASTLINE_LEFT;
        return ParagraphJustification.LEFT_JUSTIFY;
    }
    function applyTextDoc(layer, node, ctx) {
        var prop = layer.property("ADBE Text Properties").property("ADBE Text Document");
        var td = prop.value, i, r;
        try { td.resetCharStyle(); } catch (e) {}
        td.text = node.text;
        setStyle(td, node.runs[0].style, true);
        try { td.justification = justVal(node.justify); } catch (e2) {}
        prop.setValue(td);
        if (node.runs.length > 1) {
            td = prop.value;
            if (typeof td.characterRange === "function") {
                for (i = 0; i < node.runs.length; i++) {
                    r = node.runs[i];
                    if (r.end <= r.start) continue;
                    try { setStyle(td.characterRange(r.start, r.end), r.style, false); } catch (e3) { ctx.stats.warnings.push("Text style range failed: " + e3.message); }
                }
                prop.setValue(td);
                ctx.stats.styledRuns += node.runs.length;
            } else {
                ctx.stats.warnings.push("Mixed text styles need After Effects 24.3 or newer; used the first style.");
            }
        }
        return prop;
    }
    function centerAnchor(layer, time) {
        try {
            var r = layer.sourceRectAtTime(time || 0, false);
            var tr = layer.property("ADBE Transform Group");
            var a = tr.property("ADBE Anchor Point").value, p = tr.property("ADBE Position").value, s = tr.property("ADBE Scale").value;
            var rot = tr.property("ADBE Rotate Z").value * Math.PI / 180;
            var na = [r.left + r.width / 2, r.top + r.height / 2];
            var dx = (na[0] - a[0]) * s[0] / 100, dy = (na[1] - a[1]) * s[1] / 100;
            tr.property("ADBE Anchor Point").setValue([na[0], na[1]]);
            tr.property("ADBE Position").setValue([p[0] + dx * Math.cos(rot) - dy * Math.sin(rot), p[1] + dx * Math.sin(rot) + dy * Math.cos(rot)]);
        } catch (e) {}
    }
    function buildTextLayer(comp, spec, ctx) {
        var node = spec.node, layer, tr;
        if (node.kind === "area" && node.box) {
            var w = Math.max(1, node.box[2] - node.box[0]), h = Math.max(1, node.box[3] - node.box[1]);
            layer = comp.layers.addBoxText([w, h], node.text);
            var prop = applyTextDoc(layer, node, ctx);
            var td = prop.value;
            try { td.boxTextSize = [w, h]; prop.setValue(td); td = prop.value; } catch (e) {}
            var bp = [-w / 2, -h / 2];
            try { bp = td.boxTextPos; } catch (e2) {}
            tr = layer.property("ADBE Transform Group");
            tr.property("ADBE Position").setValue([node.box[0] + ctx.off[0] - bp[0], node.box[1] + ctx.off[1] - bp[1]]);
        } else {
            layer = comp.layers.addText(node.text);
            applyTextDoc(layer, node, ctx);
            tr = layer.property("ADBE Transform Group");
            tr.property("ADBE Position").setValue([node.anchor[0] + ctx.off[0], node.anchor[1] + ctx.off[1]]);
            if (node.rotation) tr.property("ADBE Rotate Z").setValue(node.rotation);
            if (node.scale && (Math.abs(node.scale[0] - 100) > 0.01 || Math.abs(node.scale[1] - 100) > 0.01)) tr.property("ADBE Scale").setValue([node.scale[0], node.scale[1]]);
        }
        layer.name = spec.name || "Text";
        if (node.opacity !== undefined) tr.property("ADBE Opacity").setValue(node.opacity);
        if (node.blend) { var bm = layerBlend(node.blend); if (bm) layer.blendingMode = bm; }
        if (ctx.opts.anchor !== "comp" && ctx.opts.textAnchor !== "baseline") centerAnchor(layer, comp.time);
        layer.comment = "trv:" + (spec.id || "") + ";0;0";
        ctx.stats.texts++;
        return layer;
    }

    function assetFolder() {
        for (var i = 1; i <= app.project.numItems; i++) { var it = app.project.item(i); if (it instanceof FolderItem && it.name === ASSET_FOLDER) return it; }
        return app.project.items.addFolder(ASSET_FOLDER);
    }
    function buildImageLayer(comp, spec, ctx) {
        var node = spec.node, f = new File(node.file);
        if (!f.exists) return null;
        // keep the image next to the project when it is saved, otherwise in the temp folder
        try {
            if (app.project.file) {
                var dir = new Folder(app.project.file.parent.fsName + "/Traverse");
                if (!dir.exists) dir.create();
                var dest = new File(dir.fsName + "/" + (spec.name || "image").replace(/[^A-Za-z0-9_\- ]/g, "_") + "_" + TRV.stamp() + ".png");
                if (f.copy(dest)) f = dest;
            }
        } catch (e) {}
        var foot = app.project.importFile(new ImportOptions(f));
        foot.parentFolder = assetFolder();
        foot.name = (spec.name || "Image") + ".png";
        var layer = comp.layers.add(foot);
        var sc = 100 / (node.scaleFactor || 1), b = node.bounds, tr = layer.property("ADBE Transform Group");
        tr.property("ADBE Scale").setValue([sc, sc]);
        tr.property("ADBE Position").setValue([(b[0] + b[2]) / 2 + ctx.off[0], (b[1] + b[3]) / 2 + ctx.off[1]]);
        if (node.opacity !== undefined) tr.property("ADBE Opacity").setValue(node.opacity);
        layer.name = spec.name || "Image";
        layer.comment = "trv:" + (spec.id || "") + ";0;0";
        ctx.stats.images++;
        return layer;
    }

    // =====================================================================
    //  Extras: guides, palette, auto-animate
    // =====================================================================
    function addGuides(comp, guides, off) {
        var n = 0, i;
        if (!guides || typeof comp.addGuide !== "function") return 0;
        for (i = 0; i < guides.length; i++) {
            try { comp.addGuide(guides[i].o === "h" ? 0 : 1, guides[i].pos + (guides[i].o === "h" ? off[1] : off[0])); n++; } catch (e) {}
        }
        return n;
    }
    function findLayer(comp, name) { try { return comp.layer(name); } catch (e) { return null; } }
    // colors: [{name, color}] ; returns {layer, names:{HEX:name}}
    function ensurePalette(comp, colors) {
        var layer = findLayer(comp, PALETTE_NAME), i, names = {}, fx, existing = {};
        if (!layer) {
            layer = comp.layers.addNull();
            layer.name = PALETTE_NAME;
            layer.guideLayer = true; layer.enabled = false; layer.label = 14;
            try { layer.source.name = PALETTE_NAME; } catch (e) {}
        }
        fx = layer.property("ADBE Effect Parade");
        for (i = 1; i <= fx.numProperties; i++) {
            try { var c = fx.property(i).property("ADBE Color Control-0001").value; existing[fx.property(i).name] = 1; names[TRV.hex(c)] = fx.property(i).name; } catch (e2) {}
        }
        for (i = 0; i < colors.length; i++) {
            var hex = TRV.hex(colors[i].color);
            if (names[hex]) continue;
            var nm = colors[i].name || ("#" + hex), base = nm, k = 2;
            while (existing[nm]) { nm = base + " " + (k++); }
            var e = layer.property("ADBE Effect Parade").addProperty("ADBE Color Control");
            e.name = nm;
            e.property("ADBE Color Control-0001").setValue(rgba(colors[i].color));
            existing[nm] = 1; names[hex] = nm;
        }
        return { layer: layer, names: names };
    }
    function collectColors(items, out, seen) {
        for (var i = 0; i < items.length; i++) {
            var n = items[i];
            if (n.type === "group") collectColors(n.children, out, seen);
            else if (n.type === "path") {
                var list = [n.fill, n.stroke ? n.stroke.paint : null];
                for (var k = 0; k < 2; k++) {
                    var p = list[k];
                    if (p && p.type === "solid") { var h = TRV.hex(p.color); if (!seen[h]) { seen[h] = 1; out.push({ name: p.swatch || null, color: p.color }); } }
                }
            }
        }
    }

    function easeKeys(prop, influence) {
        try {
            var dims = 1, v = prop.value;
            if (prop.propertyValueType === PropertyValueType.ThreeD || prop.propertyValueType === PropertyValueType.TwoD) dims = v.length;
            if (prop.isSpatial) dims = 1;
            var e = [], i, k;
            for (i = 0; i < dims; i++) e.push(new KeyframeEase(0, influence || 70));
            for (k = 1; k <= prop.numKeys; k++) { prop.setTemporalEaseAtKey(k, e, e); }
        } catch (err) {}
    }

    // ---------------------------------------------------------------------
    //  Auto-animate: looks at what each layer is and picks the move for it.
    //  A style only changes the character (timing, distance, overshoot).
    // ---------------------------------------------------------------------
    // dur/fade in frames at 30 fps (scaled to the comp's frame rate); infl is the ease influence used on
    // BOTH sides of every keyframe, so each move starts slowly and settles slowly
    var STYLES = {
        smooth: { dur: 32, dist: 48, over: 0, infl: 60, fade: 20, word: 5 },
        bouncy: { dur: 28, dist: 64, over: 0.12, infl: 58, fade: 14, word: 5 },
        snappy: { dur: 18, dist: 96, over: 0, infl: 68, fade: 10, word: 3 },
        soft: { dur: 40, dist: 0, over: 0, infl: 55, fade: 36, word: 6, scaleFrom: 94 }
    };
    function shapePaint(group, res) {
        for (var i = 1; i <= group.numProperties; i++) {
            var p = group.property(i), m = p.matchName;
            if (!p.enabled) continue;
            if (m === "ADBE Vector Group") shapePaint(p.property("ADBE Vectors Group"), res);
            else if (m === "ADBE Vector Graphic - Fill" || m === "ADBE Vector Graphic - G-Fill") res.fill = true;
            else if (m === "ADBE Vector Graphic - Stroke" || m === "ADBE Vector Graphic - G-Stroke") res.stroke = true;
        }
        return res;
    }
    function compRect(layer, t) {
        var r = layer.sourceRectAtTime(t, false), M = layerMatrix(layer, t);
        var c = [mPt(M, [r.left, r.top]), mPt(M, [r.left + r.width, r.top]), mPt(M, [r.left + r.width, r.top + r.height]), mPt(M, [r.left, r.top + r.height])];
        var x0 = Math.min(c[0][0], c[1][0], c[2][0], c[3][0]), x1 = Math.max(c[0][0], c[1][0], c[2][0], c[3][0]);
        var y0 = Math.min(c[0][1], c[1][1], c[2][1], c[3][1]), y1 = Math.max(c[0][1], c[1][1], c[2][1], c[3][1]);
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    }
    // background | text | line | bar | icon | block | skip
    function classify(comp, layer, t) {
        if (!layer.enabled || layer.nullObject || layer.guideLayer || layer.adjustmentLayer) return { kind: "skip" };
        var m = layer.matchName, R0;
        if (m !== "ADBE Vector Layer" && m !== "ADBE Text Layer" && m !== "ADBE AV Layer") return { kind: "skip" };
        try { R0 = compRect(layer, t); } catch (e) { return { kind: "skip" }; }
        var area = (R0.w * R0.h) / (comp.width * comp.height), info = { rect: R0, area: area };
        // what is visible inside the frame
        var vw = Math.max(0, Math.min(R0.x + R0.w, comp.width) - Math.max(R0.x, 0)), vh = Math.max(0, Math.min(R0.y + R0.h, comp.height) - Math.max(R0.y, 0));
        var cover = (vw * vh) / (comp.width * comp.height);
        if (m === "ADBE Text Layer") { info.kind = "text"; return info; }
        if (cover > 0.55) { info.kind = "background"; return info; }
        if (m === "ADBE Vector Layer") {
            var paint = shapePaint(layer.property("ADBE Root Vectors Group"), { fill: false, stroke: false });
            if (paint.stroke && !paint.fill) { info.kind = "line"; return info; }
            var ratio = R0.w / Math.max(1, R0.h);
            if ((ratio > 6 || ratio < 1 / 6) && area < 0.08) { info.kind = "bar"; info.horizontal = ratio > 1; return info; }
        }
        info.kind = area < 0.02 ? "icon" : "block";
        return info;
    }
    function animateText(comp, layer, st, t, styleName) {
        var fd = comp.frameDuration, td = layer.property("ADBE Text Properties").property("ADBE Text Document").value;
        var words = td.text.replace(/[\r\n]+/g, " ").split(/\s+/).length;
        var basedOn = words > 14 ? 4 : 3; // long copy moves by line, headlines by word
        var units = basedOn === 4 ? td.text.split(/[\r\n]+/).length : words;
        var anims = layer.property("ADBE Text Properties").property("ADBE Text Animators"), ai;
        for (ai = anims.numProperties; ai >= 1; ai--) { if (anims.property(ai).name === "Traverse in") layer.property("ADBE Text Properties").property("ADBE Text Animators").property(ai).remove(); }
        var an = layer.property("ADBE Text Properties").property("ADBE Text Animators").addProperty("ADBE Text Animator");
        an.name = "Traverse in";
        var idx = an.propertyIndex;
        function A() { return layer.property("ADBE Text Properties").property("ADBE Text Animators").property(idx); }
        if (st.dist) A().property("ADBE Text Animator Properties").addProperty("ADBE Text Position 3D").setValue([0, Math.max(14, Math.min(st.dist, td.fontSize * 0.8)), 0]);
        if (styleName === "bouncy") A().property("ADBE Text Animator Properties").addProperty("ADBE Text Scale 3D").setValue([70, 70, 100]);
        A().property("ADBE Text Animator Properties").addProperty("ADBE Text Opacity").setValue(0);
        var sel = A().property("ADBE Text Selectors").addProperty("ADBE Text Selector");
        var sIdx = sel.propertyIndex;
        function S() { return A().property("ADBE Text Selectors").property(sIdx); }
        var adv = S().property("ADBE Text Range Advanced");
        adv.property("ADBE Text Range Type2").setValue(basedOn);
        adv.property("ADBE Text Range Shape").setValue(2); // ramp up: everything after the ramp is still hidden
        try { adv.property("ADBE Text Levels Max Ease").setValue(70); adv.property("ADBE Text Levels Min Ease").setValue(styleName === "bouncy" ? -40 : 70); } catch (e) {}
        var off = S().property("ADBE Text Percent Offset");
        var total = Math.max(st.dur, Math.min(72, st.dur * 0.7 + units * st.word));
        off.setValueAtTime(t, -100);
        off.setValueAtTime(t + total * fd, 100);
        easeKeys(off, st.infl);
        return total;
    }
    function animateOne(comp, layer, info, st, styleName, t) {
        var fd = comp.frameDuration, tr = layer.property("ADBE Transform Group");
        var op = tr.property("ADBE Opacity"), pos = tr.property("ADBE Position"), sc = tr.property("ADBE Scale");
        // the resting look is what the layer settles on (its last keyframe), not what it shows under the playhead:
        // re-animating a layer that is mid-fade must not freeze it at that faded state
        function rest(pr) { return pr.numKeys ? pr.keyValue(pr.numKeys) : pr.value; }
        var o1 = rest(op), p1 = rest(pos), s1 = rest(sc), D = st.dur;
        function fade(frames) { op.setValueAtTime(t, 0); op.setValueAtTime(t + frames * fd, o1); easeKeys(op, st.infl); }
        function scaleFrom(fx, fy, withOver) {
            sc.setValueAtTime(t, [s1[0] * fx, s1[1] * fy, 100]);
            if (withOver && st.over) { sc.setValueAtTime(t + D * 0.62 * fd, [s1[0] * (1 + st.over), s1[1] * (1 + st.over), 100]); }
            sc.setValueAtTime(t + D * fd, s1);
            easeKeys(sc, st.infl);
        }
        if (info.kind === "text") return animateText(comp, layer, st, t, styleName);
        if (info.kind === "line") {
            var trim = layer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Filter - Trim");
            var end = trim.property("ADBE Vector Trim End");
            end.setValueAtTime(t, 0); end.setValueAtTime(t + D * 1.4 * fd, 100); easeKeys(end, st.infl);
            return D * 1.4;
        }
        if (info.kind === "bar") {
            if (info.horizontal) scaleFrom(0, 1, false); else scaleFrom(1, 0, false);
            return D;
        }
        if (info.kind === "icon") {
            if (st.scaleFrom) { scaleFrom(0.8, 0.8, false); fade(st.fade); }
            else { scaleFrom(0, 0, true); fade(Math.min(8, st.fade)); }
            return D;
        }
        // block: cards, pictures, larger artwork
        if (st.scaleFrom) scaleFrom(st.scaleFrom / 100, st.scaleFrom / 100, false);
        else if (pos.dimensionsSeparated) { var py = tr.property("ADBE Position_1"), y1 = py.value; py.setValueAtTime(t, y1 + st.dist); py.setValueAtTime(t + D * fd, y1); easeKeys(py, st.infl); }
        else { pos.setValueAtTime(t, [p1[0], p1[1] + st.dist, 0]); pos.setValueAtTime(t + D * fd, p1); easeKeys(pos, st.infl); }
        fade(st.fade);
        return D;
    }
    // returns {count, background, kinds:{}}
    function autoAnimate(comp, layers, styleName) {
        var res = { count: 0, background: 0, kinds: {} };
        if (!styleName || styleName === "none" || !layers.length) return res;
        var base = STYLES[styleName] || STYLES.smooth, k30 = comp.frameRate / 30, st = {}, key;
        for (key in base) if (base.hasOwnProperty(key)) st[key] = base[key];
        st.dur *= k30; st.fade *= k30; st.word *= k30;
        var t0 = comp.time, items = [], i, info;
        for (i = 0; i < layers.length; i++) {
            info = classify(comp, layers[i], t0);
            if (info.kind === "background") { res.background++; continue; }
            if (info.kind === "skip") continue;
            info.layer = layers[i]; items.push(info);
        }
        // reading order: rows from the top, then left to right inside a row
        var band = comp.height * 0.1;
        items.sort(function (a, b) {
            var ra = Math.floor(a.rect.cy / band), rb = Math.floor(b.rect.cy / band);
            return ra !== rb ? ra - rb : a.rect.cx - b.rect.cx;
        });
        // keep the whole entrance inside roughly a second however many layers there are
        // a few frames apart for a handful of layers; with many layers several share a frame so the whole
        // entrance still fits in a little over a second
        var span = comp.frameRate * (styleName === "snappy" ? 1.0 : 1.6);
        var gap = Math.min(styleName === "snappy" ? 3 : 5, span / Math.max(1, items.length));
        for (i = 0; i < items.length; i++) {
            try {
                var startF = Math.round(i * gap), lenF = animateOne(comp, items[i].layer, items[i], st, styleName, t0 + startF * comp.frameDuration);
                res.end = Math.max(res.end || 0, t0 + (startF + (lenF || st.dur)) * comp.frameDuration);
                res.count++; res.kinds[items[i].kind] = (res.kinds[items[i].kind] || 0) + 1;
            } catch (e) {}
        }
        return res;
    }

    // After an entrance is added the playhead sits on its first frame, where faded layers are invisible.
    // Park it on the frame where everything has landed so the artwork is on screen.
    function t0Label(comp, t) { try { return timeToCurrentFormat(t, comp.frameRate); } catch (e) { return ""; } }
    function parkAfter(comp, ar) {
        try { if (ar && ar.count && ar.end) comp.time = Math.min(Math.max(0, comp.duration - comp.frameDuration), Math.ceil(ar.end / comp.frameDuration) * comp.frameDuration); } catch (e) {}
    }

    // =====================================================================
    //  Sync: update existing layers in place (keeps keyframes and effects)
    // =====================================================================
    function parseTag(layer) {
        var c = layer.comment || "";
        if (c.indexOf("trv:") !== 0) return null;
        var p = c.substring(4).split(";");
        return { id: p[0], ox: parseFloat(p[1]) || 0, oy: parseFloat(p[2]) || 0 };
    }
    function findById(comp, id) {
        if (!id) return null;
        for (var i = 1; i <= comp.numLayers; i++) { var t = parseTag(comp.layer(i)); if (t && t.id === id) return comp.layer(i); }
        return null;
    }
    function setVal(prop, v, comp) { if (prop.numKeys > 0) prop.setValueAtTime(comp.time, v); else prop.setValue(v); }
    // a colour that is linked to the palette is only unlinked when the artwork colour really changed
    function syncColor(prop, color, comp) {
        try {
            if (prop.expressionEnabled && prop.expression) {
                var cur = prop.valueAtTime(comp.time, false);
                if (Math.abs(cur[0] - color[0]) + Math.abs(cur[1] - color[1]) + Math.abs(cur[2] - color[2]) < 0.012) return;
                prop.expression = "";
            }
            setVal(prop, rgba(color), comp);
        } catch (e) {}
    }
    // returns true when the existing group tree matches the node tree
    function sameStructure(C, nodes) {
        var groups = [], i;
        for (i = 1; i <= C.numProperties; i++) if (C.property(i).matchName === "ADBE Vector Group") groups.push(i);
        if (groups.length !== nodes.length) return false;
        for (i = 0; i < nodes.length; i++) {
            var gc = C.property(groups[i]).property("ADBE Vectors Group"), n = nodes[i];
            if (n.type === "group") { if (!sameStructure(gc, n.children)) return false; }
            else {
                var paths = 0, par = 0, k;
                for (k = 1; k <= gc.numProperties; k++) { var m = gc.property(k).matchName; if (m === "ADBE Vector Shape - Group") paths++; if (m === "ADBE Vector Shape - Rect" || m === "ADBE Vector Shape - Ellipse") par++; }
                if (par) { if (n.paths.length !== 1) return false; }
                else if (paths !== n.paths.length) return false;
            }
        }
        return true;
    }
    function updateNodes(layer, path, nodes, ctx, comp) {
        var C = contentsAt(layer, path), groups = [], i, k;
        for (i = 1; i <= C.numProperties; i++) if (C.property(i).matchName === "ADBE Vector Group") groups.push(i);
        for (i = 0; i < nodes.length; i++) {
            var n = nodes[i], g = C.property(groups[i]), gc = g.property("ADBE Vectors Group");
            if (n.opacity !== undefined) setVal(g.property("ADBE Vector Transform Group").property("ADBE Vector Group Opacity"), n.opacity, comp);
            if (n.type === "group") { updateNodes(layer, path.concat([groups[i]]), n.children, ctx, comp); continue; }
            var ox = ctx.origin[0], oy = ctx.origin[1], pi = 0;
            var toLocal = function (p) { return [p[0] - ox, p[1] - oy]; };
            for (k = 1; k <= gc.numProperties; k++) {
                var p = gc.property(k), m = p.matchName;
                if (m === "ADBE Vector Shape - Group") { setVal(p.property("ADBE Vector Shape"), makeShape(n.paths[pi++], ox, oy), comp); }
                else if (m === "ADBE Vector Shape - Rect" || m === "ADBE Vector Shape - Ellipse") {
                    var par = detectParametric(n.paths[0]);
                    if (par) {
                        var tg = g.property("ADBE Vector Transform Group");
                        setVal(tg.property("ADBE Vector Position"), [par.center[0] - ox, par.center[1] - oy], comp);
                        setVal(tg.property("ADBE Vector Rotation"), par.rotation, comp);
                        if (m === "ADBE Vector Shape - Rect") { setVal(p.property("ADBE Vector Rect Size"), par.size, comp); setVal(p.property("ADBE Vector Rect Roundness"), par.round || 0, comp); }
                        else setVal(p.property("ADBE Vector Ellipse Size"), par.size, comp);
                        (function (pr) { var cs = Math.cos(-pr.rotation * Math.PI / 180), sn = Math.sin(-pr.rotation * Math.PI / 180); toLocal = function (q) { var dx = q[0] - pr.center[0], dy = q[1] - pr.center[1]; return [dx * cs - dy * sn, dx * sn + dy * cs]; }; })(par);
                    }
                }
                else if (m === "ADBE Vector Graphic - Fill" && n.fill && n.fill.type === "solid") { syncColor(p.property("ADBE Vector Fill Color"), n.fill.color, comp); }
                else if (m === "ADBE Vector Graphic - Stroke" && n.stroke) {
                    if (n.stroke.paint.type === "solid") { syncColor(p.property("ADBE Vector Stroke Color"), n.stroke.paint.color, comp); }
                    setVal(p.property("ADBE Vector Stroke Width"), n.stroke.width, comp);
                }
                else if (m === "ADBE Vector Graphic - G-Fill" && isGrad(n.fill)) {
                    setVal(p.property("ADBE Vector Grad Start Pt"), toLocal(n.fill.start), comp); setVal(p.property("ADBE Vector Grad End Pt"), toLocal(n.fill.end), comp);
                }
                else if (m === "ADBE Vector Graphic - G-Stroke" && n.stroke && isGrad(n.stroke.paint)) {
                    setVal(p.property("ADBE Vector Grad Start Pt"), toLocal(n.stroke.paint.start), comp); setVal(p.property("ADBE Vector Grad End Pt"), toLocal(n.stroke.paint.end), comp);
                    setVal(p.property("ADBE Vector Stroke Width"), n.stroke.width, comp);
                }
            }
        }
    }
    function syncSpec(comp, spec, ctx) {
        var layer = findById(comp, spec.id);
        if (!layer) return false;
        var tag = parseTag(layer);
        if (spec.kind === "shape" && layer.matchName === "ADBE Vector Layer") {
            ctx.origin = [tag.ox, tag.oy];
            var root = layer.property("ADBE Root Vectors Group");
            if (sameStructure(root, spec.nodes)) {
                updateNodes(layer, [], spec.nodes, ctx, comp);
                ctx.stats.updated++;
                return true;
            }
            if (!spec.grad) {
                // structure changed: rebuild the contents, keep the layer (transform keys, effects, parenting survive)
                for (var i = root.numProperties; i >= 1; i--) { if (root.property(i).matchName === "ADBE Vector Group") root.property(i).remove(); }
                var nGroups = 0, pre = layer.property("ADBE Root Vectors Group").numProperties;
                for (var k = 0; k < spec.nodes.length; k++) {
                    buildNode(layer, [], pre + k + 1, spec.nodes[k], ctx);
                }
                // keep operators (trim paths etc.) at the end
                for (k = 0; k < pre; k++) { try { layer.property("ADBE Root Vectors Group").property(1).moveTo(layer.property("ADBE Root Vectors Group").numProperties); } catch (e) {} }
                ctx.stats.rebuilt++;
                return true;
            }
            return false;
        }
        if (spec.kind === "text" && layer.matchName === "ADBE Text Layer") {
            applyTextDoc(layer, spec.node, ctx);
            ctx.stats.updated++;
            return true;
        }
        if (spec.kind === "image" && layer.source) {
            try {
                var nf = app.project.importFile(new ImportOptions(new File(spec.node.file)));
                nf.parentFolder = assetFolder(); nf.name = (spec.name || "Image") + ".png";
                layer.replaceSource(nf, false);
                ctx.stats.updated++;
            } catch (e) {}
            return true;
        }
        return false;
    }

    // =====================================================================
    //  Entry point: called from Illustrator through BridgeTalk
    // =====================================================================
    TRV.aeReceive = function (path) {
        var undoOpen = false, skel = null;
        try {
            var data = TRV.parse(TRV.readFile(path));
            var opts = data.opts || {}, action = opts.action || "push";
            app.beginSuppressDialogs();
            app.beginUndoGroup("Traverse: " + action);
            undoOpen = true;
            var comp = activeComp(), created = false;
            if (!comp || opts.newComp) {
                var ref = comp;
                var cname = data.doc.artboard && !/^(Artboard|Mesa de trabajo|Zeichenfl.che|Plan de travail|Tavola disegno|Prancheta|Tekengebied) \d+$/.test(data.doc.artboard) ? data.doc.artboard : data.doc.name;
                comp = app.project.items.addComp(cname || "Traverse", Math.max(4, Math.round(data.doc.width)), Math.max(4, Math.round(data.doc.height)), 1, ref ? ref.duration : 10, ref ? ref.frameRate : 30);
                comp.openInViewer();
                created = true;
            }
            var stats = { comp: comp.name, created: created, layers: 0, shapes: 0, texts: 0, images: 0, gradients: 0, parametric: 0, styledRuns: 0, guides: 0, updated: 0, rebuilt: 0, animated: 0, palette: 0, warnings: [] };
            var ctx = { opts: opts, stats: stats, off: [0, 0], origin: [0, 0], palette: null };

            if (data.guides && data.guides.length) stats.guides = addGuides(comp, data.guides, ctx.off);
            if (action === "palette" && data.swatches) {
                var pal = ensurePalette(comp, data.swatches);
                stats.palette = data.swatches.length;
                pal.layer.moveToBeginning();
            }
            if (action === "push" || action === "sync") {
                var split = opts.split || "top";
                if (opts.link && split === "merge") split = "top";
                var specs = plan(data.items, split), i, b = null;
                for (i = 0; i < specs.length; i++) b = unionBounds(b, specs[i].bounds);
                if (!created && opts.place === "center" && b) ctx.off = [comp.width / 2 - (b[0] + b[2]) / 2, comp.height / 2 - (b[1] + b[3]) / 2];

                // sync pass
                var todo = [];
                if (action === "sync") {
                    for (i = 0; i < specs.length; i++) { if (!syncSpec(comp, specs[i], ctx)) todo.push(specs[i]); }
                } else todo = specs;

                if (opts.linkColors && todo.length) {
                    var cols = []; collectColors(data.items, cols, {});
                    if (cols.length) { ctx.palette = ensurePalette(comp, cols); stats.palette = cols.length; }
                }
                // gradient skeletons
                var gradSpecs = [];
                for (i = 0; i < todo.length; i++) if (todo[i].kind === "shape" && todo[i].grad) gradSpecs.push(todo[i]);
                if (gradSpecs.length) {
                    try { skel = importSkeletons(gradSpecs); if (!skel.comp) throw new Error("no comp in skeleton"); }
                    catch (eg) { skel = null; stats.warnings.push("Gradients fell back to solid colours (" + eg.message + ")"); for (i = 0; i < gradSpecs.length; i++) stripSk(gradSpecs[i].nodes); }
                }
                var made = [], layer, sp;
                for (i = todo.length - 1; i >= 0; i--) {
                    sp = todo[i]; layer = null;
                    try {
                        if (sp.kind === "shape") {
                            var pre = null;
                            if (sp.grad && skel) pre = skeletonLayerFor(skel, sp, comp);
                            layer = buildShapeLayer(comp, sp, ctx, pre);
                        } else if (sp.kind === "text") layer = buildTextLayer(comp, sp, ctx);
                        else if (sp.kind === "image") layer = buildImageLayer(comp, sp, ctx);
                    } catch (el) { stats.warnings.push((sp.name || sp.kind) + ": " + el.message + (el.line ? " (ae.jsx:" + el.line + ")" : "")); }
                    if (layer) { try { if (layer.index !== 1) layer.moveToBeginning(); } catch (em) {} made.unshift(layer); }
                }
                stats.layers = made.length;
                if (skel) { try { skel.folder.remove(); } catch (er) {} skel = null; }
                if (ctx.palette) { try { ctx.palette.layer.moveToBeginning(); } catch (ep) {} }
                var arPush = null;
                if (opts.animate && opts.animate !== "none") { arPush = autoAnimate(comp, made, opts.animate); stats.animated = arPush.count; stats.still = arPush.background; stats.animStart = t0Label(comp, comp.time); }
                try { for (i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false; for (i = 0; i < made.length; i++) made[i].selected = true; } catch (es) {}
            }
            app.endUndoGroup(); undoOpen = false;
            if (typeof arPush !== "undefined" && arPush) parkAfter(comp, arPush);
            app.endSuppressDialogs(false);
            return TRV.ok({ stats: stats });
        } catch (e) {
            if (skel) { try { skel.folder.remove(); } catch (e2) {} }
            if (undoOpen) { try { app.endUndoGroup(); } catch (e3) {} }
            try { app.endSuppressDialogs(false); } catch (e4) {}
            return TRV.fail("After Effects: " + e.message + (e.line ? " (ae.jsx:" + e.line + ")" : ""));
        }
    };
    function stripSk(nodes) { for (var i = 0; i < nodes.length; i++) { delete nodes[i]._sk; if (nodes[i].children) stripSk(nodes[i].children); } }

    // =====================================================================
    //  EXPORT (After Effects -> Illustrator)
    // =====================================================================
    function mMul(a, b) { // a * b (apply b first)
        return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
    }
    function mPt(m, p) { return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]; }
    function mVec(m, v) { return [m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1]]; }
    function mScale(m) { return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])); }
    function trsMatrix(anchor, pos, scale, rotDeg) {
        var r = rotDeg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), sx = scale[0] / 100, sy = scale[1] / 100;
        // T(pos) * R * S * T(-anchor)
        var m = [c * sx, s * sx, -s * sy, c * sy, 0, 0];
        m[4] = pos[0] - (m[0] * anchor[0] + m[2] * anchor[1]);
        m[5] = pos[1] - (m[1] * anchor[0] + m[3] * anchor[1]);
        return m;
    }
    function layerMatrix(layer, t) {
        var tr = layer.property("ADBE Transform Group");
        var a = tr.property("ADBE Anchor Point").valueAtTime(t, false), p;
        var pp = tr.property("ADBE Position");
        if (pp.dimensionsSeparated) p = [tr.property("ADBE Position_0").valueAtTime(t, false), tr.property("ADBE Position_1").valueAtTime(t, false)];
        else p = pp.valueAtTime(t, false);
        var s = tr.property("ADBE Scale").valueAtTime(t, false), r = tr.property("ADBE Rotate Z").valueAtTime(t, false);
        var m = trsMatrix(a, p, s, r);
        if (layer.parent) m = mMul(layerMatrix(layer.parent, t), m);
        return m;
    }
    function shapeToPath(shape, m) {
        var pts = [], i, v, a, b, p;
        for (i = 0; i < shape.vertices.length; i++) {
            p = mPt(m, shape.vertices[i]);
            a = shape.inTangents.length > i ? mVec(m, shape.inTangents[i]) : [0, 0];
            b = shape.outTangents.length > i ? mVec(m, shape.outTangents[i]) : [0, 0];
            pts.push([R(p[0]), R(p[1]), R(a[0]), R(a[1]), R(b[0]), R(b[1])]);
        }
        return { closed: shape.closed, pts: pts };
    }
    function rawPath(pts, closed, m) {
        var out = [], i, p, a, b;
        for (i = 0; i < pts.length; i++) {
            p = mPt(m, [pts[i][0], pts[i][1]]); a = mVec(m, [pts[i][2], pts[i][3]]); b = mVec(m, [pts[i][4], pts[i][5]]);
            out.push([R(p[0]), R(p[1]), R(a[0]), R(a[1]), R(b[0]), R(b[1])]);
        }
        return { closed: closed, pts: out };
    }
    function rectPts(size, pos, round) {
        var w = size[0] / 2, h = size[1] / 2, x = pos[0], y = pos[1], r = Math.min(round || 0, w, h), k = r * 0.5523;
        if (r <= 0.001) return [[x + w, y - h, 0, 0, 0, 0], [x + w, y + h, 0, 0, 0, 0], [x - w, y + h, 0, 0, 0, 0], [x - w, y - h, 0, 0, 0, 0]];
        return [
            [x + w, y - h + r, 0, -k, 0, 0], [x + w, y + h - r, 0, 0, 0, k],
            [x + w - r, y + h, k, 0, 0, 0], [x - w + r, y + h, 0, 0, -k, 0],
            [x - w, y + h - r, 0, k, 0, 0], [x - w, y - h + r, 0, 0, 0, -k],
            [x - w + r, y - h, -k, 0, 0, 0], [x + w - r, y - h, 0, 0, k, 0]
        ];
    }
    function ellipsePts(size, pos) {
        var a = size[0] / 2, b = size[1] / 2, x = pos[0], y = pos[1], ka = a * 0.5523, kb = b * 0.5523;
        return [[x, y - b, -ka, 0, ka, 0], [x + a, y, 0, -kb, 0, kb], [x, y + b, ka, 0, -ka, 0], [x - a, y, 0, kb, 0, -kb]];
    }
    function starPts(p, t) {
        var type = p.property("ADBE Vector Star Type").valueAtTime(t, false), n = Math.max(3, Math.round(p.property("ADBE Vector Star Points").valueAtTime(t, false)));
        var pos = p.property("ADBE Vector Star Position").valueAtTime(t, false), rot = p.property("ADBE Vector Star Rotation").valueAtTime(t, false) * Math.PI / 180;
        var ro = p.property("ADBE Vector Star Outer Radius").valueAtTime(t, false), ri = type === 1 ? p.property("ADBE Vector Star Inner Radius").valueAtTime(t, false) : 0;
        var pts = [], i, a, steps = type === 1 ? n * 2 : n, rad;
        for (i = 0; i < steps; i++) {
            a = rot - Math.PI / 2 + i * 2 * Math.PI / steps;
            rad = (type === 1 && i % 2 === 1) ? ri : ro;
            pts.push([pos[0] + Math.cos(a) * rad, pos[1] + Math.sin(a) * rad, 0, 0, 0, 0]);
        }
        return pts;
    }

    // ---- gradient read-back: After Effects hides gradient colours from scripts, so we sample pixels
    function simplifyCurve(samples, tol) {
        // samples: [{t, v:[..]}]; Ramer-Douglas-Peucker on the value curve
        var keep = [], n = samples.length, i;
        for (i = 0; i < n; i++) keep.push(false);
        keep[0] = keep[n - 1] = true;
        (function rec(a, b) {
            var worst = -1, wd = tol, k, d, j, f, e;
            for (k = a + 1; k < b; k++) {
                f = (samples[k].t - samples[a].t) / (samples[b].t - samples[a].t); d = 0;
                for (j = 0; j < samples[k].v.length; j++) { e = Math.abs(samples[k].v[j] - (samples[a].v[j] + (samples[b].v[j] - samples[a].v[j]) * f)); if (e > d) d = e; }
                if (d > wd) { wd = d; worst = k; }
            }
            if (worst > 0) { keep[worst] = true; rec(a, worst); rec(worst, b); }
        })(0, n - 1);
        var out = [];
        for (i = 0; i < n; i++) if (keep[i]) out.push(samples[i]);
        return out;
    }
    function sampleGradient(comp, layer, path, propIndex, isStroke) {
        var dup = null, sampler = null, result = null;
        try {
            var N = 64, W = comp.width, H = comp.height, t = comp.time, i, k;
            dup = layer.duplicate();
            dup.enabled = true; dup.parent = null;
            try { dup.blendingMode = BlendingMode.NORMAL; } catch (e0) {}
            var fx = dup.property("ADBE Effect Parade"); if (fx) for (i = fx.numProperties; i >= 1; i--) fx.property(i).remove();
            var mk = dup.property("ADBE Mask Parade"); if (mk) for (i = mk.numProperties; i >= 1; i--) mk.property(i).remove();
            var tr = dup.property("ADBE Transform Group");
            function reset(pr, v) { try { while (pr.numKeys > 0) pr.removeKey(1); if (pr.expression) pr.expression = ""; pr.setValue(v); } catch (e1) {} }
            if (tr.property("ADBE Position").dimensionsSeparated) tr.property("ADBE Position").dimensionsSeparated = false;
            reset(tr.property("ADBE Anchor Point"), [0, 0]); reset(tr.property("ADBE Position"), [0, 0]); reset(tr.property("ADBE Scale"), [100, 100]); reset(tr.property("ADBE Rotate Z"), 0); reset(tr.property("ADBE Opacity"), 100);
            // strip everything except the chain that leads to the gradient
            var cur = [], level, C, keepIdx, target;
            for (level = 0; level <= path.length; level++) {
                C = contentsAt(dup, cur);
                keepIdx = level < path.length ? path[level] : propIndex;
                for (i = C.numProperties; i >= 1; i--) { if (i !== keepIdx) { contentsAt(dup, cur).property(i).remove(); } }
                if (level < path.length) {
                    var gt = contentsAt(dup, cur).property(1).property("ADBE Vector Transform Group");
                    reset(gt.property("ADBE Vector Anchor"), [0, 0]); reset(gt.property("ADBE Vector Position"), [0, 0]); reset(gt.property("ADBE Vector Scale"), [100, 100]);
                    reset(gt.property("ADBE Vector Rotation"), 0); reset(gt.property("ADBE Vector Skew"), 0); reset(gt.property("ADBE Vector Group Opacity"), 100);
                    cur.push(1);
                }
            }
            // a path that covers the sampling line
            var s = new Shape(), x0 = W * 0.1, x1 = W * 0.9, y = H / 2;
            if (isStroke) { s.vertices = [[x0, y], [x1, y]]; s.closed = false; }
            else { s.vertices = [[0, 0], [W, 0], [W, H], [0, H]]; s.closed = true; }
            var sh = contentsAt(dup, cur).addProperty("ADBE Vector Shape - Group");
            sh.property("ADBE Vector Shape").setValue(s);
            sh.moveTo(1);
            var g = contentsAt(dup, cur).property(2);
            reset(g.property("ADBE Vector Grad Start Pt"), [x0, y]); reset(g.property("ADBE Vector Grad End Pt"), [x1, y]);
            try { reset(g.property("ADBE Vector Grad HiLite Length"), 0); } catch (e2) {}
            try { reset(g.property("ADBE Vector Grad Scale"), [100, 100]); reset(g.property("ADBE Vector Grad Rotation"), 0); } catch (e3) {}
            try { reset(g.property(isStroke ? "ADBE Vector Stroke Opacity" : "ADBE Vector Fill Opacity"), 100); } catch (e4) {}
            if (isStroke) {
                reset(g.property("ADBE Vector Stroke Width"), 24);
                try { var d = g.property("ADBE Vector Stroke Dashes"); for (i = d.numProperties; i >= 1; i--) contentsAt(dup, cur).property(2).property("ADBE Vector Stroke Dashes").property(i).remove(); } catch (e5) {}
            }
            sampler = comp.layers.addText("");
            var dupIndex = dup.index;
            var ex = "var L = thisComp.layer(" + dupIndex + "); var o = []; for (var i = 0; i <= " + N + "; i++) { var c = L.sampleImage([" + x0 + " + " + (x1 - x0) + " * i / " + N + ", " + y + "], [0.5, 0.5], true, time); o.push(c[0].toFixed(4) + ',' + c[1].toFixed(4) + ',' + c[2].toFixed(4) + ',' + c[3].toFixed(4)); } o.join(';')";
            var sp = sampler.property("ADBE Text Properties").property("ADBE Text Document");
            sp.expression = ex;
            var txt = sp.valueAtTime(t, false).text, parts = txt.split(";"), cs = [], as = [];
            if (parts.length < N) throw new Error("sampling failed");
            for (i = 0; i < parts.length; i++) {
                var q = parts[i].split(","), tt = i / N;
                cs.push({ t: tt, v: [parseFloat(q[0]), parseFloat(q[1]), parseFloat(q[2])] });
                as.push({ t: tt, v: [parseFloat(q[3])] });
            }
            // transparent samples carry no colour: borrow the nearest opaque one
            for (i = 0; i < cs.length; i++) if (as[i].v[0] < 0.004) { for (k = 1; k < cs.length; k++) { if (i + k < cs.length && as[i + k].v[0] >= 0.004) { cs[i].v = cs[i + k].v; break; } if (i - k >= 0 && as[i - k].v[0] >= 0.004) { cs[i].v = cs[i - k].v; break; } } }
            var cK = simplifyCurve(cs, 0.012), aK = simplifyCurve(as, 0.012), pos = {}, list = [];
            for (i = 0; i < cK.length; i++) pos[cK[i].t] = 1;
            for (i = 0; i < aK.length; i++) pos[aK[i].t] = 1;
            for (k in pos) if (pos.hasOwnProperty(k)) list.push(parseFloat(k));
            list.sort(function (a, b) { return a - b; });
            result = [];
            for (i = 0; i < list.length; i++) {
                var idx = Math.round(list[i] * N);
                result.push({ pos: R(list[i]), mid: 0.5, color: [R(cs[idx].v[0]), R(cs[idx].v[1]), R(cs[idx].v[2])], opacity: R(as[idx].v[0]) });
            }
        } catch (e) { result = null; }
        try { if (sampler) sampler.remove(); } catch (e6) {}
        try { if (dup) dup.remove(); } catch (e7) {}
        return result;
    }

    function exportContents(comp, layer, C, path, M, t, ctx) {
        var out = [], paths = [], fill = null, stroke = null, fillOp = 100, firstPathAt = -1, i, p, m;
        for (i = 1; i <= C.numProperties; i++) {
            p = C.property(i);
            if (!p.enabled) continue;
            m = p.matchName;
            if (m === "ADBE Vector Group") {
                var tg = p.property("ADBE Vector Transform Group");
                var gm = trsMatrix(tg.property("ADBE Vector Anchor").valueAtTime(t, false), tg.property("ADBE Vector Position").valueAtTime(t, false), tg.property("ADBE Vector Scale").valueAtTime(t, false), tg.property("ADBE Vector Rotation").valueAtTime(t, false));
                var kids = exportContents(comp, layer, p.property("ADBE Vectors Group"), path.concat([i]), mMul(M, gm), t, ctx);
                if (kids.length) {
                    var gop = tg.property("ADBE Vector Group Opacity").valueAtTime(t, false), node;
                    if (kids.length === 1 && kids[0].type === "path") { node = kids[0]; node.name = p.name; if (gop < 100) node.opacity = R((node.opacity === undefined ? 100 : node.opacity) * gop / 100); }
                    else { node = { type: "group", name: p.name, children: kids }; if (gop < 100) node.opacity = R(gop); }
                    out.push(node);
                }
            } else if (m === "ADBE Vector Shape - Group") {
                if (firstPathAt < 0) firstPathAt = out.length;
                paths.push(shapeToPath(p.property("ADBE Vector Shape").valueAtTime(t, false), M));
            } else if (m === "ADBE Vector Shape - Rect") {
                if (firstPathAt < 0) firstPathAt = out.length;
                paths.push(rawPath(rectPts(p.property("ADBE Vector Rect Size").valueAtTime(t, false), p.property("ADBE Vector Rect Position").valueAtTime(t, false), p.property("ADBE Vector Rect Roundness").valueAtTime(t, false)), true, M));
            } else if (m === "ADBE Vector Shape - Ellipse") {
                if (firstPathAt < 0) firstPathAt = out.length;
                paths.push(rawPath(ellipsePts(p.property("ADBE Vector Ellipse Size").valueAtTime(t, false), p.property("ADBE Vector Ellipse Position").valueAtTime(t, false)), true, M));
            } else if (m === "ADBE Vector Shape - Star") {
                if (firstPathAt < 0) firstPathAt = out.length;
                paths.push(rawPath(starPts(p, t), true, M));
            } else if (m === "ADBE Vector Graphic - Fill" && !fill) {
                var c = p.property("ADBE Vector Fill Color").valueAtTime(t, false);
                fill = { type: "solid", color: [R(c[0]), R(c[1]), R(c[2])] };
                fillOp = p.property("ADBE Vector Fill Opacity").valueAtTime(t, false);
                if (p.property("ADBE Vector Fill Rule").value === 2) fill._evenodd = true;
            } else if (m === "ADBE Vector Graphic - Stroke" && !stroke) {
                var sc = p.property("ADBE Vector Stroke Color").valueAtTime(t, false);
                stroke = strokeInfo(p, t, M); stroke.paint = { type: "solid", color: [R(sc[0]), R(sc[1]), R(sc[2])] };
            } else if (m === "ADBE Vector Graphic - G-Fill" && !fill) {
                fill = gradInfo(comp, layer, path, i, p, t, M, false, ctx);
                fillOp = p.property("ADBE Vector Fill Opacity").valueAtTime(t, false);
            } else if (m === "ADBE Vector Graphic - G-Stroke" && !stroke) {
                stroke = strokeInfo(p, t, M); stroke.paint = gradInfo(comp, layer, path, i, p, t, M, true, ctx);
            }
        }
        if (paths.length && (fill || stroke)) {
            var n = { type: "path", name: "Path", paths: paths };
            if (fill) { if (fill._evenodd) { n.evenodd = true; delete fill._evenodd; } n.fill = fill; }
            if (stroke) n.stroke = stroke;
            if (fillOp < 100) n.opacity = R(fillOp);
            out.splice(firstPathAt, 0, n);
            ctx.stats.shapes++;
        } else if (!paths.length && (fill || stroke)) {
            // paint that applies to paths living in sub-groups
            (function inherit(list) {
                for (var k = 0; k < list.length; k++) {
                    if (list[k].type === "group") inherit(list[k].children);
                    else if (list[k].type === "path") { if (!list[k].fill && fill) list[k].fill = fill; if (!list[k].stroke && stroke) list[k].stroke = stroke; }
                }
            })(out);
        } else if (paths.length) {
            out._loosePaths = paths; // paths waiting for a paint from the parent group
            var ln = { type: "path", name: "Path", paths: paths };
            out.splice(firstPathAt, 0, ln);
            ctx.stats.shapes++;
        }
        return out;
    }
    function strokeInfo(p, t, M) {
        var s = { width: R(p.property("ADBE Vector Stroke Width").valueAtTime(t, false) * mScale(M)) };
        var cap = p.property("ADBE Vector Stroke Line Cap").value, join = p.property("ADBE Vector Stroke Line Join").value;
        s.cap = cap === 2 ? "round" : (cap === 3 ? "square" : "butt");
        s.join = join === 2 ? "round" : (join === 3 ? "bevel" : "miter");
        try { s.miter = R(p.property("ADBE Vector Stroke Miter Limit").value); } catch (e) {}
        try {
            var d = p.property("ADBE Vector Stroke Dashes"), dashes = [], i;
            for (i = 1; i <= d.numProperties; i++) { var dp = d.property(i); if (!dp.canSetExpression) continue; /* inactive dash slots are hidden */ if (dp.matchName === "ADBE Vector Stroke Offset") s.dashOffset = R(dp.value); else dashes.push(R(dp.value * mScale(M))); }
            if (dashes.length) s.dashes = dashes;
        } catch (e2) {}
        return s;
    }
    function gradInfo(comp, layer, path, idx, p, t, M, isStroke, ctx) {
        var a = mPt(M, p.property("ADBE Vector Grad Start Pt").valueAtTime(t, false)), b = mPt(M, p.property("ADBE Vector Grad End Pt").valueAtTime(t, false));
        var stops = sampleGradient(comp, layer, path, idx, isStroke);
        if (!stops || stops.length < 2) { ctx.stats.warnings.push("Could not read a gradient on \"" + layer.name + "\"; used black to white."); stops = [{ pos: 0, mid: 0.5, color: [1, 1, 1], opacity: 1 }, { pos: 1, mid: 0.5, color: [0, 0, 0], opacity: 1 }]; }
        ctx.stats.gradients++;
        return { type: "gradient", kind: p.property("ADBE Vector Grad Type").value === 2 ? "radial" : "linear", stops: stops, start: [R(a[0]), R(a[1])], end: [R(b[0]), R(b[1])] };
    }

    // After Effects sometimes raises a spurious "numeric result invalid" error on the first read of a
    // text property; a second read succeeds, so every read is retried once.
    function rd(o, k) { try { return o[k]; } catch (e) { try { return o[k]; } catch (e2) { return undefined; } } }
    function readStyle(o, isRange) {
        var s = {}, v, c;
        v = rd(o, "font"); if (v) s.font = v;
        v = rd(o, "fontSize"); if (v) s.size = R(v);
        v = rd(o, "applyFill");
        if (v === false) s.noFill = true;
        else { c = rd(o, "fillColor"); if (c && c.length >= 3) s.fill = [R(c[0]), R(c[1]), R(c[2])]; }
        if (rd(o, "applyStroke") === true) { c = rd(o, "strokeColor"); v = rd(o, "strokeWidth"); if (c && c.length >= 3 && v) { s.stroke = [R(c[0]), R(c[1]), R(c[2])]; s.strokeWidth = R(v); } }
        v = rd(o, "tracking"); if (v !== undefined) s.tracking = R(v);
        if (isRange) { if (rd(o, "autoLeading") === false) { v = rd(o, "leading"); if (v) s.leading = R(v); } }
        v = rd(o, "baselineShift"); if (v) s.baseline = R(v);
        v = rd(o, "horizontalScale"); if (v && Math.abs(v - 1) > 0.001) s.hscale = R(v * 100);
        v = rd(o, "verticalScale"); if (v && Math.abs(v - 1) > 0.001) s.vscale = R(v * 100);
        if (rd(o, "allCaps") === true) s.caps = "all"; else if (rd(o, "smallCaps") === true) s.caps = "small";
        return s;
    }
    function exportText(layer, M, t, ctx) {
        var td = layer.property("ADBE Text Properties").property("ADBE Text Document").valueAtTime(t, false);
        var text = td.text, node = { type: "text", name: layer.name, text: text, runs: [] }, i, cur = null, st;
        if (typeof td.characterRange === "function" && text.length > 0 && text.length <= 2000) {
            for (i = 0; i < text.length; i++) {
                try { st = readStyle(td.characterRange(i, i + 1), true); } catch (e) { st = null; }
                if (!st) { node.runs = []; break; }
                if (cur && TRV.stringify(cur.style) === TRV.stringify(st)) cur.end = i + 1;
                else { cur = { start: i, end: i + 1, style: st }; node.runs.push(cur); }
            }
        }
        if (!node.runs.length) node.runs = [{ start: 0, end: text.length, style: readStyle(td) }];
        var j = td.justification;
        node.justify = j === ParagraphJustification.CENTER_JUSTIFY ? "center" : (j === ParagraphJustification.RIGHT_JUSTIFY ? "right" : (j === ParagraphJustification.LEFT_JUSTIFY ? "left" : "justify"));
        var sc = Math.sqrt(M[0] * M[0] + M[1] * M[1]), sy = Math.sqrt(M[2] * M[2] + M[3] * M[3]);
        if (td.boxText) {
            var bp = td.boxTextPos, bs = td.boxTextSize, a = mPt(M, bp), b = mPt(M, [bp[0] + bs[0], bp[1] + bs[1]]);
            node.kind = "area"; node.box = [R(Math.min(a[0], b[0])), R(Math.min(a[1], b[1])), R(Math.max(a[0], b[0])), R(Math.max(a[1], b[1]))];
            if (Math.abs(sc - 1) > 0.001) for (i = 0; i < node.runs.length; i++) { if (node.runs[i].style.size) node.runs[i].style.size = R(node.runs[i].style.size * sc); if (node.runs[i].style.leading) node.runs[i].style.leading = R(node.runs[i].style.leading * sc); }
        } else {
            node.kind = "point";
            var o = mPt(M, [0, 0]);
            node.anchor = [R(o[0]), R(o[1])];
            node.rotation = R(Math.atan2(M[1], M[0]) * 180 / Math.PI);
            node.scale = [R(sc * 100), R(sy * 100)];
        }
        var op = layer.property("ADBE Transform Group").property("ADBE Opacity").valueAtTime(t, false);
        if (op < 100) node.opacity = R(op);
        ctx.stats.texts++;
        return node;
    }

    TRV.aeExport = function (opts) {
        var comp = activeComp();
        if (!comp) throw new Error("NO_COMP");
        var t = comp.time, i, layers = [], sel = comp.selectedLayers;
        if (sel && sel.length) { layers = sel.slice(0); layers.sort(function (a, b) { return a.index - b.index; }); }
        else for (i = 1; i <= comp.numLayers; i++) if (comp.layer(i).enabled && !comp.layer(i).guideLayer) layers.push(comp.layer(i));
        var data = { format: "traverse", version: 1, source: "ae", doc: { name: comp.name, width: comp.width, height: comp.height }, items: [], guides: [] };
        var ctx = { stats: { shapes: 0, texts: 0, gradients: 0, skipped: 0, warnings: [] } };
        if (!opts.onlyMeta) {
            for (i = 0; i < layers.length; i++) {
                var L = layers[i], M = layerMatrix(L, t), node = null;
                var lop = L.property("ADBE Transform Group").property("ADBE Opacity").valueAtTime(t, false);
                try {
                    if (L.matchName === "ADBE Vector Layer") {
                        var kids = exportContents(comp, L, L.property("ADBE Root Vectors Group"), [], M, t, ctx);
                        if (kids.length === 1) { node = kids[0]; node.name = L.name; }
                        else if (kids.length) node = { type: "group", name: L.name, children: kids };
                        if (node && lop < 100) node.opacity = R((node.opacity === undefined ? 100 : node.opacity) * lop / 100);
                    } else if (L.matchName === "ADBE Text Layer") {
                        node = exportText(L, M, t, ctx);
                    } else if (L.source && L.source.mainSource && L.source.mainSource instanceof SolidSource && !L.nullObject && !L.adjustmentLayer) {
                        var w = L.source.width, h = L.source.height, c = L.source.mainSource.color;
                        node = { type: "path", name: L.name, paths: [rawPath([[0, 0, 0, 0, 0, 0], [w, 0, 0, 0, 0, 0], [w, h, 0, 0, 0, 0], [0, h, 0, 0, 0, 0]], true, M)], fill: { type: "solid", color: [R(c[0]), R(c[1]), R(c[2])] } };
                        if (lop < 100) node.opacity = R(lop);
                        ctx.stats.shapes++;
                    } else if (L.source && L.source.mainSource && L.source.mainSource instanceof FileSource && L.source.mainSource.isStill && L.source.file) {
                        var fw = L.source.width, fh = L.source.height, c0 = mPt(M, [0, 0]), c1 = mPt(M, [fw, fh]);
                        node = { type: "image", name: L.name, file: L.source.file.fsName, bounds: [R(Math.min(c0[0], c1[0])), R(Math.min(c0[1], c1[1])), R(Math.max(c0[0], c1[0])), R(Math.max(c0[1], c1[1]))] };
                        if (lop < 100) node.opacity = R(lop);
                        ctx.stats.images = (ctx.stats.images || 0) + 1;
                    } else ctx.stats.skipped++;
                } catch (e) { ctx.stats.warnings.push(L.name + ": " + e.message + (e.line ? " (ae.jsx:" + e.line + ")" : "")); }
                if (node) data.items.push(node);
            }
        }
        if (opts.guides) {
            try { for (i = 0; i < comp.guides.length; i++) data.guides.push({ o: comp.guides[i].orientationType === 0 ? "h" : "v", pos: R(comp.guides[i].position) }); } catch (e2) {}
        }
        data.stats = ctx.stats;
        return data;
    };

    // action: pull | artboard | guides
    TRV.aePull = function (optsJson) {
        var undo = false;
        try {
            var opts = typeof optsJson === "string" ? TRV.parse(optsJson) : (optsJson || {});
            var action = opts.action || "pull";
            if (!activeComp()) return TRV.fail("Open a composition in After Effects first.");
            if (action === "artboard") { opts.onlyMeta = true; opts.newArtboard = true; }
            if (action === "guides") { opts.onlyMeta = true; opts.guides = true; }
            app.beginSuppressDialogs();
            app.beginUndoGroup("Traverse: read"); undo = true;
            var data = TRV.aeExport(opts);
            app.endUndoGroup(); undo = false;
            app.endSuppressDialogs(false);
            data.opts = opts;
            if (action === "pull" && !data.items.length) return TRV.fail("Nothing to send: select shape, text or solid layers.");
            if (action === "guides" && !data.guides.length) return TRV.fail("This composition has no guides.");
            var path = TRV.tempDir() + "/pull_" + TRV.stamp() + ".json";
            try { TRV.writeFile(path, TRV.stringify(data)); }
            catch (ew) { return TRV.fail("After Effects blocked file writing. Turn on \"Allow Scripts to Write Files and Access Network\" in Settings > Scripting & Expressions (Edit > Preferences on Windows)."); }
            if (opts.dryRun) return TRV.ok({ file: path, stats: data.stats });
            if (!TRV.findTarget("illustrator")) return TRV.fail("Illustrator is not running. Open it and try again.");
            TRV.bringToFront("illustrator"); // Illustrator stalls on text while it sits in the background
            var res = TRV.sendTo("illustrator", "TRV.aiReceive(" + TRV.stringify(path.replace(/\\/g, "/")) + ")", 180);
            if (!res.ok) return TRV.fail(res.error === "TIMEOUT" ? "Illustrator did not answer. It may be busy or showing a dialog: check it and try again." : "Illustrator did not answer: " + res.error);
            var out = TRV.parse(res.body);
            if (out.ok) { out.sent = data.stats; }
            return TRV.stringify(out);
        } catch (e) {
            if (undo) { try { app.endUndoGroup(); } catch (e2) {} }
            try { app.endSuppressDialogs(false); } catch (e3) {}
            return TRV.fail(e.message === "NO_COMP" ? "Open a composition in After Effects first." : (e.message + (e.line ? " (ae.jsx:" + e.line + ")" : "")));
        }
    };

    // =====================================================================
    //  Panel utilities inside After Effects
    // =====================================================================
    TRV.aeInfo = function () {
        try {
            var c = activeComp();
            if (!c) return TRV.ok({ comp: null });
            return TRV.ok({ comp: c.name, w: c.width, h: c.height, selection: c.selectedLayers.length, layers: c.numLayers });
        } catch (e) { return TRV.fail(e.message); }
    };
    TRV.aeAnimate = function (optsJson) {
        try {
            var o = TRV.parse(optsJson), c = activeComp();
            if (!c) return TRV.fail("Open a composition first.");
            var all = c.selectedLayers, sel = [], q;
            for (q = 0; q < all.length; q++) if (all[q].enabled) sel.push(all[q]);
            if (!sel.length) return TRV.fail("Select the layers to animate.");
            sel.sort(function (a, b) { return a.index - b.index; });
            app.beginUndoGroup("Traverse: animate");
            var startLabel = t0Label(c, c.time);
            var ar = autoAnimate(c, sel, o.animate || "smooth");
            app.endUndoGroup();
            parkAfter(c, ar);
            if (!ar.count) return TRV.fail(ar.background ? "Only background layers are selected, and backgrounds stay still." : "Nothing to animate in the selection.");
            return TRV.ok({ stats: { animated: ar.count, still: ar.background, animStart: startLabel } });
        } catch (e) { try { app.endUndoGroup(); } catch (e2) {} return TRV.fail(e.message + (e.line ? " (ae.jsx:" + e.line + ")" : "")); }
    };
    // Split a shape layer into one layer per top-level group (gradients survive: layers are duplicated, not rebuilt)
    TRV.aeExplode = function () {
        try {
            var c = activeComp();
            if (!c) return TRV.fail("Open a composition first.");
            var sel = c.selectedLayers.slice(0), made = 0, i, k, j;
            if (!sel.length) return TRV.fail("Select one or more shape layers.");
            app.beginUndoGroup("Traverse: explode");
            for (i = 0; i < sel.length; i++) {
                var L = sel[i];
                if (L.matchName !== "ADBE Vector Layer") continue;
                var root = L.property("ADBE Root Vectors Group"), groups = [];
                for (k = 1; k <= root.numProperties; k++) if (root.property(k).matchName === "ADBE Vector Group") groups.push(k);
                if (groups.length < 2) continue;
                for (k = groups.length - 1; k >= 0; k--) {
                    var d = L.duplicate();
                    d.name = d.property("ADBE Root Vectors Group").property(groups[k]).name;
                    for (j = groups.length - 1; j >= 0; j--) { if (j !== k) d.property("ADBE Root Vectors Group").property(groups[j]).remove(); }
                    d.moveBefore(L);
                    centerShapeAnchor(d, c.time);
                    made++;
                }
                L.enabled = false; L.name = L.name + " (original)"; L.shy = true;
            }
            app.endUndoGroup();
            if (!made) return TRV.fail("Nothing to split: the selected shape layers have fewer than two groups.");
            return TRV.ok({ stats: { layers: made } });
        } catch (e) { try { app.endUndoGroup(); } catch (e2) {} return TRV.fail(e.message + (e.line ? " (ae.jsx:" + e.line + ")" : "")); }
    };
    function centerShapeAnchor(layer, t) {
        try {
            var r = layer.sourceRectAtTime(t, false), tr = layer.property("ADBE Transform Group");
            var a = tr.property("ADBE Anchor Point").value, p = tr.property("ADBE Position").value, s = tr.property("ADBE Scale").value, rot = tr.property("ADBE Rotate Z").value * Math.PI / 180;
            var na = [r.left + r.width / 2, r.top + r.height / 2], dx = (na[0] - a[0]) * s[0] / 100, dy = (na[1] - a[1]) * s[1] / 100;
            if (tr.property("ADBE Anchor Point").numKeys || tr.property("ADBE Position").numKeys) return;
            tr.property("ADBE Anchor Point").setValue(na);
            tr.property("ADBE Position").setValue([p[0] + dx * Math.cos(rot) - dy * Math.sin(rot), p[1] + dx * Math.sin(rot) + dy * Math.cos(rot)]);
        } catch (e) {}
    }
    TRV.aeCenterAnchors = function () {
        try {
            var c = activeComp(); if (!c) return TRV.fail("Open a composition first.");
            var sel = c.selectedLayers; if (!sel.length) return TRV.fail("Select layers first.");
            app.beginUndoGroup("Traverse: center anchors");
            for (var i = 0; i < sel.length; i++) centerShapeAnchor(sel[i], c.time);
            app.endUndoGroup();
            return TRV.ok({ stats: { layers: sel.length } });
        } catch (e) { try { app.endUndoGroup(); } catch (e2) {} return TRV.fail(e.message); }
    };
})();
