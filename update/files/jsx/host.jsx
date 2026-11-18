// Traverse - host loader. Loads the right engine for the running app.
(function () {
    var here = new File($.fileName).parent;
    if (typeof TRV === "undefined" || !TRV || TRV.__dev) { TRV = {}; }
    TRV.root = here.parent.fsName;
    $.evalFile(new File(here.fsName + "/common.jsx"));
    if (BridgeTalk.appName === "illustrator") {
        $.evalFile(new File(here.fsName + "/ai.jsx"));
    } else if (BridgeTalk.appName === "aftereffects") {
        $.evalFile(new File(here.fsName + "/ae.jsx"));
    }
})();
