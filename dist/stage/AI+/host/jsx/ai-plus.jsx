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
    if (name.indexOf("illustrator") !== -1) {
      return "illustrator";
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

  function isIllustrator() {
    return getHostKey() === "illustrator";
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

  function activeIllustratorDocument() {
    if (!isIllustrator()) {
      throw new Error("This tool requires Illustrator.");
    }
    if (!app.documents || app.documents.length < 1) {
      throw new Error("No Illustrator document is open.");
    }
    return app.activeDocument;
  }

  function getIllustratorDocumentName(doc) {
    try {
      return doc.name || "Untitled";
    } catch (nameError) {
      return "Untitled";
    }
  }

  function getIllustratorArtboardBounds(doc) {
    var index = 0;
    var rect;

    try {
      index = doc.artboards.getActiveArtboardIndex();
    } catch (indexError) {
      index = 0;
    }

    rect = doc.artboards[index].artboardRect;
    return {
      index: index,
      left: rect[0],
      top: rect[1],
      right: rect[2],
      bottom: rect[3],
      width: rect[2] - rect[0],
      height: rect[1] - rect[3]
    };
  }

  function illustratorArtboardSummary(doc, index) {
    var artboard = doc.artboards[index];
    var rect = artboard.artboardRect;
    return {
      index: index + 1,
      name: artboard.name || "Artboard " + (index + 1),
      left: rect[0],
      top: rect[1],
      width: rect[2] - rect[0],
      height: rect[1] - rect[3]
    };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function colorChannel(value) {
    var number = Number(value);
    if (isNaN(number)) {
      return 0;
    }
    if (number >= 0 && number <= 1) {
      return clamp(Math.round(number * 255), 0, 255);
    }
    return clamp(Math.round(number), 0, 255);
  }

  function illustratorRgbColor(value, fallback) {
    var source = value || fallback || [44, 116, 179];
    var color = new RGBColor();

    if (source instanceof Array) {
      color.red = colorChannel(source[0]);
      color.green = colorChannel(source[1]);
      color.blue = colorChannel(source[2]);
      return color;
    }

    color.red = colorChannel(source.red);
    color.green = colorChannel(source.green);
    color.blue = colorChannel(source.blue);
    return color;
  }

  function findIllustratorLayer(doc, name) {
    var i;
    for (i = 0; i < doc.layers.length; i += 1) {
      if (doc.layers[i].name === name) {
        return doc.layers[i];
      }
    }
    return null;
  }

  function findOrCreateIllustratorLayer(doc, name) {
    var layer = findIllustratorLayer(doc, name);
    if (layer) {
      return layer;
    }
    layer = doc.layers.add();
    layer.name = name;
    return layer;
  }

  function ensureIllustratorDocument(args) {
    if (app.documents && app.documents.length > 0) {
      return app.activeDocument;
    }
    createIllustratorDocument(args || {});
    return app.activeDocument;
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

    if (isIllustrator() && app.documents && app.documents.length > 0) {
      var doc = app.activeDocument;
      var artboard = getIllustratorArtboardBounds(doc);
      summary.name = getIllustratorDocumentName(doc);
      summary.items = doc.pageItems ? doc.pageItems.length : 0;
      summary.active = doc.artboards && doc.artboards.length ? doc.artboards[artboard.index].name : "";
      summary.selectedLayers = doc.selection ? doc.selection.length : 0;
      summary.layers = doc.layers ? doc.layers.length : 0;
      summary.artboards = doc.artboards ? doc.artboards.length : 0;
      summary.width = artboard.width;
      summary.height = artboard.height;
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

  function inspectIllustratorDocument(args) {
    var doc = activeIllustratorDocument();
    var artboards = [];
    var layers = [];
    var selectedItems = [];
    var selection = doc.selection || [];
    var maxItems = Math.max(1, Math.min(args && args.maxItems ? args.maxItems : 80, 200));
    var maxLayers = Math.max(1, Math.min(args && args.maxLayers ? args.maxLayers : 80, 200));
    var i;

    for (i = 0; i < doc.artboards.length; i += 1) {
      artboards.push(illustratorArtboardSummary(doc, i));
    }

    for (i = 0; i < doc.layers.length && i < maxLayers; i += 1) {
      layers.push({
        index: i + 1,
        name: doc.layers[i].name,
        visible: doc.layers[i].visible,
        locked: doc.layers[i].locked,
        pageItems: doc.layers[i].pageItems ? doc.layers[i].pageItems.length : 0
      });
    }

    for (i = 0; i < selection.length && i < maxItems; i += 1) {
      selectedItems.push({
        index: i + 1,
        name: selection[i].name || "",
        type: selection[i].typename || "",
        locked: selection[i].locked || false,
        hidden: selection[i].hidden || false,
        width: selection[i].width || 0,
        height: selection[i].height || 0
      });
    }

    return {
      message: "Inspected Illustrator document: " + getIllustratorDocumentName(doc) + " (" + selection.length + " selected item(s)).",
      document: {
        name: getIllustratorDocumentName(doc),
        colorSpace: String(doc.documentColorSpace || ""),
        artboardCount: doc.artboards.length,
        layerCount: doc.layers.length,
        pageItemCount: doc.pageItems ? doc.pageItems.length : 0,
        selectedItems: selection.length,
        artboards: artboards,
        layers: layers,
        selection: selectedItems
      }
    };
  }

  function createIllustratorDocument(args) {
    var name = args && args.name ? args.name : "AI+ Illustrator Document";
    var width = Math.max(1, Number(args && args.width ? args.width : 1080));
    var height = Math.max(1, Number(args && args.height ? args.height : 1080));
    var colorSpaceName = String(args && args.colorSpace ? args.colorSpace : "rgb").toLowerCase();
    var colorSpace = colorSpaceName === "cmyk" ? DocumentColorSpace.CMYK : DocumentColorSpace.RGB;
    var doc = app.documents.add(colorSpace, width, height);

    try {
      doc.artboards[0].name = name;
    } catch (artboardNameError) {
    }

    try {
      doc.activeLayer.name = "01 Artwork";
    } catch (layerNameError) {
    }

    return {
      message: "Created Illustrator document: " + name,
      documentName: getIllustratorDocumentName(doc),
      artboardName: name,
      width: width,
      height: height,
      colorSpace: colorSpaceName === "cmyk" ? "CMYK" : "RGB"
    };
  }

  function createIllustratorShapeGrid(args) {
    var doc = ensureIllustratorDocument({
      name: "AI+ Shapes",
      width: args && args.documentWidth ? args.documentWidth : 1080,
      height: args && args.documentHeight ? args.documentHeight : 1080
    });
    var artboard = getIllustratorArtboardBounds(doc);
    var count = Math.max(1, Math.min(Number(args && args.count ? args.count : 6), 64));
    var columns = Math.max(1, Math.min(Number(args && args.columns ? args.columns : count), count));
    var rows = Math.ceil(count / columns);
    var size = Math.max(4, Number(args && args.size ? args.size : Math.min(140, artboard.width / Math.max(columns + 1, 2))));
    var gap = Math.max(0, Number(args && args.gap ? args.gap : Math.round(size * 0.18)));
    var totalWidth = columns * size + (columns - 1) * gap;
    var totalHeight = rows * size + (rows - 1) * gap;
    var startLeft = artboard.left + (artboard.width - totalWidth) / 2;
    var startTop = artboard.top - (artboard.height - totalHeight) / 2;
    var prefix = args && args.namePrefix ? args.namePrefix : "AI+ Shape";
    var layer = findOrCreateIllustratorLayer(doc, args && args.layerName ? args.layerName : "AI+ Shapes");
    var created = 0;
    var i;

    doc.activeLayer = layer;

    for (i = 0; i < count; i += 1) {
      var ratio = count > 1 ? i / (count - 1) : 0;
      var row = Math.floor(i / columns);
      var column = i % columns;
      var rect = doc.pathItems.rectangle(
        startTop - row * (size + gap),
        startLeft + column * (size + gap),
        size,
        size
      );

      rect.name = prefix + " " + (i + 1);
      rect.filled = true;
      rect.fillColor = args && args.fillColor
        ? illustratorRgbColor(args.fillColor, [230, 68, 88])
        : illustratorRgbColor([230 - ratio * 86, 68 + ratio * 78, 88 + ratio * 112]);
      rect.stroked = !(args && args.stroke === false);
      if (rect.stroked) {
        rect.strokeWidth = Number(args && args.strokeWidth ? args.strokeWidth : 1);
        rect.strokeColor = illustratorRgbColor(args && args.strokeColor ? args.strokeColor : [24, 30, 38]);
      }
      created += 1;
    }

    return {
      message: "Created " + created + " Illustrator shape(s).",
      count: created
    };
  }

  function styleIllustratorTextFrame(textFrame, args) {
    var attributes = textFrame.textRange.characterAttributes;
    var fonts;
    var i;

    if (args && args.fontSize) {
      attributes.size = Number(args.fontSize);
    }
    if (args && args.fillColor) {
      attributes.fillColor = illustratorRgbColor(args.fillColor, [28, 31, 36]);
    }
    if (args && args.preferredFonts) {
      fonts = String(args.preferredFonts).split(",");
      for (i = 0; i < fonts.length; i += 1) {
        try {
          if (fonts[i].replace(/\s/g, "")) {
            attributes.textFont = app.textFonts.getByName(fonts[i].replace(/^\s+|\s+$/g, ""));
            break;
          }
        } catch (fontError) {
        }
      }
    }
    if (args && args.justify === "center") {
      try {
        textFrame.textRange.paragraphAttributes.justification = Justification.CENTER;
      } catch (justifyError) {
      }
    }
  }

  function addIllustratorText(args) {
    var doc = ensureIllustratorDocument({
      name: "AI+ Text",
      width: args && args.documentWidth ? args.documentWidth : 1080,
      height: args && args.documentHeight ? args.documentHeight : 1080
    });
    var artboard = getIllustratorArtboardBounds(doc);
    var layer = findOrCreateIllustratorLayer(doc, args && args.layerName ? args.layerName : "AI+ Text");
    var text;
    var fontSize = args && args.fontSize ? args.fontSize : Math.max(24, Math.round(artboard.width / 16));

    doc.activeLayer = layer;
    text = doc.textFrames.add();
    text.contents = args && args.text ? args.text : "AI+";
    text.name = args && args.name ? args.name : "AI+ Text";
    styleIllustratorTextFrame(text, {
      fontSize: fontSize,
      fillColor: args && args.fillColor ? args.fillColor : [28, 31, 36],
      justify: args && args.justify ? args.justify : "center",
      preferredFonts: args && args.preferredFonts ? args.preferredFonts : ""
    });

    if (args && args.x !== undefined && args.y !== undefined) {
      text.position = [Number(args.x), Number(args.y)];
    } else {
      text.position = [
        artboard.left + artboard.width / 2 - text.width / 2,
        artboard.top - artboard.height / 2 + text.height / 2
      ];
    }

    return {
      message: "Added Illustrator text: " + text.contents,
      itemName: text.name
    };
  }

  function applyIllustratorTextStyle(args) {
    var doc = activeIllustratorDocument();
    var selection = doc.selection || [];
    var count = 0;
    var i;

    if (!selection.length) {
      throw new Error("Select at least one Illustrator text object to style.");
    }

    for (i = 0; i < selection.length; i += 1) {
      if (selection[i].typename === "TextFrame" || selection[i].textRange) {
        styleIllustratorTextFrame(selection[i], args || {});
        count += 1;
      }
    }

    if (!count) {
      throw new Error("Selection does not contain editable Illustrator text.");
    }

    return {
      message: "Styled " + count + " Illustrator text object(s)."
    };
  }

  function normalizeIllustratorObjectNames(args) {
    var doc = activeIllustratorDocument();
    var selection = doc.selection || [];
    var prefix = args && args.prefix ? args.prefix : "AI+ Object";
    var i;

    if (!selection.length) {
      throw new Error("Select Illustrator objects before renaming.");
    }

    for (i = 0; i < selection.length; i += 1) {
      selection[i].name = prefix + " " + (i + 1);
    }

    return {
      message: "Renamed " + selection.length + " Illustrator object(s)."
    };
  }

  function organizeIllustratorDocument() {
    var doc = ensureIllustratorDocument({
      name: "AI+ Illustrator Document",
      width: 1080,
      height: 1080
    });
    var layers = ["01 Artwork", "02 Text", "03 Reference", "04 Exports"];
    var created = 0;
    var i;

    for (i = 0; i < layers.length; i += 1) {
      if (!findIllustratorLayer(doc, layers[i])) {
        findOrCreateIllustratorLayer(doc, layers[i]);
        created += 1;
      }
    }

    return {
      message: "Prepared Illustrator document layers; created " + created + " layer(s)."
    };
  }

  function generateIllustratorImageAsset(args) {
    var doc = ensureIllustratorDocument({
      name: "AI+ Image Asset",
      width: 1080,
      height: 1080
    });
    var artboard = getIllustratorArtboardBounds(doc);
    var layer = findOrCreateIllustratorLayer(doc, "AI+ Reference");
    var ratio = String(args && args.ratio ? args.ratio : "1:1");
    var prompt = args && args.prompt ? args.prompt : "AI+ image request";
    var boxWidth = artboard.width * 0.72;
    var boxHeight = ratio === "16:9" ? boxWidth * 9 / 16 : ratio === "9:16" ? boxWidth * 16 / 9 : boxWidth;
    var left = artboard.left + (artboard.width - boxWidth) / 2;
    var top = artboard.top - (artboard.height - boxHeight) / 2;
    var rect;
    var label;

    if (boxHeight > artboard.height * 0.72) {
      boxHeight = artboard.height * 0.72;
      boxWidth = ratio === "9:16" ? boxHeight * 9 / 16 : boxWidth;
      left = artboard.left + (artboard.width - boxWidth) / 2;
      top = artboard.top - (artboard.height - boxHeight) / 2;
    }

    doc.activeLayer = layer;
    rect = doc.pathItems.rectangle(top, left, boxWidth, boxHeight);
    rect.name = "AI+ Image Placeholder";
    rect.filled = true;
    rect.fillColor = illustratorRgbColor([242, 245, 248]);
    rect.stroked = true;
    rect.strokeWidth = 2;
    rect.strokeColor = illustratorRgbColor([44, 116, 179]);

    label = doc.textFrames.add();
    label.contents = prompt;
    label.name = "AI+ Image Prompt";
    styleIllustratorTextFrame(label, {
      fontSize: Math.max(14, Math.round(artboard.width / 42)),
      fillColor: [28, 31, 36],
      justify: "center"
    });
    label.position = [
      left + boxWidth / 2 - label.width / 2,
      top - boxHeight / 2 + label.height / 2
    ];

    return {
      message: "Prepared Illustrator image asset request using " + (args && args.imageModel ? args.imageModel : "image model") + ".",
      prompt: prompt,
      ratio: ratio
    };
  }

  function importIllustratorAttachmentAsset(args) {
    var doc = ensureIllustratorDocument({
      name: "AI+ Imported Asset",
      width: 1080,
      height: 1080
    });
    var path = args && args.path ? args.path : "";
    var file;
    var artboard;
    var placed;
    var scale;

    if (!path) {
      throw new Error("Attachment path is required.");
    }

    file = new File(path);
    if (!file.exists) {
      throw new Error("Attachment file does not exist: " + path);
    }

    artboard = getIllustratorArtboardBounds(doc);
    doc.activeLayer = findOrCreateIllustratorLayer(doc, "AI+ Reference");
    placed = doc.placedItems.add();
    placed.file = file;
    placed.name = file.name;

    if (placed.width && placed.height) {
      scale = Math.min((artboard.width * 0.82) / placed.width, (artboard.height * 0.82) / placed.height, 1);
      placed.width = placed.width * scale;
      placed.height = placed.height * scale;
    }

    placed.position = [
      artboard.left + artboard.width / 2 - placed.width / 2,
      artboard.top - artboard.height / 2 + placed.height / 2
    ];

    return {
      message: "Placed Illustrator attachment: " + file.name,
      itemName: placed.name
    };
  }

  function exportIllustratorPng(args) {
    var doc = activeIllustratorDocument();
    var path = args && args.path ? args.path : "";
    var file;
    var folder;
    var options;
    var scale = Number(args && args.scale ? args.scale : 100);

    if (!path) {
      try {
        folder = ensureFolder(doc.fullName.parent.fsName + "/AI+ Exports");
      } catch (savedPathError) {
        folder = ensureFolder(Folder.desktop.fsName + "/AI+ Exports");
      }
      path = folder.fsName + "/" + safeFileName(getIllustratorDocumentName(doc).replace(/\.[^\.]+$/, "")) + ".png";
    }

    file = new File(path);
    if (file.parent && !file.parent.exists) {
      file.parent.create();
    }

    options = new ExportOptionsPNG24();
    options.artBoardClipping = !(args && args.artBoardClipping === false);
    options.transparency = !(args && args.transparency === false);
    options.antiAliasing = true;
    options.horizontalScale = scale;
    options.verticalScale = scale;

    doc.exportFile(file, ExportType.PNG24, options);

    return {
      message: "Exported Illustrator PNG: " + file.name,
      path: file.fsName
    };
  }

  function organizeProject() {
    if (isAfterEffects()) {
      return organizeAeProject();
    }
    if (isPremiere()) {
      return organizePremiereProject();
    }
    if (isIllustrator()) {
      return organizeIllustratorDocument();
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

  function queueRender(args) {
    if (isAfterEffects()) {
      return queueAeRender();
    }
    if (isPremiere()) {
      return queuePremiereRender();
    }
    if (isIllustrator()) {
      return exportIllustratorPng(args || {});
    }
    throw new Error("Unsupported Adobe host.");
  }

  function findOrCreateAIPlusFolder() {
    return findOrCreateAeFolder("AI+ Assets");
  }

  function generateImageAsset(args) {
    var comp;
    var prompt = args.prompt || "AI+ image request";
    var duration = 4;

    if (isIllustrator()) {
      return generateIllustratorImageAsset(args || {});
    }

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
    if (isIllustrator()) {
      return importIllustratorAttachmentAsset(args || {});
    }

    if (!isAfterEffects()) {
      throw new Error("Attachment import is currently available in After Effects and Illustrator.");
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
    item.parentFolder = findOrCreateAIPlusFolder();

    return {
      message: "Imported attachment: " + item.name,
      itemName: item.name
    };
  }

  var commandMap = {
    getHostInfo: getHostInfo,
    summarizeProject: summarizeProject,
    inspectComposition: inspectComposition,
    inspectIllustratorDocument: inspectIllustratorDocument,
    createCheckpoint: createCheckpoint,
    restoreCheckpoint: restoreCheckpoint,
    createComposition: createComposition,
    createIllustratorDocument: createIllustratorDocument,
    createShapeGrid: createShapeGrid,
    createIllustratorShapeGrid: createIllustratorShapeGrid,
    addTextLayer: addTextLayer,
    addIllustratorText: addIllustratorText,
    applyTextStyle: applyTextStyle,
    applyIllustratorTextStyle: applyIllustratorTextStyle,
    addFadeInOut: addFadeInOut,
    cascadeReveal: cascadeReveal,
    applyEasyEase: applyEasyEase,
    addNullController: addNullController,
    createSliderRig: createSliderRig,
    applyExpression: applyExpression,
    normalizeLayerNames: normalizeLayerNames,
    normalizeIllustratorObjectNames: normalizeIllustratorObjectNames,
    resetTransforms: resetTransforms,
    organizeProject: organizeProject,
    addMarkers: addMarkers,
    queueRender: queueRender,
    exportIllustratorPng: exportIllustratorPng,
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
