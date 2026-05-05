(function () {
  "use strict";

  var root = window.AIPlus || (window.AIPlus = {});

  var state = {
    hostInfo: null,
    currentPlan: null,
    busy: false,
    pollingJob: false,
    jobPollTimer: null,
    welcomed: false
  };

  var nodes = {};

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatTime() {
    var now = new Date();
    return now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function setBusy(busy) {
    state.busy = busy;
    nodes.runButton.disabled = busy;
    nodes.planButton.disabled = busy;
    nodes.runState.textContent = busy ? "Working" : "Idle";

    Array.prototype.forEach.call(document.querySelectorAll(".message-run-button"), function (button) {
      button.disabled = busy;
    });
  }

  function scrollMessagesToBottom() {
    nodes.messageList.scrollTop = nodes.messageList.scrollHeight;
  }

  function resizeComposer() {
    nodes.promptInput.style.height = "0px";
    nodes.promptInput.style.height = Math.min(nodes.promptInput.scrollHeight, 150) + "px";
  }

  function addLog(kind, message) {
    var entry = document.createElement("div");
    entry.className = "log-entry" + (kind === "error" ? " error" : "");
    entry.innerHTML = "<strong>" + escapeHtml(kind) + "</strong> " + escapeHtml(message);
    nodes.logList.appendChild(entry);
    nodes.logList.scrollTop = nodes.logList.scrollHeight;
  }

  function renderPlanActions(container, plan) {
    var actions = plan && plan.actions || [];

    if (!actions.length) {
      var empty = document.createElement("div");
      empty.className = "result-row error";
      empty.textContent = "No safe actions available for this host.";
      container.appendChild(empty);
      return;
    }

    actions.forEach(function (action, index) {
      var tool = root.toolRegistry.find(action.tool);
      var row = document.createElement("div");
      row.className = "message-action";
      row.innerHTML =
        "<div class=\"action-index\">" + (index + 1) + "</div>" +
        "<div><strong>" + escapeHtml(tool ? tool.label : action.tool) + "</strong>" +
        "<span>" + escapeHtml(action.reason || "Ready to execute.") + "</span></div>";
      container.appendChild(row);
    });
  }

  function renderResultRows(container, result) {
    var rows = result && result.value && result.value.results || [];

    if (!result || !result.ok) {
      var errorRow = document.createElement("div");
      errorRow.className = "result-row error";
      errorRow.textContent = result && result.error ? result.error : "Host execution failed.";
      container.appendChild(errorRow);
      return;
    }

    if (!rows.length) {
      var doneRow = document.createElement("div");
      doneRow.className = "result-row";
      doneRow.textContent = "Completed.";
      container.appendChild(doneRow);
      return;
    }

    rows.forEach(function (item) {
      var row = document.createElement("div");
      row.className = "result-row" + (item.ok ? "" : " error");
      row.textContent = item.message || item.tool || "Completed.";
      container.appendChild(row);
    });
  }

  function addMessage(role, text, options) {
    var opts = options || {};
    var message = document.createElement("article");
    var avatar = document.createElement("div");
    var bubble = document.createElement("div");
    var meta = document.createElement("div");
    var body = document.createElement("p");
    var label = opts.sender || (role === "user" ? "You" : "AI+");

    message.className = "message " + role;
    avatar.className = "avatar";
    avatar.textContent = role === "user" ? label.slice(0, 3) : "AI";
    bubble.className = "bubble";
    meta.className = "bubble-meta";
    meta.innerHTML = "<span>" + escapeHtml(label) + "</span><span>" + formatTime() + "</span>";
    body.textContent = text;

    bubble.appendChild(meta);
    bubble.appendChild(body);

    if (opts.plan) {
      var planWrap = document.createElement("div");
      planWrap.className = "message-plan";
      renderPlanActions(planWrap, opts.plan);
      bubble.appendChild(planWrap);

      if (opts.showRunButton && opts.plan.actions && opts.plan.actions.length) {
        var buttons = document.createElement("div");
        var runButton = document.createElement("button");
        buttons.className = "message-buttons";
        runButton.className = "primary-button message-run-button";
        runButton.type = "button";
        runButton.textContent = "Run";
        runButton.addEventListener("click", function () {
          state.currentPlan = opts.plan;
          executeAndReply(opts.plan);
        });
        buttons.appendChild(runButton);
        bubble.appendChild(buttons);
      }
    }

    if (opts.result) {
      var resultWrap = document.createElement("div");
      resultWrap.className = "message-result";
      renderResultRows(resultWrap, opts.result);
      bubble.appendChild(resultWrap);
    }

    message.appendChild(avatar);
    message.appendChild(bubble);
    nodes.messageList.appendChild(message);
    scrollMessagesToBottom();
    return message;
  }

  function addWelcomeMessage() {
    if (state.welcomed) {
      return;
    }

    state.welcomed = true;
    addMessage("assistant", "Ready.");
  }

  function renderPlan(plan) {
    nodes.planList.innerHTML = "";
    state.currentPlan = plan;

    if (plan && plan.warning) {
      addLog("warn", plan.warning);
    }

    if (!plan || !plan.actions || !plan.actions.length) {
      var empty = document.createElement("li");
      empty.innerHTML = "<div><strong>No actions</strong><span>No safe actions available for this host.</span></div>";
      nodes.planList.appendChild(empty);
      return;
    }

    plan.actions.forEach(function (action) {
      var tool = root.toolRegistry.find(action.tool);
      var item = document.createElement("li");
      item.innerHTML =
        "<div><strong>" + escapeHtml(tool ? tool.label : action.tool) + "</strong>" +
        "<span>" + escapeHtml(action.reason || "Ready to execute.") + "</span></div>";
      nodes.planList.appendChild(item);
    });
  }

  function updateHostUi() {
    var info = state.hostInfo || {};
    var normalized = root.agent.normalizeHost(info);
    var label = info.appName ? info.appName + " " + (info.appVersion || "") : "Adobe panel";

    nodes.hostLabel.textContent = label;
    nodes.hostMetric.textContent = normalized.replace("-", " ");
    nodes.modeMetric.textContent = root.provider.loadSettings().endpoint ? "Endpoint" : "Built-in";
  }

  async function refreshHost() {
    var result = await root.cep.runHostCommand("getHostInfo", {});

    if (result.ok) {
      state.hostInfo = result.value || {};
      updateHostUi();
      addLog("host", "Connected to " + (state.hostInfo.appName || "preview host") + ".");
      addWelcomeMessage();
    } else {
      addLog("error", result.error || "Unable to read host info.");
    }
  }

  async function createPlanFromPrompt(prompt, showRunButton) {
    setBusy(true);
    try {
      var plan = await root.agent.createPlan(prompt, state.hostInfo);
      renderPlan(plan);
      addMessage("assistant", (plan.actions || []).length + " action(s) ready.", {
        plan: plan,
        showRunButton: showRunButton
      });
      addLog("plan", (plan.actions || []).length + " action(s) ready.");
      return plan;
    } catch (error) {
      addMessage("assistant", "I couldn't create a safe plan.", {
        result: {
          ok: false,
          error: error.message
        }
      });
      addLog("error", error.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function executePlan(plan) {
    if (!plan || !plan.actions || !plan.actions.length) {
      return {
        ok: false,
        error: "Plan has no executable actions."
      };
    }

    setBusy(true);
    try {
      var result = await root.agent.executePlan(plan);
      if (!result.ok) {
        addLog("error", result.error || "Host execution failed.");
        return result;
      }

      (result.value && result.value.results || []).forEach(function (item) {
        addLog(item.ok ? "done" : "error", item.message || item.tool);
      });
      return result;
    } catch (error) {
      addLog("error", error.message);
      return {
        ok: false,
        error: error.message
      };
    } finally {
      setBusy(false);
    }
  }

  function didPlanSucceed(result) {
    var results = result && result.value && result.value.results;

    if (!result || !result.ok) {
      return false;
    }

    if (!Array.isArray(results)) {
      return true;
    }

    return results.every(function (item) {
      return item && item.ok;
    });
  }

  async function executeAndReply(plan) {
    var result = await executePlan(plan);
    var success = didPlanSucceed(result);
    addMessage("assistant", success ? "Done." : "I ran into an issue.", {
      result: result
    });
    return result;
  }

  async function handlePrompt(executeAfterPlan) {
    var prompt = nodes.promptInput.value.trim();

    if (!prompt) {
      if (executeAfterPlan && state.currentPlan) {
        await executeAndReply(state.currentPlan);
      } else {
        addLog("error", "Message is empty.");
      }
      return null;
    }

    addMessage("user", prompt);
    nodes.promptInput.value = "";
    resizeComposer();

    var plan = await createPlanFromPrompt(prompt, !executeAfterPlan);
    if (plan && executeAfterPlan) {
      await executeAndReply(plan);
    }
    return plan;
  }

  async function makePlan() {
    return handlePrompt(false);
  }

  async function runPlan() {
    return handlePrompt(true);
  }

  async function pollRemoteJob() {
    var endpoint = root.provider.getEndpointBase();

    if (!endpoint || state.busy || state.pollingJob || !state.hostInfo) {
      return;
    }

    state.pollingJob = true;
    try {
      var host = root.agent.normalizeHost(state.hostInfo);
      var job = await root.provider.fetchNextJob(host);

      if (!job) {
        return;
      }

      addLog("mcp", "Received Adobe job " + job.id + ".");
      addMessage("user", job.prompt || "MCP job", {
        sender: "MCP"
      });
      renderPlan(job.plan);
      addMessage("assistant", "Queued job ready.", {
        plan: job.plan
      });
      var result = await executeAndReply(job.plan);
      await root.provider.submitJobResult(job.id, {
        ok: didPlanSucceed(result),
        result: result
      });
      addLog("mcp", "Reported result for " + job.id + ".");
    } catch (error) {
      addLog("error", error.message);
    } finally {
      state.pollingJob = false;
    }
  }

  function startJobPolling() {
    if (state.jobPollTimer) {
      window.clearInterval(state.jobPollTimer);
    }

    if (!root.provider.getEndpointBase()) {
      return;
    }

    state.jobPollTimer = window.setInterval(pollRemoteJob, 2500);
    pollRemoteJob();
  }

  function copyPlan() {
    if (!state.currentPlan) {
      return;
    }

    var text = JSON.stringify(state.currentPlan, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        addLog("copy", "Plan copied.");
      });
    }
  }

  function openSettings() {
    var settings = root.provider.loadSettings();
    nodes.endpointInput.value = settings.endpoint || "";
    nodes.settingsDialog.showModal();
  }

  function saveSettings() {
    root.provider.saveSettings({
      endpoint: nodes.endpointInput.value.trim()
    });
    updateHostUi();
    startJobPolling();
    addLog("settings", "Provider settings saved.");
  }

  function clearSession() {
    nodes.logList.innerHTML = "";
    nodes.planList.innerHTML = "";
    nodes.messageList.innerHTML = "";
    state.currentPlan = null;
    state.welcomed = false;
    addWelcomeMessage();
  }

  function bindEvents() {
    nodes.refreshHostButton.addEventListener("click", refreshHost);
    nodes.planButton.addEventListener("click", makePlan);
    nodes.composerForm.addEventListener("submit", function (event) {
      event.preventDefault();
      runPlan();
    });
    nodes.clearButton.addEventListener("click", clearSession);
    nodes.copyPlanButton.addEventListener("click", copyPlan);
    nodes.settingsButton.addEventListener("click", openSettings);
    nodes.saveSettingsButton.addEventListener("click", saveSettings);
    nodes.promptInput.addEventListener("input", resizeComposer);
    nodes.promptInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        runPlan();
      }
    });

    Array.prototype.forEach.call(document.querySelectorAll(".tool-chip"), function (button) {
      button.addEventListener("click", function () {
        nodes.promptInput.value = button.getAttribute("data-command");
        resizeComposer();
        makePlan();
      });
    });
  }

  function init() {
    [
      "hostLabel",
      "hostMetric",
      "modeMetric",
      "promptInput",
      "runButton",
      "planButton",
      "clearButton",
      "refreshHostButton",
      "planList",
      "logList",
      "runState",
      "copyPlanButton",
      "settingsButton",
      "settingsDialog",
      "endpointInput",
      "saveSettingsButton",
      "messageList",
      "composerForm"
    ].forEach(function (id) {
      nodes[id] = $(id);
    });

    bindEvents();
    resizeComposer();
    refreshHost().then(function () {
      startJobPolling();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
