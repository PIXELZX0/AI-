(function () {
  "use strict";

  var root = window.AIPlus || (window.AIPlus = {});
  var storageKey = "ai-plus-provider";

  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(storageKey)) || {};
    } catch (error) {
      return {};
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(storageKey, JSON.stringify(settings || {}));
  }

  function getEndpointBase() {
    var endpoint = loadSettings().endpoint;

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

    if (!settings.endpoint) {
      return null;
    }

    var response = await fetch(settings.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt: prompt,
        context: context,
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
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    planWithEndpoint: planWithEndpoint,
    fetchNextJob: fetchNextJob,
    submitJobResult: submitJobResult
  };
})();
