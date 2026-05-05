#targetengine "AIPlus"

var AIPlusHost = AIPlusHost || {};

(function () {
  function parseJson(value) {
    if (typeof JSON !== "undefined" && JSON.parse) {
      return JSON.parse(value);
    }
    return eval("(" + value + ")");
  }

  function stringify(value) {
    if (typeof JSON !== "undefined" && JSON.stringify) {
      return JSON.stringify(value);
    }
    return legacyStringify(value);
  }

  function legacyStringify(value) {
    var type = typeof value;
    var i;
    var parts;
    if (value === null) {
      return "null";
    }
    if (type === "number" || type === "boolean") {
      return String(value);
    }
    if (type === "string") {
      return "\"" + value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"";
    }
    if (value instanceof Array) {
      parts = [];
      for (i = 0; i < value.length; i += 1) {
        parts.push(legacyStringify(value[i]));
      }
      return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (i in value) {
      if (value.hasOwnProperty(i)) {
        parts.push(legacyStringify(i) + ":" + legacyStringify(value[i]));
      }
    }
    return "{" + parts.join(",") + "}";
  }

  function ok(value) {
    return stringify({
      ok: true,
      value: value
    });
  }

  function fail(error) {
    return stringify({
      ok: false,
      error: error && error.message ? error.message : String(error)
    });
  }

  function getHostKey() {
    var name = String(app.name || "").toLowerCase();
    if (name.indexOf("after effects") !== -1) {
      return "after-effects";
    }
    if (name.indexOf("premiere") !== -1) {
      return "premiere-pro";
    }
    return "unknown";
  }

  function getHostInfo() {
    return {
      appName: app.name || "Adobe",
      appVersion: app.version || "",
      host: getHostKey()
    };
  }

  function isAfterEffects() {
    return getHostKey() === "after-effects";
  }

  function isPremiere() {
    return getHostKey() === "premiere-pro";
  }

  function activeAeComp() {
    if (!isAfterEffects()) {
      throw new Error("This tool requires After Effects.");
    }
    if (!app.project) {
      throw new Error("No After Effects project is open.");
    }
    if (!(app.project.activeItem instanceof CompItem)) {
      throw new Error("Select or open a composition first.");
    }
    return app.project.activeItem;
  }

  function activePremiereSequence() {
    if (!isPremiere()) {
      throw new Error("This tool requires Premiere Pro.");
    }
    if (!app.project || !app.project.activeSequence) {
      throw new Error("No active Premiere Pro sequence found.");
    }
    return app.project.activeSequence;
  }

  function summarizeProject() {
    var summary = {
      host: getHostKey(),
      name: app.project && app.project.file ? app.project.file.name : "Untitled",
      items: 0,
      active: ""
    };

    if (isAfterEffects() && app.project) {
      summary.items = app.project.numItems || 0;
      summary.active = app.project.activeItem ? app.project.activeItem.name : "";
    }

    if (isPremiere() && app.project) {
      summary.active = app.project.activeSequence ? app.project.activeSequence.name : "";
      summary.items = app.project.rootItem ? app.project.rootItem.children.numItems : 0;
    }

    return {
      message: "Project summarized: " + summary.name,
      summary: summary
    };
  }

  function createComposition(args) {
    if (!isAfterEffects()) {
      throw new Error("Composition creation is currently available in After Effects.");
    }
    if (!app.project) {
      app.newProject();
    }

    var name = args.name || "AI+ Composition";
    var width = args.width || 1920;
    var height = args.height || 1080;
    var pixelAspect = args.pixelAspect || 1;
    var duration = args.duration || 8;
    var frameRate = args.frameRate || 30;
    var comp = app.project.items.addComp(name, width, height, pixelAspect, duration, frameRate);
    comp.openInViewer();

    return {
      message: "Created composition: " + comp.name,
      compName: comp.name
    };
  }

  function addTextLayer(args) {
    var comp = activeAeComp();
    var layer = comp.layers.addText(args.text || "AI+");
    var duration = args.duration || Math.min(4, comp.duration);
    layer.inPoint = comp.time;
    layer.outPoint = Math.min(comp.duration, comp.time + duration);

    if (args.position === "center") {
      layer.property("Transform").property("Position").setValue([comp.width / 2, comp.height / 2]);
    }

    return {
      message: "Added text layer: " + layer.name,
      layerName: layer.name
    };
  }

  function applyTextStyle(args) {
    var comp = activeAeComp();
    var selected = comp.selectedLayers;
    var count = 0;
    var i;

    for (i = 0; i < selected.length; i += 1) {
      var layer = selected[i];
      var sourceText = layer.property("Source Text");
      if (!sourceText) {
        continue;
      }

      var doc = sourceText.value;
      if (args.fontSize) {
        doc.fontSize = args.fontSize;
      }
      if (args.fillColor) {
        doc.fillColor = args.fillColor;
      }
      if (args.justify === "center") {
        doc.justification = ParagraphJustification.CENTER_JUSTIFY;
      }
      sourceText.setValue(doc);
      count += 1;
    }

    if (!count) {
      throw new Error("Select at least one text layer to style.");
    }

    return {
      message: "Styled " + count + " text layer(s)."
    };
  }

  function addFadeInOut(args) {
    var comp = activeAeComp();
    var selected = comp.selectedLayers;
    var fadeIn = args.fadeIn || 0.5;
    var fadeOut = args.fadeOut || 0.75;
    var i;

    if (!selected.length) {
      throw new Error("Select at least one layer to animate.");
    }

    for (i = 0; i < selected.length; i += 1) {
      var layer = selected[i];
      var opacity = layer.property("Transform").property("Opacity");
      var start = layer.inPoint;
      var end = layer.outPoint;
      opacity.setValueAtTime(start, 0);
      opacity.setValueAtTime(Math.min(start + fadeIn, end), 100);
      opacity.setValueAtTime(Math.max(end - fadeOut, start), 100);
      opacity.setValueAtTime(end, 0);
    }

    return {
      message: "Added fade animation to " + selected.length + " layer(s)."
    };
  }

  function addNullController(args) {
    var comp = activeAeComp();
    var selected = comp.selectedLayers;
    var control = comp.layers.addNull();
    var i;
    control.name = args.name || "AI+ Control";
    control.property("Transform").property("Position").setValue([comp.width / 2, comp.height / 2]);

    for (i = 0; i < selected.length; i += 1) {
      selected[i].parent = control;
    }

    return {
      message: "Created null controller: " + control.name
    };
  }

  function normalizeLayerNames(args) {
    var comp = activeAeComp();
    var selected = comp.selectedLayers;
    var prefix = args.prefix || "AI+ Layer";
    var i;

    if (!selected.length) {
      throw new Error("Select layers before renaming.");
    }

    for (i = 0; i < selected.length; i += 1) {
      selected[i].name = prefix + " " + (i + 1);
    }

    return {
      message: "Renamed " + selected.length + " layer(s)."
    };
  }

  function findOrCreateAeFolder(name) {
    var i;
    for (i = 1; i <= app.project.numItems; i += 1) {
      if (app.project.item(i) instanceof FolderItem && app.project.item(i).name === name) {
        return app.project.item(i);
      }
    }
    return app.project.items.addFolder(name);
  }

  function organizeAeProject() {
    if (!app.project) {
      app.newProject();
    }

    var folders = {
      comps: findOrCreateAeFolder("01 Comps"),
      footage: findOrCreateAeFolder("02 Footage"),
      audio: findOrCreateAeFolder("03 Audio"),
      exports: findOrCreateAeFolder("04 Exports")
    };
    var moved = 0;
    var i;

    for (i = 1; i <= app.project.numItems; i += 1) {
      var item = app.project.item(i);
      if (item instanceof FolderItem || item.parentFolder === folders.comps || item.parentFolder === folders.footage || item.parentFolder === folders.audio) {
        continue;
      }

      if (item instanceof CompItem) {
        item.parentFolder = folders.comps;
        moved += 1;
      } else if (item instanceof FootageItem) {
        if (item.hasAudio && !item.hasVideo) {
          item.parentFolder = folders.audio;
        } else {
          item.parentFolder = folders.footage;
        }
        moved += 1;
      }
    }

    return {
      message: "Organized After Effects project; moved " + moved + " item(s)."
    };
  }

  function organizePremiereProject() {
    if (!app.project || !app.project.rootItem) {
      throw new Error("No Premiere Pro project is open.");
    }

    var root = app.project.rootItem;
    var bins = ["01 Sequences", "02 Video", "03 Audio", "04 Graphics", "05 Exports"];
    var created = 0;
    var i;

    for (i = 0; i < bins.length; i += 1) {
      root.createBin(bins[i]);
      created += 1;
    }

    return {
      message: "Created " + created + " Premiere Pro bin(s)."
    };
  }

  function organizeProject() {
    if (isAfterEffects()) {
      return organizeAeProject();
    }
    if (isPremiere()) {
      return organizePremiereProject();
    }
    throw new Error("Unsupported Adobe host.");
  }

  function addAeMarkers(args) {
    var comp = activeAeComp();
    var markers = args.markers || [];
    var i;

    for (i = 0; i < markers.length; i += 1) {
      var marker = new MarkerValue(markers[i].label || "AI+ marker");
      comp.markerProperty.setValueAtTime(markers[i].time || 0, marker);
    }

    return {
      message: "Added " + markers.length + " composition marker(s)."
    };
  }

  function addPremiereMarkers(args) {
    var sequence = activePremiereSequence();
    var markers = args.markers || [];
    var i;

    for (i = 0; i < markers.length; i += 1) {
      var marker = sequence.markers.createMarker(markers[i].time || 0);
      marker.name = markers[i].label || "AI+ marker";
    }

    return {
      message: "Added " + markers.length + " sequence marker(s)."
    };
  }

  function addMarkers(args) {
    if (isAfterEffects()) {
      return addAeMarkers(args);
    }
    if (isPremiere()) {
      return addPremiereMarkers(args);
    }
    throw new Error("Unsupported Adobe host.");
  }

  function queueAeRender() {
    var comp = activeAeComp();
    var item = app.project.renderQueue.items.add(comp);
    return {
      message: "Queued render for " + comp.name + ".",
      renderQueueIndex: item.index
    };
  }

  function queuePremiereRender() {
    var sequence = activePremiereSequence();
    return {
      message: "Premiere Pro export requires an encoder preset path; active sequence is " + sequence.name + "."
    };
  }

  function queueRender() {
    if (isAfterEffects()) {
      return queueAeRender();
    }
    if (isPremiere()) {
      return queuePremiereRender();
    }
    throw new Error("Unsupported Adobe host.");
  }

  var commandMap = {
    getHostInfo: getHostInfo,
    summarizeProject: summarizeProject,
    createComposition: createComposition,
    addTextLayer: addTextLayer,
    applyTextStyle: applyTextStyle,
    addFadeInOut: addFadeInOut,
    addNullController: addNullController,
    normalizeLayerNames: normalizeLayerNames,
    organizeProject: organizeProject,
    addMarkers: addMarkers,
    queueRender: queueRender
  };

  function executePlan(payload) {
    var actions = payload.actions || [];
    var results = [];
    var i;

    if (isAfterEffects() && app.beginUndoGroup) {
      app.beginUndoGroup("AI+ plan");
    }

    try {
      for (i = 0; i < actions.length; i += 1) {
        var action = actions[i];
        try {
          if (!commandMap[action.tool]) {
            throw new Error("Unknown tool: " + action.tool);
          }
          var result = commandMap[action.tool](action.args || {});
          results.push({
            ok: true,
            tool: action.tool,
            message: result.message || action.tool,
            value: result
          });
        } catch (toolError) {
          results.push({
            ok: false,
            tool: action.tool,
            message: toolError && toolError.message ? toolError.message : String(toolError)
          });
        }
      }
    } finally {
      if (isAfterEffects() && app.endUndoGroup) {
        app.endUndoGroup();
      }
    }

    return {
      results: results
    };
  }

  AIPlusHost.run = function (requestJson) {
    try {
      var request = parseJson(requestJson);
      var command = request.command;
      var payload = request.payload || {};

      if (command === "executePlan") {
        return ok(executePlan(payload));
      }

      if (!commandMap[command]) {
        throw new Error("Unknown command: " + command);
      }

      return ok(commandMap[command](payload));
    } catch (error) {
      return fail(error);
    }
  };
})();
