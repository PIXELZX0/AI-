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
      active: "",
      selectedLayers: 0
    };

    if (isAfterEffects() && app.project) {
      summary.items = app.project.numItems || 0;
      summary.active = app.project.activeItem ? app.project.activeItem.name : "";
      if (app.project.activeItem instanceof CompItem) {
        summary.selectedLayers = app.project.activeItem.selectedLayers.length;
        summary.width = app.project.activeItem.width;
        summary.height = app.project.activeItem.height;
        summary.duration = app.project.activeItem.duration;
        summary.frameRate = app.project.activeItem.frameRate;
      }
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

  function inspectComposition(args) {
    var comp = activeAeComp();
    var layers = [];
    var selected = comp.selectedLayers;
    var maxLayers = args && args.maxLayers ? args.maxLayers : Math.min(comp.numLayers, 80);
    var i;

    for (i = 1; i <= maxLayers; i += 1) {
      var layer = comp.layer(i);
      var transform = layer.property("Transform");
      var opacity = transform ? transform.property("Opacity") : null;
      var position = transform ? transform.property("Position") : null;
      layers.push({
        index: i,
        name: layer.name,
        selected: layer.selected,
        enabled: layer.enabled,
        type: layer.matchName || "",
        inPoint: layer.inPoint,
        outPoint: layer.outPoint,
        hasOpacityKeys: opacity ? opacity.numKeys > 0 : false,
        hasPositionKeys: position ? position.numKeys > 0 : false
      });
    }

    return {
      message: "Inspected comp: " + comp.name + " (" + selected.length + " selected layer(s)).",
      comp: {
        name: comp.name,
        width: comp.width,
        height: comp.height,
        duration: comp.duration,
        frameRate: comp.frameRate,
        layerCount: comp.numLayers,
        selectedLayers: selected.length,
        layers: layers
      }
    };
  }

  function pad(value) {
    value = String(value);
    return value.length < 2 ? "0" + value : value;
  }

  function safeFileName(value) {
    return String(value || "AIPlus")
      .replace(/[\\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, "_");
  }

  function ensureFolder(path) {
    var folder = new Folder(path);
    if (!folder.exists && !folder.create()) {
      throw new Error("Unable to create folder: " + path);
    }
    return folder;
  }

  function createCheckpoint(args) {
    if (!isAfterEffects()) {
      return {
        message: "Checkpoints are currently available in After Effects.",
        skipped: true
      };
    }

    if (!app.project || !app.project.file) {
      return {
        message: "Save the After Effects project once to enable checkpoints.",
        skipped: true
      };
    }

    app.project.save();

    var assetsFolder = ensureFolder(app.project.file.parent.fsName + "/AI+ Assets");
    var checkpointFolder = ensureFolder(assetsFolder.fsName + "/checkpoints");
    var now = new Date();
    var stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + "_" + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
    var label = args && args.label ? args.label : "AI+ checkpoint";
    var target = new File(checkpointFolder.fsName + "/" + safeFileName(label) + "_" + stamp + ".aep");

    if (!app.project.file.copy(target.fsName)) {
      throw new Error("Unable to copy project checkpoint.");
    }

    return {
      message: "Checkpoint saved: " + target.name,
      label: label,
      path: target.fsName
    };
  }

  function restoreCheckpoint(args) {
    var path = args && args.path ? args.path : "";
    if (!path) {
      throw new Error("Checkpoint path is required.");
    }

    var file = new File(path);
    if (!file.exists) {
      throw new Error("Checkpoint file does not exist: " + path);
    }

    app.open(file);
    return {
      message: "Restored checkpoint: " + file.name,
      path: file.fsName
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

  function createShapeGrid(args) {
    var comp = activeAeComp();
    var count = Math.max(1, Math.min(args.count || 5, 64));
    var columns = Math.max(1, Math.min(args.columns || count, count));
    var size = args.size || 120;
    var gap = args.gap || 24;
    var rows = Math.ceil(count / columns);
    var startX = comp.width / 2 - ((columns - 1) * (size + gap)) / 2;
    var startY = comp.height / 2 - ((rows - 1) * (size + gap)) / 2;
    var prefix = args.namePrefix || "Square";
    var i;

    for (i = 0; i < count; i += 1) {
      var layer = comp.layers.addShape();
      var group = layer.property("Contents").addProperty("ADBE Vector Group");
      var contents = group.property("Contents");
      var rect = contents.addProperty("ADBE Vector Shape - Rect");
      var fill = contents.addProperty("ADBE Vector Graphic - Fill");
      layer.name = prefix + " " + (i + 1);
      rect.property("Size").setValue([size, size]);
      fill.property("Color").setValue([
        0.9 - (i / Math.max(count - 1, 1)) * 0.35,
        0.12 + (i / Math.max(count - 1, 1)) * 0.28,
        0.12 + (i / Math.max(count - 1, 1)) * 0.5
      ]);
      layer.property("Transform").property("Position").setValue([
        startX + (i % columns) * (size + gap),
        startY + Math.floor(i / columns) * (size + gap)
      ]);
    }

    return {
      message: "Created " + count + " shape layer(s)."
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
      if (args.preferredFonts) {
        var fonts = String(args.preferredFonts).split(",");
        var j;
        for (j = 0; j < fonts.length; j += 1) {
          try {
            if (fonts[j].replace(/\s/g, "")) {
              doc.font = fonts[j].replace(/^\s+|\s+$/g, "");
              break;
            }
          } catch (fontError) {
          }
        }
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

  function cascadeReveal(args) {
    var comp = activeAeComp();
    var selected = comp.selectedLayers;
    var duration = args.duration || 0.45;
    var stagger = args.stagger || 0.12;
    var yOffset = args.yOffset || 32;
    var i;

    if (!selected.length) {
      throw new Error("Select at least one layer to animate.");
    }

    for (i = 0; i < selected.length; i += 1) {
      var layer = selected[i];
      var transform = layer.property("Transform");
      var opacity = transform.property("Opacity");
      var position = transform.property("Position");
      var finalPosition = position.value;
      var start = Math.max(comp.time, layer.inPoint) + i * stagger;
      var end = Math.min(start + duration, layer.outPoint);

      opacity.setValueAtTime(start, 0);
      opacity.setValueAtTime(end, 100);
      if (finalPosition instanceof Array && finalPosition.length >= 2) {
        position.setValueAtTime(start, [finalPosition[0], finalPosition[1] + yOffset]);
        position.setValueAtTime(end, finalPosition);
      }
    }

    return {
      message: "Added staggered reveal to " + selected.length + " layer(s)."
    };
  }

  function easeProperty(property) {
    if (!property || !property.numKeys || property.numKeys < 1 || !property.canVaryOverTime) {
      return 0;
    }

    var eased = 0;
    var i;
    for (i = 1; i <= property.numKeys; i += 1) {
      try {
        var value = property.keyValue(i);
        var dimensions = value instanceof Array ? value.length : 1;
        var easeIn = [];
        var easeOut = [];
        var d;
        for (d = 0; d < dimensions; d += 1) {
          easeIn.push(new KeyframeEase(0, 66));
          easeOut.push(new KeyframeEase(0, 66));
        }
        property.setTemporalEaseAtKey(i, easeIn, easeOut);
        property.setInterpolationTypeAtKey(i, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
        eased += 1;
      } catch (easeError) {
      }
    }
    return eased;
  }

  function applyEasyEase() {
    var comp = activeAeComp();
    var selected = comp.selectedLayers;
    var properties = ["Position", "Scale", "Rotation", "Opacity"];
    var eased = 0;
    var i;
    var j;

    if (!selected.length) {
      throw new Error("Select at least one layer with keyframes.");
    }

    for (i = 0; i < selected.length; i += 1) {
      var transform = selected[i].property("Transform");
      for (j = 0; j < properties.length; j += 1) {
        eased += easeProperty(transform.property(properties[j]));
      }
    }

    return {
      message: "Applied easy ease to " + eased + " keyframe(s)."
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

  function escapeExpressionString(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  }

  function createSliderRig(args) {
    var comp = activeAeComp();
    var selected = comp.selectedLayers;
    var control = comp.layers.addNull();
    var sliderName = args.sliderName || "Intensity";
    var targetProperty = String(args.targetProperty || "opacity").toLowerCase();
    var slider = control.Effects.addProperty("ADBE Slider Control");
    var i;

    control.name = args.name || "AI+ Control";
    control.property("Transform").property("Position").setValue([comp.width / 2, comp.height / 2]);
    slider.name = sliderName;
    slider.property("Slider").setValue(100);

    for (i = 0; i < selected.length; i += 1) {
      if (selected[i] === control) {
        continue;
      }
      if (targetProperty === "scale") {
        selected[i].property("Transform").property("Scale").expression =
          "s = thisComp.layer(\"" + escapeExpressionString(control.name) + "\").effect(\"" + escapeExpressionString(sliderName) + "\")(\"Slider\"); [s, s]";
      } else {
        selected[i].property("Transform").property("Opacity").expression =
          "thisComp.layer(\"" + escapeExpressionString(control.name) + "\").effect(\"" + escapeExpressionString(sliderName) + "\")(\"Slider\")";
      }
    }

    return {
      message: "Created slider rig: " + control.name
    };
  }

  function getTransformProperty(layer, propertyName) {
    var transform = layer.property("Transform");
    var name = String(propertyName || "position").toLowerCase();

    if (name === "scale") {
      return transform.property("Scale");
    }
    if (name === "rotation" || name === "rotate") {
      return transform.property("Rotation");
    }
    if (name === "opacity") {
      return transform.property("Opacity");
    }
    if (name === "anchor" || name === "anchor point") {
      return transform.property("Anchor Point");
    }
    return transform.property("Position");
  }

  function applyExpression(args) {
    var comp = activeAeComp();
    var selected = comp.selectedLayers;
    var expression = args.expression || "wiggle(2, 24)";
    var propertyName = args.property || "position";
    var count = 0;
    var i;

    if (!selected.length) {
      throw new Error("Select at least one layer for the expression.");
    }

    for (i = 0; i < selected.length; i += 1) {
      var property = getTransformProperty(selected[i], propertyName);
      if (property && property.canSetExpression) {
        property.expression = expression;
        count += 1;
      }
    }

    return {
      message: "Applied expression to " + count + " layer property/properties."
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

  function resetTransforms(args) {
    var comp = activeAeComp();
    var selected = comp.selectedLayers;
    var i;

    if (!selected.length) {
      throw new Error("Select layers before resetting transforms.");
    }

    for (i = 0; i < selected.length; i += 1) {
      var transform = selected[i].property("Transform");
      if (args.scale !== false) {
        transform.property("Scale").setValue([100, 100]);
      }
      if (args.rotation !== false) {
        transform.property("Rotation").setValue(0);
      }
      if (args.opacity) {
        transform.property("Opacity").setValue(100);
      }
      if (args.position) {
        transform.property("Position").setValue([comp.width / 2, comp.height / 2]);
      }
    }

    return {
      message: "Reset transforms on " + selected.length + " layer(s)."
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

  function findOrCreateAtomFolder() {
    return findOrCreateAeFolder("AI+ Assets");
  }

  function generateImageAsset(args) {
    var comp;
    var prompt = args.prompt || "AI+ image request";
    var duration = 4;

    if (!isAfterEffects()) {
      throw new Error("Image assets are currently available in After Effects.");
    }
    if (!app.project) {
      app.newProject();
    }

    if (app.project.activeItem instanceof CompItem) {
      comp = app.project.activeItem;
    } else {
      comp = app.project.items.addComp("AI+ Image Request", 1920, 1080, 1, duration, 30);
      comp.openInViewer();
    }

    var solid = comp.layers.addSolid([0.16, 0.02, 0.02], "AI+ Generated Image Placeholder", comp.width, comp.height, 1, Math.min(duration, comp.duration));
    var text = comp.layers.addText(prompt);
    var sourceText = text.property("Source Text");
    var doc = sourceText.value;
    doc.fontSize = Math.max(28, Math.round(comp.width / 42));
    doc.fillColor = [0.95, 0.95, 0.95];
    doc.justification = ParagraphJustification.CENTER_JUSTIFY;
    sourceText.setValue(doc);
    text.property("Transform").property("Position").setValue([comp.width / 2, comp.height / 2]);
    solid.moveAfter(text);

    return {
      message: "Prepared image asset request using " + (args.imageModel || "image model") + ".",
      prompt: prompt,
      ratio: args.ratio || "16:9"
    };
  }

  function importAttachmentAsset(args) {
    if (!isAfterEffects()) {
      throw new Error("Attachment import is currently available in After Effects.");
    }
    if (!app.project) {
      app.newProject();
    }

    var path = args.path || "";
    if (!path) {
      throw new Error("Attachment path is required.");
    }

    var file = new File(path);
    if (!file.exists) {
      throw new Error("Attachment file does not exist: " + path);
    }

    var options = new ImportOptions(file);
    var item = app.project.importFile(options);
    item.parentFolder = findOrCreateAtomFolder();

    return {
      message: "Imported attachment: " + item.name,
      itemName: item.name
    };
  }

  var commandMap = {
    getHostInfo: getHostInfo,
    summarizeProject: summarizeProject,
    inspectComposition: inspectComposition,
    createCheckpoint: createCheckpoint,
    restoreCheckpoint: restoreCheckpoint,
    createComposition: createComposition,
    createShapeGrid: createShapeGrid,
    addTextLayer: addTextLayer,
    applyTextStyle: applyTextStyle,
    addFadeInOut: addFadeInOut,
    cascadeReveal: cascadeReveal,
    applyEasyEase: applyEasyEase,
    addNullController: addNullController,
    createSliderRig: createSliderRig,
    applyExpression: applyExpression,
    normalizeLayerNames: normalizeLayerNames,
    resetTransforms: resetTransforms,
    organizeProject: organizeProject,
    addMarkers: addMarkers,
    queueRender: queueRender,
    generateImageAsset: generateImageAsset,
    importAttachmentAsset: importAttachmentAsset
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
