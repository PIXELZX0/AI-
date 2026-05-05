(function () {
  "use strict";

  var root = window.AIPlus || (window.AIPlus = {});

  var tools = [
    {
      id: "summarizeProject",
      label: "Project summary",
      description: "Read the active Adobe project or document and return editable context.",
      hosts: ["after-effects", "premiere-pro", "illustrator", "preview"],
      risk: "read"
    },
    {
      id: "inspectComposition",
      label: "Inspect comp",
      description: "Read layers, properties, expressions, markers, and selection from the active comp.",
      hosts: ["after-effects", "preview"],
      risk: "read"
    },
    {
      id: "inspectIllustratorDocument",
      label: "Inspect Illustrator",
      description: "Read artboards, layers, page items, and selection from the active Illustrator document.",
      hosts: ["illustrator", "preview"],
      risk: "read"
    },
    {
      id: "createIllustratorDocument",
      label: "Create Illustrator document",
      description: "Create a new Illustrator document with a safe artboard size and color space.",
      hosts: ["illustrator", "preview"],
      risk: "write"
    },
    {
      id: "createCheckpoint",
      label: "Create checkpoint",
      description: "Save a restorable project checkpoint before or after automation.",
      hosts: ["after-effects", "preview"],
      risk: "write"
    },
    {
      id: "restoreCheckpoint",
      label: "Restore checkpoint",
      description: "Open a saved After Effects project checkpoint.",
      hosts: ["after-effects", "preview"],
      risk: "destructive"
    },
    {
      id: "createComposition",
      label: "Create composition",
      description: "Create a new After Effects composition with safe defaults.",
      hosts: ["after-effects", "preview"],
      risk: "write"
    },
    {
      id: "createShapeGrid",
      label: "Create shape grid",
      description: "Create square shape layers with names, layout, and optional color range.",
      hosts: ["after-effects", "preview"],
      risk: "write"
    },
    {
      id: "createIllustratorShapeGrid",
      label: "Create vector grid",
      description: "Create editable Illustrator rectangle objects arranged on the active artboard.",
      hosts: ["illustrator", "preview"],
      risk: "write"
    },
    {
      id: "addTextLayer",
      label: "Add text",
      description: "Add editable text to the active composition.",
      hosts: ["after-effects", "preview"],
      risk: "write"
    },
    {
      id: "addIllustratorText",
      label: "Add Illustrator text",
      description: "Add editable text to the active Illustrator artboard.",
      hosts: ["illustrator", "preview"],
      risk: "write"
    },
    {
      id: "applyTextStyle",
      label: "Style text",
      description: "Apply font size, fill color, alignment, and preferred font to selected text.",
      hosts: ["after-effects", "preview"],
      risk: "write"
    },
    {
      id: "applyIllustratorTextStyle",
      label: "Style Illustrator text",
      description: "Apply font size, fill color, alignment, and preferred font to selected Illustrator text.",
      hosts: ["illustrator", "preview"],
      risk: "write"
    },
    {
      id: "addFadeInOut",
      label: "Fade animation",
      description: "Add opacity fade in and fade out keyframes to selected layers.",
      hosts: ["after-effects", "preview"],
      risk: "write"
    },
    {
      id: "cascadeReveal",
      label: "Cascade reveal",
      description: "Stagger opacity and position reveal keyframes across selected layers.",
      hosts: ["after-effects", "preview"],
      risk: "write"
    },
    {
      id: "applyEasyEase",
      label: "Easy ease",
      description: "Apply temporal ease to keyframes on selected layers.",
      hosts: ["after-effects", "preview"],
      risk: "write"
    },
    {
      id: "addNullController",
      label: "Control null",
      description: "Create a null layer for controlling selected layers.",
      hosts: ["after-effects", "preview"],
      risk: "write"
    },
    {
      id: "createSliderRig",
      label: "Slider rig",
      description: "Create a controller with slider controls and link selected layer properties.",
      hosts: ["after-effects", "preview"],
      risk: "write"
    },
    {
      id: "applyExpression",
      label: "Expression",
      description: "Apply a safe expression to a selected transform property.",
      hosts: ["after-effects", "preview"],
      risk: "write"
    },
    {
      id: "normalizeLayerNames",
      label: "Rename layers",
      description: "Rename selected layers with clean numbered labels.",
      hosts: ["after-effects", "preview"],
      risk: "write"
    },
    {
      id: "resetTransforms",
      label: "Reset transforms",
      description: "Reset scale, rotation, opacity, or position on selected layers.",
      hosts: ["after-effects", "preview"],
      risk: "write"
    },
    {
      id: "organizeProject",
      label: "Organize project",
      description: "Create bins, folders, or layers and move obvious items into them when supported.",
      hosts: ["after-effects", "premiere-pro", "illustrator", "preview"],
      risk: "write"
    },
    {
      id: "addMarkers",
      label: "Add markers",
      description: "Add review markers to the active comp or sequence.",
      hosts: ["after-effects", "premiere-pro", "preview"],
      risk: "write"
    },
    {
      id: "queueRender",
      label: "Queue export",
      description: "Queue or export the active composition, sequence, or document.",
      hosts: ["after-effects", "premiere-pro", "illustrator", "preview"],
      risk: "write"
    },
    {
      id: "normalizeIllustratorObjectNames",
      label: "Rename Illustrator objects",
      description: "Rename selected Illustrator objects with clean numbered labels.",
      hosts: ["illustrator", "preview"],
      risk: "write"
    },
    {
      id: "exportIllustratorPng",
      label: "Export Illustrator PNG",
      description: "Export the active Illustrator document to a PNG file.",
      hosts: ["illustrator", "preview"],
      risk: "write"
    },
    {
      id: "generateImageAsset",
      label: "Image asset",
      description: "Prepare an image-generation request and auto-import or place a generated or placeholder asset.",
      hosts: ["after-effects", "illustrator", "preview"],
      risk: "write"
    },
    {
      id: "importAttachmentAsset",
      label: "Import attachment",
      description: "Import or place an attached local file into the active Adobe project or document.",
      hosts: ["after-effects", "illustrator", "preview"],
      risk: "write"
    }
  ];

  function findTool(id) {
    return tools.filter(function (tool) {
      return tool.id === id;
    })[0] || null;
  }

  function supportsHost(tool, host) {
    return Boolean(tool && tool.hosts.indexOf(host) !== -1);
  }

  function toolsForHost(host) {
    if (!host) {
      return tools.slice();
    }

    return tools.filter(function (tool) {
      return supportsHost(tool, host);
    });
  }

  root.toolRegistry = {
    all: tools,
    find: findTool,
    supportsHost: supportsHost,
    toolsForHost: toolsForHost
  };
})();
