"use strict";

const tools = [
  {
    id: "summarizeProject",
    label: "Project summary",
    description: "Read the active Adobe project and return editable context.",
    hosts: ["after-effects", "premiere-pro", "preview"],
    risk: "read"
  },
  {
    id: "createComposition",
    label: "Create composition",
    description: "Create a new After Effects composition with safe defaults.",
    hosts: ["after-effects", "preview"],
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
    id: "applyTextStyle",
    label: "Style text",
    description: "Apply font size, fill color, and alignment to selected text.",
    hosts: ["after-effects", "preview"],
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
    id: "addNullController",
    label: "Control null",
    description: "Create a null layer for controlling selected layers.",
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
    id: "organizeProject",
    label: "Organize project",
    description: "Create bins or folders and move obvious items into them.",
    hosts: ["after-effects", "premiere-pro", "preview"],
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
    description: "Queue the active composition or sequence for render/export.",
    hosts: ["after-effects", "premiere-pro", "preview"],
    risk: "write"
  }
];

function getToolIds() {
  return tools.map((tool) => tool.id);
}

function findTool(id) {
  return tools.find((tool) => tool.id === id) || null;
}

function supportsHost(tool, host) {
  return Boolean(tool && tool.hosts.includes(host));
}

function toolsForHost(host) {
  if (!host) {
    return tools;
  }

  return tools.filter((tool) => supportsHost(tool, host));
}

module.exports = {
  tools,
  getToolIds,
  findTool,
  supportsHost,
  toolsForHost
};
