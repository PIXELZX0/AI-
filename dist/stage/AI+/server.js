"use strict";

const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { getToolIds, tools, toolsForHost } = require("./src/node/tools.cjs");

const PORT = Number(process.env.AI_PLUS_PORT || process.env.PORT || 8787);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.AI_PLUS_MODEL || "";
const OPENAI_RESPONSES_URL = process.env.OPENAI_RESPONSES_URL || "https://api.openai.com/v1/responses";
const CODEX_BIN = process.env.AI_PLUS_CODEX_BIN || process.env.CODEX_BIN || "codex";
const CODEX_TIMEOUT_MS = Number(process.env.AI_PLUS_CODEX_TIMEOUT_MS || 180000);
const PLANNER_MODE = String(process.env.AI_PLUS_PLANNER || "").toLowerCase();

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
  const settings = context && context.settings ? context.settings : {};
  const attachments = context && Array.isArray(context.attachments) ? context.attachments : [];
  const attachmentPath = attachments.find((attachment) => attachment && attachment.path);
  const actions = [];

  if (hasAny(text, ["summarize", "summary", "analyze", "analyse", "project"])) {
    actions.push({
      tool: "summarizeProject",
      args: {},
      reason: "Read the current Adobe project before changing it."
    });
  }

  if (host === "illustrator" && hasAny(text, ["inspect", "analyze", "analyse", "layer", "selected", "object", "selection", "검사", "분석", "레이어", "객체", "오브젝트", "선택"])) {
    actions.push({
      tool: "inspectIllustratorDocument",
      args: {},
      reason: "Inspect the active Illustrator document and selection."
    });
  } else if (hasAny(text, ["inspect", "layer", "selected", "expression", "comp"])) {
    actions.push({
      tool: "inspectComposition",
      args: {},
      reason: "Inspect the active composition and selection."
    });
  }

  if (host === "illustrator") {
    const wantsIllustratorText = hasAny(text, ["title", "text", "caption", "subtitle", "타이틀", "텍스트", "자막"]);

    if (hasAny(text, ["document", "artboard", "canvas", "poster", "logo", "flyer", "card", "illustration", "새 문서", "문서", "아트보드", "포스터", "로고", "카드", "일러스트"])) {
      actions.push({
        tool: "createIllustratorDocument",
        args: {
          name: hasAny(text, ["logo", "로고"]) ? "AI+ Logo Artboard" : "AI+ Illustrator Document",
          width: hasAny(text, ["poster", "포스터"]) ? 1080 : 1200,
          height: hasAny(text, ["poster", "포스터"]) ? 1350 : 1200,
          colorSpace: hasAny(text, ["print", "cmyk", "인쇄"]) ? "cmyk" : "rgb"
        },
        reason: "Create a clean Illustrator document for the requested artwork."
      });
    }

    if (hasAny(text, ["square", "grid", "shape", "box", "vector", "rectangle", "사각", "그리드", "도형", "벡터"])) {
      actions.push({
        tool: "createIllustratorShapeGrid",
        args: {
          namePrefix: "Vector",
          count: hasAny(text, ["five", "5"]) ? 5 : 6,
          columns: hasAny(text, ["five", "5"]) ? 5 : 3,
          size: 140,
          gap: 26
        },
        reason: "Create editable vector shapes on the active artboard."
      });
    }

    if (wantsIllustratorText) {
      actions.push({
        tool: "addIllustratorText",
        args: {
          text: hasAny(text, ["caption", "subtitle", "자막"]) ? "AI generated caption" : "AI+",
          fontSize: 76,
          fillColor: [28, 31, 36],
          justify: "center",
          preferredFonts: settings.preferredFonts || ""
        },
        reason: "Add editable Illustrator text."
      });
    }

    if (!wantsIllustratorText && hasAny(text, ["style", "font", "selected text", "스타일", "폰트", "선택한 텍스트"])) {
      actions.push({
        tool: "applyIllustratorTextStyle",
        args: {
          fontSize: 76,
          fillColor: [28, 31, 36],
          justify: "center",
          preferredFonts: settings.preferredFonts || ""
        },
        reason: "Style selected Illustrator text."
      });
    }

    if (hasAny(text, ["rename", "clean names", "rename objects", "이름 변경", "이름 바꾸", "오브젝트 이름 변경"])) {
      actions.push({
        tool: "normalizeIllustratorObjectNames",
        args: {
          prefix: "AI+ Object"
        },
        reason: "Make selected Illustrator object names predictable."
      });
    }

    if (hasAny(text, ["organize", "folder", "layer", "project", "정리", "폴더", "레이어"])) {
      actions.push({
        tool: "organizeProject",
        args: {},
        reason: "Create a standard Illustrator layer structure."
      });
    }

    if (hasAny(text, ["image", "generate", "texture", "reference", "이미지", "생성", "텍스처", "레퍼런스"])) {
      actions.push({
        tool: "generateImageAsset",
        args: {
          prompt,
          ratio: hasAny(text, ["9:16"]) ? "9:16" : hasAny(text, ["16:9"]) ? "16:9" : "1:1",
          count: hasAny(text, ["three", "3"]) ? 3 : 1,
          imageModel: settings.imageModel || "google/nano-banana"
        },
        reason: "Prepare a visual reference placeholder on the artboard."
      });
    }

    if (attachmentPath && hasAny(text, ["attach", "import", "file", "reference", "asset", "place", "첨부", "가져", "배치"])) {
      actions.push({
        tool: "importAttachmentAsset",
        args: {
          path: attachmentPath.path
        },
        reason: "Place the attached local file into the Illustrator document."
      });
    }

    if (hasAny(text, ["render", "export", "png", "output", "내보내기", "익스포트", "출력"])) {
      actions.push({
        tool: "exportIllustratorPng",
        args: {},
        reason: "Export the active Illustrator document as a PNG."
      });
    }

    if (!actions.length) {
      actions.push({
        tool: "summarizeProject",
        args: {},
        reason: "Start with Illustrator document context for a broad request."
      });
      actions.push({
        tool: "inspectIllustratorDocument",
        args: {},
        reason: "Inspect the active artboard before choosing edits."
      });
    }

    return {
      title: "Illustrator plan",
      actions
    };
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

  if (hasAny(text, ["square", "grid", "shape", "box"])) {
    actions.push({
      tool: "createShapeGrid",
      args: {
        namePrefix: "Square",
        count: hasAny(text, ["five", "5"]) ? 5 : 6,
        columns: hasAny(text, ["five", "5"]) ? 5 : 3,
        size: 140,
        gap: 26
      },
      reason: "Create editable shape layers in the active comp."
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
        justify: "center",
        preferredFonts: settings.preferredFonts || ""
      },
      reason: "Make the text readable by default."
    });
  }

  if (hasAny(text, ["reveal", "stagger", "cascade", "offset"])) {
    actions.push({
      tool: "cascadeReveal",
      args: {
        duration: 0.45,
        stagger: 0.12,
        yOffset: 32
      },
      reason: "Animate selected layers with a staggered reveal."
    });
  } else if (hasAny(text, ["fade", "animation", "animate", "keyframe"])) {
    actions.push({
      tool: "addFadeInOut",
      args: {
        fadeIn: 0.5,
        fadeOut: 0.75
      },
      reason: "Animate selected layers with opacity keyframes."
    });
  }

  if (hasAny(text, ["easy ease", "ease", "easing", "polish"])) {
    actions.push({
      tool: "applyEasyEase",
      args: {},
      reason: "Smooth selected keyframes."
    });
  }

  if (hasAny(text, ["controller", "null", "rig", "slider", "intensity"])) {
    actions.push({
      tool: hasAny(text, ["slider", "intensity"]) ? "createSliderRig" : "addNullController",
      args: {
        name: hasAny(text, ["master"]) ? "Master Controller" : "AI+ Control",
        sliderName: "Intensity",
        targetProperty: "opacity"
      },
      reason: "Add a reusable controller for selected layers."
    });
  }

  if (hasAny(text, ["wiggle", "expression", "loop", "bounce"])) {
    actions.push({
      tool: "applyExpression",
      args: {
        property: "position",
        expression: hasAny(text, ["loop"]) ? "loopOut(\"cycle\")" : "wiggle(2, 24)"
      },
      reason: "Apply a safe expression to the selected property."
    });
  }

  if (hasAny(text, ["rename", "clean names", "layer names"])) {
    actions.push({
      tool: "normalizeLayerNames",
      args: {
        prefix: "AI+ Layer"
      },
      reason: "Make selected layer names predictable."
    });
  }

  if (hasAny(text, ["reset", "scale 100", "rotation 0"])) {
    actions.push({
      tool: "resetTransforms",
      args: {
        scale: true,
        rotation: true,
        opacity: false,
        position: false
      },
      reason: "Reset selected transform basics."
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

  if (hasAny(text, ["image", "generate", "texture", "sprite", "mood", "reference"])) {
    actions.push({
      tool: "generateImageAsset",
      args: {
        prompt,
        ratio: hasAny(text, ["9:16"]) ? "9:16" : "16:9",
        count: hasAny(text, ["three", "3"]) ? 3 : 1,
        imageModel: settings.imageModel || "google/nano-banana"
      },
      reason: "Prepare a generated visual asset for the project."
    });
  }

  if (attachmentPath && hasAny(text, ["attach", "import", "file", "reference", "asset"])) {
    actions.push({
      tool: "importAttachmentAsset",
      args: {
        path: attachmentPath.path
      },
      reason: "Import the attached local file into the project."
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
    if (host === "after-effects" || host === "preview") {
      actions.push({
        tool: "inspectComposition",
        args: {},
        reason: "Inspect the active comp before choosing edits."
      });
    }
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

function effectiveAllowedTools(allowedTools, host) {
  if (Array.isArray(allowedTools) && allowedTools.length) {
    return allowedTools;
  }

  return host ? toolsForHost(host) : tools;
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
  const context = {
    ...(payload.context || {}),
    settings: resolveSettings(payload, payload.context || {})
  };
  const allowedTools = effectiveAllowedTools(payload.allowedTools, context.host || "preview");
  const plan = await buildPlan({
    prompt: payload.prompt || "",
    context,
    allowedTools,
    settings: payload.settings || {}
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

function parseJsonFromText(text) {
  const value = String(text || "").trim();

  if (!value) {
    throw new Error("Planner returned an empty response.");
  }

  try {
    return JSON.parse(value);
  } catch (firstError) {
    const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenced) {
      return JSON.parse(fenced[1]);
    }

    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(value.slice(start, end + 1));
    }

    throw firstError;
  }
}

function resolveSettings(payload, context) {
  return {
    ...((context && context.settings) || {}),
    ...((payload && payload.settings) || {})
  };
}

function normalizeProvider(settings) {
  return String(settings && settings.provider || "").toLowerCase();
}

function isCodexModel(model) {
  return /codex/i.test(String(model || ""));
}

function shouldUseCodexPlanner(settings) {
  const provider = normalizeProvider(settings);

  if (PLANNER_MODE === "codex") {
    return true;
  }

  if (PLANNER_MODE === "openai" || PLANNER_MODE === "fallback" || PLANNER_MODE === "builtin") {
    return false;
  }

  return provider === "codex" || (provider === "openai" && isCodexModel(settings && settings.model));
}

function resolveCodexModel(settings) {
  const model = process.env.AI_PLUS_CODEX_MODEL || (settings && settings.model) || "";

  if (!model || String(model).toLowerCase() === "codex") {
    return "";
  }

  return String(model);
}

function resolveOpenAIModel(settings) {
  const provider = normalizeProvider(settings);
  const model = OPENAI_MODEL || (provider === "openai" ? settings && settings.model : "");

  if (!model || String(model).toLowerCase() === "codex") {
    return "";
  }

  return String(model);
}

function shouldUseOpenAIPlanner(settings, codexRequested) {
  const provider = normalizeProvider(settings);

  if (PLANNER_MODE === "openai") {
    return true;
  }

  if (PLANNER_MODE === "fallback" || PLANNER_MODE === "builtin") {
    return false;
  }

  return provider === "openai" || (!provider && !codexRequested);
}

function codexPrompt(prompt, context, allowedTools) {
  return [
    "You are AI+, a Codex-powered planning agent for Adobe After Effects, Premiere Pro, and Illustrator.",
    "Create one compact JSON plan for the user's Adobe automation request.",
    "Return only JSON that matches the provided schema. Do not use Markdown.",
    "Use only tool IDs from the allowed tools list. Never invent tools.",
    "Prefer reversible, small actions. Do not request arbitrary code execution.",
    "Do not edit local files or run shell commands; this task is planning only.",
    "",
    "User request:",
    String(prompt || ""),
    "",
    "Context JSON:",
    JSON.stringify(context || {}, null, 2),
    "",
    "Allowed tools JSON:",
    JSON.stringify(allowedTools || [], null, 2)
  ].join("\n");
}

function runProcess(command, args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: __dirname,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(command + " timed out after " + timeoutMs + "ms."));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 1024 * 1024) {
        stdout = stdout.slice(-1024 * 1024);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 1024 * 1024) {
        stderr = stderr.slice(-1024 * 1024);
      }
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({
          stdout,
          stderr
        });
        return;
      }
      reject(new Error(command + " exited with code " + code + ": " + (stderr || stdout).trim().slice(0, 500)));
    });

    child.stdin.end(input || "");
  });
}

async function callCodexPlanner(prompt, context, allowedTools, settings) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-plus-codex-"));
  const schemaPath = path.join(tempDir, "plan.schema.json");
  const outputPath = path.join(tempDir, "plan.json");
  const args = [
    "--ask-for-approval",
    "never",
    "exec",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--output-schema",
    schemaPath,
    "--output-last-message",
    outputPath,
    "-C",
    __dirname,
    "-"
  ];
  const model = resolveCodexModel(settings);

  if (model) {
    args.splice(2, 0, "--model", model);
  }

  try {
    fs.writeFileSync(schemaPath, JSON.stringify(planSchema(allowedTools), null, 2));
    const result = await runProcess(CODEX_BIN, args, codexPrompt(prompt, context, allowedTools), CODEX_TIMEOUT_MS);
    const text = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : result.stdout;
    return parseJsonFromText(text);
  } finally {
    fs.rmSync(tempDir, {
      recursive: true,
      force: true
    });
  }
}

async function callOpenAIPlanner(prompt, context, allowedTools, model) {
  const systemPrompt = [
    "You are AI+, an Adobe After Effects, Premiere Pro, and Illustrator planning agent with AI+ style chat, checkpoint, skill, attachment, image, and MCP workflows.",
    "Return a compact JSON plan that uses only the provided tool names.",
    "Never invent tools. Prefer reversible, small actions. Do not request arbitrary code execution.",
    "When the request is broad, summarize and inspect the project first, then choose safe creative actions.",
    "Use checkpoints through the host panel, not as explicit plan actions unless the user asks for a manual checkpoint."
  ].join(" ");

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + OPENAI_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
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
  const baseContext = payload.context || {};
  const settings = resolveSettings(payload, baseContext);
  const context = {
    ...baseContext,
    settings
  };
  const allowedTools = effectiveAllowedTools(payload.allowedTools, context.host || "");
  const warnings = [];
  const codexRequested = shouldUseCodexPlanner(settings);
  const openAIModel = resolveOpenAIModel(settings);

  if (codexRequested) {
    try {
      return {
        source: "codex",
        ...sanitizePlan(await callCodexPlanner(prompt, context, allowedTools, settings), allowedTools)
      };
    } catch (error) {
      warnings.push("Codex planner failed: " + error.message);
    }
  }

  if (OPENAI_API_KEY && openAIModel && shouldUseOpenAIPlanner(settings, codexRequested)) {
    try {
      return {
        source: "openai",
        ...sanitizePlan(await callOpenAIPlanner(prompt, context, allowedTools, openAIModel), allowedTools)
      };
    } catch (error) {
      warnings.push("OpenAI planner failed: " + error.message);
    }
  }

  return {
    source: "fallback",
    warning: warnings.join(" "),
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
      plannerMode: PLANNER_MODE || "settings",
      codex: {
        command: CODEX_BIN,
        timeoutMs: CODEX_TIMEOUT_MS
      },
      openai: {
        configured: Boolean(OPENAI_API_KEY && OPENAI_MODEL),
        model: OPENAI_MODEL || ""
      },
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
    console.log("Codex CLI planner command: " + CODEX_BIN);
    if (!OPENAI_API_KEY || !OPENAI_MODEL) {
      console.log("OpenAI API planner disabled. Set OPENAI_API_KEY and AI_PLUS_MODEL to enable it.");
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
