(function () {
  "use strict";

  var root = window.AIPlus || (window.AIPlus = {});
  var storageKey = "ai-plus-provider";
  var defaults = {
    provider: "codex",
    model: "",
    endpoint: "",
    thinking: "auto",
    openRouterKey: "",
    anthropicKey: "",
    imageModel: "google/nano-banana",
    preferredFonts: "",
    confirmReverts: true,
    notificationSound: false,
    mcpClaude: false,
    mcpUrl: false,
    mcpPort: 8787
  };

  function defaultEndpoint(settings) {
    var port = Number(settings && settings.mcpPort) || defaults.mcpPort;
    return "http://127.0.0.1:" + port + "/plan";
  }

  function usesLocalPlanner(settings) {
    var provider = settings && settings.provider;
    return provider === "codex" || provider === "opencode";
  }

  var modelCatalog = {
    codex: ["gpt-5.2-codex", "gpt-5.1-codex", "gpt-5.1-codex-mini"],
    opencode: ["gpt-5.2-codex", "claude-opus-4-8", "claude-sonnet-5"],
    openai: ["gpt-5.2", "gpt-5.2-codex", "gpt-5.1", "gpt-5.1-mini"],
    anthropic: ["claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
    openrouter: ["anthropic/claude-sonnet-5", "openai/gpt-5.2", "google/gemini-3-pro"],
    endpoint: []
  };

  function modelsFor(provider) {
    return modelCatalog[provider] || [];
  }

  function mergeSettings(settings) {
    var merged = {};
    var key;

    for (key in defaults) {
      if (defaults.hasOwnProperty(key)) {
        merged[key] = defaults[key];
      }
    }

    settings = settings || {};
    for (key in settings) {
      if (settings.hasOwnProperty(key)) {
        merged[key] = settings[key];
      }
    }

    return merged;
  }

  function loadSettings() {
    try {
      return mergeSettings(JSON.parse(localStorage.getItem(storageKey)) || {});
    } catch (error) {
      return mergeSettings({});
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(storageKey, JSON.stringify(mergeSettings(settings || {})));
  }

  function getEndpointBase() {
    var settings = loadSettings();
    var endpoint = settings.endpoint || (usesLocalPlanner(settings) ? defaultEndpoint(settings) : "");

    if (!endpoint) {
      return "";
    }

    try {
      return new URL(endpoint).origin;
    } catch (error) {
      return "";
    }
  }

  async function planWithEndpoint(prompt, context) {
    var settings = loadSettings();
    var endpoint = settings.endpoint || (usesLocalPlanner(settings) ? defaultEndpoint(settings) : "");

    if (!endpoint) {
      return null;
    }

    var response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt: prompt,
        context: context,
        settings: {
          provider: settings.provider,
          model: settings.model,
          thinking: settings.thinking,
          imageModel: settings.imageModel,
          preferredFonts: settings.preferredFonts,
          openRouterKey: settings.openRouterKey,
          anthropicKey: settings.anthropicKey
        },
        allowedTools: root.toolRegistry.all
      })
    });

    if (!response.ok) {
      throw new Error("Provider returned HTTP " + response.status + ".");
    }

    return response.json();
  }

  async function fetchNextJob(host) {
    var base = getEndpointBase();

    if (!base) {
      return null;
    }

    var response = await fetch(base + "/jobs/next?host=" + encodeURIComponent(host || "preview"));

    if (!response.ok) {
      throw new Error("Job bridge returned HTTP " + response.status + ".");
    }

    var data = await response.json();
    return data.job || null;
  }

  async function submitJobResult(jobId, result) {
    var base = getEndpointBase();

    if (!base) {
      return null;
    }

    var response = await fetch(base + "/jobs/" + encodeURIComponent(jobId) + "/result", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(result || {})
    });

    if (!response.ok) {
      throw new Error("Unable to submit job result. HTTP " + response.status + ".");
    }

    return response.json();
  }

  root.provider = {
    getEndpointBase: getEndpointBase,
    defaultEndpoint: defaultEndpoint,
    usesLocalPlanner: usesLocalPlanner,
    modelsFor: modelsFor,
    loadSettings: loadSettings,
    mergeSettings: mergeSettings,
    saveSettings: saveSettings,
    planWithEndpoint: planWithEndpoint,
    fetchNextJob: fetchNextJob,
    submitJobResult: submitJobResult
  };
})();
