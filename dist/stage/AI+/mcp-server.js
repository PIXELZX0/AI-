"use strict";

const readline = require("node:readline");
const { buildPlan, tools } = require("./server.js");

const SERVER_URL = (process.env.AI_PLUS_SERVER_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const PROTOCOL_VERSION = "2024-11-05";

const mcpTools = [
  {
    name: "ai_plus_health",
    description: "Check whether the AI+ local planner and Adobe job bridge are reachable.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  },
  {
    name: "ai_plus_list_capabilities",
    description: "List AI+ Adobe tools that the planner is allowed to use.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        host: {
          type: "string",
          enum: ["after-effects", "premiere-pro", "illustrator", "preview"],
          description: "Optional Adobe host filter."
        }
      }
    }
  },
  {
    name: "ai_plus_plan",
    description: "Create a gated AI+ action plan for After Effects, Premiere Pro, or Illustrator.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: {
        prompt: {
          type: "string",
          description: "Natural-language Adobe editing or motion request."
        },
        host: {
          type: "string",
          enum: ["after-effects", "premiere-pro", "illustrator", "preview"],
          description: "Target Adobe host."
        },
        allowedToolIds: {
          type: "array",
          items: {
            type: "string"
          },
          description: "Optional allowlist of AI+ tool IDs."
        }
      }
    }
  },
  {
    name: "ai_plus_enqueue_adobe_job",
    description: "Queue an AI+ plan for the open Adobe panel to execute in After Effects, Premiere Pro, or Illustrator.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: {
        prompt: {
          type: "string",
          description: "Natural-language Adobe editing or motion request."
        },
        host: {
          type: "string",
          enum: ["after-effects", "premiere-pro", "illustrator", "preview"],
          description: "Adobe host that should pick up the job."
        },
        allowedToolIds: {
          type: "array",
          items: {
            type: "string"
          },
          description: "Optional allowlist of AI+ tool IDs."
        }
      }
    }
  },
  {
    name: "ai_plus_get_adobe_job",
    description: "Read the status and result of an AI+ Adobe job.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["jobId"],
      properties: {
        jobId: {
          type: "string",
          description: "Job ID returned by ai_plus_enqueue_adobe_job."
        }
      }
    }
  }
];

function write(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function result(id, payload) {
  write({
    jsonrpc: "2.0",
    id,
    result: payload
  });
}

function error(id, code, message) {
  write({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message
    }
  });
}

function textResult(value) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2)
      }
    ]
  };
}

function normalizeHost(host) {
  if (host === "after-effects" || host === "premiere-pro" || host === "illustrator") {
    return host;
  }
  return "preview";
}

function allowedToolsFromIds(ids, host) {
  const filteredByHost = tools.filter((tool) => !host || tool.hosts.includes(host));

  if (!Array.isArray(ids) || !ids.length) {
    return filteredByHost;
  }

  const allowed = new Set(ids);
  return filteredByHost.filter((tool) => allowed.has(tool.id));
}

async function requestJson(path, options) {
  const response = await fetch(SERVER_URL + path, options);
  const text = await response.text();
  let data = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      throw new Error("AI+ server returned non-JSON: " + text.slice(0, 120));
    }
  }

  if (!response.ok) {
    throw new Error(data.error || "AI+ server returned HTTP " + response.status + ".");
  }

  return data;
}

async function callTool(name, args) {
  const input = args || {};

  if (name === "ai_plus_health") {
    try {
      return textResult({
        mcp: true,
        serverUrl: SERVER_URL,
        bridge: await requestJson("/health")
      });
    } catch (serverError) {
      return textResult({
        mcp: true,
        serverUrl: SERVER_URL,
        bridgeReachable: false,
        error: serverError.message,
        nextStep: "Run `npm run planner` in the AI+ project and keep the Adobe AI+ panel open."
      });
    }
  }

  if (name === "ai_plus_list_capabilities") {
    const host = input.host ? normalizeHost(input.host) : "";
    return textResult({
      tools: allowedToolsFromIds(null, host)
    });
  }

  if (name === "ai_plus_plan") {
    const host = normalizeHost(input.host);
    const allowedTools = allowedToolsFromIds(input.allowedToolIds, host);
    return textResult(await buildPlan({
      prompt: input.prompt,
      context: {
        host
      },
      allowedTools
    }));
  }

  if (name === "ai_plus_enqueue_adobe_job") {
    const host = normalizeHost(input.host);
    const allowedTools = allowedToolsFromIds(input.allowedToolIds, host);
    return textResult(await requestJson("/jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt: input.prompt,
        context: {
          host
        },
        allowedTools
      })
    }));
  }

  if (name === "ai_plus_get_adobe_job") {
    return textResult(await requestJson("/jobs/" + encodeURIComponent(input.jobId)));
  }

  throw new Error("Unknown tool: " + name);
}

async function handle(message) {
  if (!message || message.jsonrpc !== "2.0") {
    return;
  }

  if (message.id === undefined || message.id === null) {
    return;
  }

  if (message.method === "initialize") {
    result(message.id, {
      protocolVersion: message.params && message.params.protocolVersion || PROTOCOL_VERSION,
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: "ai-plus",
        version: "0.1.0"
      }
    });
    return;
  }

  if (message.method === "ping") {
    result(message.id, {});
    return;
  }

  if (message.method === "tools/list") {
    result(message.id, {
      tools: mcpTools
    });
    return;
  }

  if (message.method === "tools/call") {
    try {
      result(message.id, await callTool(message.params.name, message.params.arguments));
    } catch (toolError) {
      result(message.id, {
        isError: true,
        content: [
          {
            type: "text",
            text: toolError.message
          }
        ]
      });
    }
    return;
  }

  if (message.method === "resources/list") {
    result(message.id, {
      resources: []
    });
    return;
  }

  if (message.method === "prompts/list") {
    result(message.id, {
      prompts: []
    });
    return;
  }

  error(message.id, -32601, "Method not found: " + message.method);
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

rl.on("line", (line) => {
  if (!line.trim()) {
    return;
  }

  try {
    handle(JSON.parse(line)).catch((handlerError) => {
      process.stderr.write(handlerError.stack + "\n");
    });
  } catch (parseError) {
    process.stderr.write("Invalid MCP JSON: " + parseError.message + "\n");
  }
});

process.stderr.write("AI+ MCP server ready. Bridge URL: " + SERVER_URL + "\n");
