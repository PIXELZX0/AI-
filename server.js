"use strict";

const http = require("node:http");
const { getToolIds, tools, toolsForHost } = require("./src/node/tools.cjs");

const PORT = Number(process.env.AI_PLUS_PORT || process.env.PORT || 8787);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.AI_PLUS_MODEL || "";
const OPENAI_RESPONSES_URL = process.env.OPENAI_RESPONSES_URL || "https://api.openai.com/v1/responses";

const defaultTools = getToolIds();
const jobs = new Map();

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function createJobId() {
  return "job_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });

    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    request.on("error", reject);
  });
}

function hasAny(text, words) {
  return words.some((word) => text.includes(word));
}

function fallbackPlan(prompt, context) {
  const text = String(prompt || "").toLowerCase();
  const host = context && context.host ? context.host : "preview";
  const actions = [];

  if (hasAny(text, ["summarize", "summary", "analyze", "project"])) {
    actions.push({
      tool: "summarizeProject",
      args: {},
      reason: "Read the current Adobe project before changing it."
    });
  }

  if (hasAny(text, ["intro", "composition", "comp", "cinematic"])) {
    actions.push({
      tool: "createComposition",
      args: {
        name: "AI+ Cinematic Intro",
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: 8
      },
      reason: "Create a clean composition for the requested sequence."
    });
  }

  if (hasAny(text, ["title", "text", "caption", "subtitle"])) {
    actions.push({
      tool: "addTextLayer",
      args: {
        text: hasAny(text, ["caption", "subtitle"]) ? "AI generated caption" : "AI+",
        position: "center",
        duration: 4
      },
      reason: "Add editable text to the active composition."
    });
    actions.push({
      tool: "applyTextStyle",
      args: {
        fontSize: 92,
        fillColor: [0.95, 0.98, 1],
        justify: "center"
      },
      reason: "Make the text readable by default."
    });
  }

  if (hasAny(text, ["fade", "animation", "animate", "keyframe"])) {
    actions.push({
      tool: "addFadeInOut",
      args: {
        fadeIn: 0.5,
        fadeOut: 0.75
      },
      reason: "Animate selected layers with opacity keyframes."
    });
  }

  if (hasAny(text, ["organize", "folder", "bin", "clean"])) {
    actions.push({
      tool: "organizeProject",
      args: {},
      reason: "Create a standard project structure."
    });
  }

  if (hasAny(text, ["marker", "review", "note"])) {
    actions.push({
      tool: "addMarkers",
      args: {
        markers: [
          { time: 0, label: "Intro" },
          { time: 3, label: "Review beat" },
          { time: 6, label: "Ending" }
        ]
      },
      reason: "Add review markers to the timeline."
    });
  }

  if (hasAny(text, ["render", "export", "queue"])) {
    actions.push({
      tool: "queueRender",
      args: {},
      reason: "Prepare the active work for output."
    });
  }

  if (!actions.length) {
    actions.push({
      tool: "summarizeProject",
      args: {},
      reason: "Start with project context for a broad request."
    });
  }

  return {
    title: host === "premiere-pro" ? "Premiere Pro plan" : "After Effects plan",
    actions
  };
}

function getAllowedToolIds(allowedTools) {
  if (!Array.isArray(allowedTools) || !allowedTools.length) {
    return defaultTools;
  }

  return allowedTools
    .map((tool) => tool && tool.id)
    .filter(Boolean);
}

function sanitizePlan(plan, allowedTools) {
  const allowed = new Set(getAllowedToolIds(allowedTools));
  const actions = Array.isArray(plan && plan.actions) ? plan.actions : [];

  return {
    title: plan && plan.title ? String(plan.title) : "AI+ plan",
    actions: actions
      .filter((action) => action && allowed.has(action.tool))
      .map((action) => ({
        tool: String(action.tool),
        args: action.args && typeof action.args === "object" ? action.args : {},
        reason: action.reason ? String(action.reason) : "Execute the requested Adobe task."
      }))
  };
}

function jobCounts() {
  const counts = {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0
  };

  jobs.forEach((job) => {
    if (counts[job.status] !== undefined) {
      counts[job.status] += 1;
    }
  });

  return counts;
}

function canRunJobOnHost(job, host) {
  const jobHost = job.context && job.context.host;
  return !jobHost || jobHost === "preview" || jobHost === host;
}

async function createAdobeJob(payload) {
  const context = payload.context || {};
  const allowedTools = payload.allowedTools || toolsForHost(context.host || "preview");
  const plan = await buildPlan({
    prompt: payload.prompt || "",
    context,
    allowedTools
  });
  const job = {
    id: createJobId(),
    prompt: payload.prompt || "",
    context,
    plan,
    status: "queued",
    result: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  jobs.set(job.id, job);
  return job;
}

function getNextJob(host) {
  let selected = null;

  jobs.forEach((job) => {
    if (!selected && job.status === "queued" && canRunJobOnHost(job, host)) {
      selected = job;
    }
  });

  if (!selected) {
    return null;
  }

  selected.status = "running";
  selected.updatedAt = new Date().toISOString();
  return selected;
}

function setJobResult(jobId, payload) {
  const job = jobs.get(jobId);
  if (!job) {
    return null;
  }

  job.status = payload && payload.ok === false ? "failed" : "completed";
  job.result = payload || {};
  job.updatedAt = new Date().toISOString();
  return job;
}

function extractOutputText(data) {
  if (typeof data.output_text === "string") {
    return data.output_text;
  }

  if (Array.isArray(data.output)) {
    const text = [];
    data.output.forEach((item) => {
      if (Array.isArray(item.content)) {
        item.content.forEach((content) => {
          if (typeof content.text === "string") {
            text.push(content.text);
          }
        });
      }
    });
    if (text.length) {
      return text.join("\n");
    }
  }

  if (data.choices && data.choices[0] && data.choices[0].message) {
    return data.choices[0].message.content;
  }

  throw new Error("Model response did not include text output.");
}

function planSchema(allowedTools) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "actions"],
    properties: {
      title: {
        type: "string"
      },
      actions: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["tool", "args", "reason"],
          properties: {
            tool: {
              type: "string",
              enum: getAllowedToolIds(allowedTools)
            },
            args: {
              type: "object"
            },
            reason: {
              type: "string"
            }
          }
        }
      }
    }
  };
}

async function callOpenAIPlanner(prompt, context, allowedTools) {
  const systemPrompt = [
    "You are AI+, an Adobe After Effects and Premiere Pro planning agent.",
    "Return a compact JSON plan that uses only the provided tool names.",
    "Never invent tools. Prefer reversible, small actions. Do not request arbitrary code execution.",
    "When the request is broad, summarize the project first, then choose safe creative actions."
  ].join(" ");

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + OPENAI_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: JSON.stringify({
            prompt,
            context,
            allowedTools
          })
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "ai_plus_plan",
          strict: true,
          schema: planSchema(allowedTools)
        }
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error("OpenAI planner failed with HTTP " + response.status + ": " + errorText.slice(0, 300));
  }

  const data = await response.json();
  return JSON.parse(extractOutputText(data));
}

async function buildPlan(payload) {
  const prompt = payload.prompt || "";
  const context = payload.context || {};
  const allowedTools = payload.allowedTools || [];

  if (OPENAI_API_KEY && OPENAI_MODEL) {
    try {
      return {
        source: "openai",
        ...sanitizePlan(await callOpenAIPlanner(prompt, context, allowedTools), allowedTools)
      };
    } catch (error) {
      return {
        source: "fallback",
        warning: error.message,
        ...sanitizePlan(fallbackPlan(prompt, context), allowedTools)
      };
    }
  }

  return {
    source: "fallback",
    ...sanitizePlan(fallbackPlan(prompt, context), allowedTools)
  };
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, {
      ok: true,
      modelConfigured: Boolean(OPENAI_API_KEY && OPENAI_MODEL),
      tools: tools.length,
      jobs: jobCounts()
    });
    return;
  }

  if (request.method === "GET" && request.url.startsWith("/tools")) {
    const url = new URL(request.url, "http://127.0.0.1");
    const host = url.searchParams.get("host");
    sendJson(response, 200, {
      tools: toolsForHost(host)
    });
    return;
  }

  if (request.method === "POST" && request.url === "/plan") {
    try {
      sendJson(response, 200, await buildPlan(await readBody(request)));
    } catch (error) {
      sendJson(response, 400, {
        error: error.message
      });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/jobs") {
    try {
      const job = await createAdobeJob(await readBody(request));
      sendJson(response, 200, {
        ok: true,
        job
      });
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: error.message
      });
    }
    return;
  }

  if (request.method === "GET" && request.url.startsWith("/jobs/next")) {
    const url = new URL(request.url, "http://127.0.0.1");
    const host = url.searchParams.get("host") || "preview";
    sendJson(response, 200, {
      ok: true,
      job: getNextJob(host)
    });
    return;
  }

  const resultMatch = request.url.match(/^\/jobs\/([^/]+)\/result$/);
  if (request.method === "POST" && resultMatch) {
    try {
      const job = setJobResult(resultMatch[1], await readBody(request));
      if (!job) {
        sendJson(response, 404, {
          ok: false,
          error: "Job not found."
        });
        return;
      }
      sendJson(response, 200, {
        ok: true,
        job
      });
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: error.message
      });
    }
    return;
  }

  const jobMatch = request.url.match(/^\/jobs\/([^/]+)$/);
  if (request.method === "GET" && jobMatch) {
    const job = jobs.get(jobMatch[1]);
    if (!job) {
      sendJson(response, 404, {
        ok: false,
        error: "Job not found."
      });
      return;
    }
    sendJson(response, 200, {
      ok: true,
      job
    });
    return;
  }

  sendJson(response, 404, {
    error: "Not found."
  });
});

if (require.main === module) {
  server.listen(PORT, "127.0.0.1", () => {
    console.log("AI+ planner listening at http://127.0.0.1:" + PORT + "/plan");
    console.log("AI+ Adobe job bridge listening at http://127.0.0.1:" + PORT + "/jobs");
    if (!OPENAI_API_KEY || !OPENAI_MODEL) {
      console.log("Set OPENAI_API_KEY and AI_PLUS_MODEL to enable model planning.");
    }
  });
}

module.exports = {
  buildPlan,
  createAdobeJob,
  getNextJob,
  setJobResult,
  server,
  tools
};
