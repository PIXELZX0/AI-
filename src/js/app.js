(function () {
  "use strict";

  var root = window.AIPlus || (window.AIPlus = {});
  var keys = {
    sessions: "ai-plus-sessions",
    activeSession: "ai-plus-active-session",
    skills: "ai-plus-skills",
    checkpoints: "ai-plus-checkpoints"
  };

  var state = {
    hostInfo: null,
    currentPlan: null,
    busy: false,
    cancelRequested: false,
    pollingJob: false,
    jobPollTimer: null,
    sessions: [],
    activeSession: null,
    logs: [],
    skills: [],
    attachments: [],
    checkpoints: [],
    settings: null,
    editingMessageId: "",
    drawerTab: "history",
    inspectorTab: "plan",
    drawerVisible: true,
    mcpMode: false
  };

  var nodes = {};

  function $(id) {
    return document.getElementById(id);
  }

  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatTime(value) {
    var date = value ? new Date(value) : new Date();
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function formatDate(value) {
    var date = value ? new Date(value) : new Date();
    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric"
    }) + " " + formatTime(date.toISOString());
  }

  function formatBytes(size) {
    var value = Number(size) || 0;
    if (value < 1024) {
      return value + " B";
    }
    if (value < 1024 * 1024) {
      return Math.round(value / 1024) + " KB";
    }
    return (value / (1024 * 1024)).toFixed(1) + " MB";
  }

  function loadJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch (error) {
      return fallback;
    }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "skill";
  }

  function defaultSkills() {
    return [
      {
        id: "kinetic-type",
        name: "Kinetic Type",
        scope: "global",
        description: "Animated text reveal with overshoot timing",
        instructions: "Use short staggered opacity and position keyframes. Prefer easy ease, motion blur, and clean layer names."
      },
      {
        id: "review-prep",
        name: "Review Prep",
        scope: "global",
        description: "Prepare comps for client review",
        instructions: "Add review markers, keep source layers intact, organize comps and exports, then queue a safe render only when asked."
      },
      {
        id: "brand-cleanup",
        name: "Brand Cleanup",
        scope: "project",
        description: "Apply project naming and typography conventions",
        instructions: "Use preferred fonts from settings, normalize layer names, and preserve existing brand colors unless the prompt says otherwise."
      }
    ];
  }

  function createSession(title) {
    var now = new Date().toISOString();
    return {
      id: uid("chat"),
      title: title || "New chat",
      createdAt: now,
      updatedAt: now,
      messages: []
    };
  }

  function loadPersistentState() {
    state.settings = root.provider.loadSettings();
    state.sessions = loadJson(keys.sessions, []);
    state.skills = loadJson(keys.skills, null) || defaultSkills();
    state.checkpoints = loadJson(keys.checkpoints, []);

    if (!state.sessions.length) {
      state.sessions.push(createSession());
    }

    var activeId = localStorage.getItem(keys.activeSession);
    state.activeSession = state.sessions.filter(function (session) {
      return session.id === activeId;
    })[0] || state.sessions[0];

    persistSkills();
    persistSessions();
  }

  function persistSkills() {
    saveJson(keys.skills, state.skills);
  }

  function persistCheckpoints() {
    saveJson(keys.checkpoints, state.checkpoints.slice(0, 50));
  }

  function persistSessions() {
    if (!state.activeSession) {
      return;
    }

    state.activeSession.updatedAt = new Date().toISOString();
    state.sessions = state.sessions.filter(function (session) {
      return session.id !== state.activeSession.id;
    });
    state.sessions.unshift(state.activeSession);
    state.sessions = state.sessions.slice(0, 30);
    saveJson(keys.sessions, state.sessions);
    localStorage.setItem(keys.activeSession, state.activeSession.id);
    renderHistory();
  }

  function setBusy(busy) {
    state.busy = busy;
    state.cancelRequested = false;
    nodes.planButton.disabled = busy;
    nodes.runButton.textContent = busy ? "Stop" : "Run";
    nodes.runState.textContent = busy ? "Working" : "Idle";

    Array.prototype.forEach.call(document.querySelectorAll(".message-run-button"), function (button) {
      button.disabled = busy;
    });
  }

  function requestStop() {
    if (!state.busy) {
      return;
    }
    state.cancelRequested = true;
    nodes.runState.textContent = "Stopping";
    addLog("stop", "Stop requested.");
  }

  function scrollMessagesToBottom() {
    nodes.messageList.scrollTop = nodes.messageList.scrollHeight;
  }

  function resizeComposer() {
    nodes.promptInput.style.height = "0px";
    nodes.promptInput.style.height = Math.min(nodes.promptInput.scrollHeight, 150) + "px";
  }

  function writeClipboard(text, label) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        addLog("copy", label || "Copied.");
      });
    } else {
      addLog("copy", "Clipboard unavailable.");
    }
  }

  function addLog(kind, message) {
    state.logs.push({
      kind: kind,
      message: message,
      time: new Date().toISOString()
    });
    state.logs = state.logs.slice(-120);
    renderLogs();
  }

  function renderLogs() {
    nodes.logList.innerHTML = "";
    state.logs.forEach(function (entry) {
      var row = document.createElement("div");
      row.className = "log-entry" + (entry.kind === "error" ? " error" : "");
      row.innerHTML = "<strong>" + escapeHtml(entry.kind) + "</strong> " + escapeHtml(entry.message);
      nodes.logList.appendChild(row);
    });
    nodes.logList.scrollTop = nodes.logList.scrollHeight;
  }

  function planActionHtml(action, index) {
    var tool = root.toolRegistry.find(action.tool);
    return "<div class=\"message-action\">" +
      "<div class=\"action-index\">" + (index + 1) + "</div>" +
      "<div><strong>" + escapeHtml(tool ? tool.label : action.tool) + "</strong>" +
      "<span>" + escapeHtml(action.reason || "Ready to execute.") + "</span></div>" +
      "</div>";
  }

  function renderPlanActionsHtml(plan) {
    var actions = plan && plan.actions || [];

    if (!actions.length) {
      return "<div class=\"result-row error\">No safe actions available for this host.</div>";
    }

    return actions.map(planActionHtml).join("");
  }

  function renderResultRowsHtml(result) {
    var rows = result && result.value && result.value.results || [];

    if (!result || !result.ok) {
      return "<div class=\"result-row error\">" + escapeHtml(result && result.error ? result.error : "Host execution failed.") + "</div>";
    }

    if (!rows.length) {
      return "<div class=\"result-row ok\">Completed.</div>";
    }

    return rows.map(function (item) {
      return "<div class=\"result-row " + (item.ok ? "ok" : "error") + "\">" +
        escapeHtml(item.message || item.tool || "Completed.") +
        "</div>";
    }).join("");
  }

  function attachmentsHtml(attachments) {
    attachments = attachments || [];
    if (!attachments.length) {
      return "";
    }

    return "<div class=\"message-attachments\">" + attachments.map(function (attachment) {
      return "<div class=\"attachment-card\"><div><strong>" + escapeHtml(attachment.name) + "</strong>" +
        "<span class=\"attachment-meta\">" + escapeHtml(attachment.type || "file") + " · " + formatBytes(attachment.size) + "</span></div></div>";
    }).join("") + "</div>";
  }

  function renderMessage(message) {
    var article = document.createElement("article");
    var label = message.sender || (message.role === "user" ? "You" : "AI+");
    var initials = message.role === "user" ? label.slice(0, 3) : "AI";
    var body = "<div class=\"avatar\">" + escapeHtml(initials) + "</div>" +
      "<div class=\"bubble\">" +
      "<div class=\"bubble-meta\"><span>" + escapeHtml(label) + "</span><span>" + formatTime(message.time) + "</span></div>" +
      "<p>" + escapeHtml(message.text) + "</p>";

    if (message.skills && message.skills.length) {
      body += "<div class=\"message-attachments\">" + message.skills.map(function (skill) {
        return "<div class=\"result-row\"><strong>/" + escapeHtml(skill.id) + "</strong> " + escapeHtml(skill.description || "") + "</div>";
      }).join("") + "</div>";
    }

    body += attachmentsHtml(message.attachments);

    if (message.plan) {
      body += "<div class=\"message-plan\">" + renderPlanActionsHtml(message.plan) + "</div>";
      if (message.showRunButton && message.plan.actions && message.plan.actions.length) {
        body += "<div class=\"message-buttons\"><button class=\"primary-button message-run-button\" type=\"button\" data-action=\"run-plan\" data-message-id=\"" + message.id + "\">Run</button></div>";
      }
    }

    if (message.result) {
      body += "<div class=\"message-result\">" + renderResultRowsHtml(message.result) + "</div>";
    }

    if (message.checkpoint) {
      body += "<div class=\"message-result\"><button class=\"checkpoint-row\" type=\"button\" data-action=\"restore-checkpoint\" data-checkpoint-id=\"" + message.checkpoint.id + "\">" +
        "<strong>" + escapeHtml(message.checkpoint.label) + "</strong>" +
        "<span class=\"item-meta\">" + escapeHtml(message.checkpoint.path || "checkpoint") + "</span>" +
        "</button></div>";
    }

    body += "<div class=\"message-actions\">";
    if (message.role === "user") {
      body += "<button type=\"button\" data-action=\"edit-message\" data-message-id=\"" + message.id + "\">Edit</button>";
      body += "<button type=\"button\" data-action=\"branch-message\" data-message-id=\"" + message.id + "\">Branch</button>";
    }
    if (message.plan) {
      body += "<button type=\"button\" data-action=\"copy-plan\" data-message-id=\"" + message.id + "\">Copy plan</button>";
    }
    body += "</div></div>";

    article.className = "message " + message.role;
    article.innerHTML = body;
    nodes.messageList.appendChild(article);
  }

  function renderMessages() {
    nodes.messageList.innerHTML = "";

    if (!state.activeSession.messages.length) {
      renderMessage({
        id: "welcome",
        role: "assistant",
        text: "Ready.",
        time: new Date().toISOString(),
        sender: "AI+"
      });
      return;
    }

    state.activeSession.messages.forEach(renderMessage);
    scrollMessagesToBottom();
  }

  function addMessage(role, text, options) {
    var opts = options || {};
    var message = {
      id: uid("msg"),
      role: role,
      text: text,
      time: new Date().toISOString(),
      sender: opts.sender || "",
      plan: opts.plan || null,
      result: opts.result || null,
      checkpoint: opts.checkpoint || null,
      attachments: opts.attachments || [],
      skills: opts.skills || [],
      showRunButton: Boolean(opts.showRunButton)
    };

    if (opts.persist !== false) {
      state.activeSession.messages.push(message);
      if (role === "user" && state.activeSession.title === "New chat") {
        state.activeSession.title = text.slice(0, 46) || "New chat";
      }
      persistSessions();
    }

    renderMessages();
    return message;
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

  function renderHistory() {
    if (!nodes.historyList) {
      return;
    }
    nodes.historyList.innerHTML = "";

    state.sessions.forEach(function (session) {
      var item = document.createElement("div");
      item.className = "stack-item" + (state.activeSession && session.id === state.activeSession.id ? " active" : "");
      item.innerHTML =
        "<strong>" + escapeHtml(session.title || "New chat") + "</strong>" +
        "<span class=\"item-meta\">" + escapeHtml(formatDate(session.updatedAt)) + " · " + (session.messages || []).length + " messages</span>" +
        "<button type=\"button\" data-session-id=\"" + session.id + "\">Open</button>";
      nodes.historyList.appendChild(item);
    });
  }

  function renderSkills() {
    nodes.skillList.innerHTML = "";

    state.skills.forEach(function (skill) {
      var item = document.createElement("div");
      item.className = "stack-item";
      item.innerHTML =
        "<strong>/" + escapeHtml(skill.id) + "</strong>" +
        "<span class=\"item-meta\">" + escapeHtml(skill.scope || "global") + " · " + escapeHtml(skill.description || "") + "</span>" +
        "<div class=\"message-actions\">" +
        "<button type=\"button\" data-skill-action=\"use\" data-skill-id=\"" + skill.id + "\">Use</button>" +
        "<button type=\"button\" data-skill-action=\"copy\" data-skill-id=\"" + skill.id + "\">Copy</button>" +
        "<button type=\"button\" data-skill-action=\"delete\" data-skill-id=\"" + skill.id + "\">Delete</button>" +
        "</div>";
      nodes.skillList.appendChild(item);
    });
  }

  function renderAttachments() {
    nodes.attachmentList.innerHTML = "";

    state.attachments.forEach(function (attachment) {
      var card = document.createElement("div");
      card.className = "attachment-card";
      card.innerHTML =
        "<div><strong>" + escapeHtml(attachment.name) + "</strong>" +
        "<span class=\"attachment-meta\">" + escapeHtml(attachment.type || "file") + " · " + formatBytes(attachment.size) + "</span></div>" +
        "<button type=\"button\" data-remove-attachment=\"" + attachment.id + "\">×</button>";
      nodes.attachmentList.appendChild(card);
    });
  }

  function renderCheckpoints() {
    nodes.checkpointList.innerHTML = "";

    if (!state.checkpoints.length) {
      var empty = document.createElement("div");
      empty.className = "checkpoint-row";
      empty.innerHTML = "<strong>No checkpoints</strong><span class=\"item-meta\">Save the project once, then run an automation.</span>";
      nodes.checkpointList.appendChild(empty);
      return;
    }

    state.checkpoints.forEach(function (checkpoint) {
      var row = document.createElement("div");
      row.className = "checkpoint-row";
      row.innerHTML =
        "<strong>" + escapeHtml(checkpoint.label) + "</strong>" +
        "<span class=\"item-meta\">" + escapeHtml(formatDate(checkpoint.createdAt)) + "</span>" +
        "<button type=\"button\" data-checkpoint-id=\"" + checkpoint.id + "\">Restore</button>";
      nodes.checkpointList.appendChild(row);
    });
  }

  function updateHostUi() {
    var info = state.hostInfo || {};
    var normalized = root.agent.normalizeHost(info);
    var label = info.appName ? info.appName + " " + (info.appVersion || "") : "Adobe panel";
    var settings = root.provider.loadSettings();
    var mode = settings.endpoint ? "Endpoint" : (settings.provider === "anthropic" ? "Claude" : "Codex");

    nodes.hostLabel.textContent = label;
    nodes.hostMetric.textContent = normalized.replace("-", " ");
    nodes.modeMetric.textContent = mode;
    nodes.licensePill.textContent = settings.provider === "endpoint" ? "Local bridge" : "Local trial";
  }

  async function refreshHost() {
    var result = await root.cep.runHostCommand("getHostInfo", {});

    if (result.ok) {
      state.hostInfo = result.value || {};
      updateHostUi();
      addLog("host", "Connected to " + (state.hostInfo.appName || "preview host") + ".");
    } else {
      addLog("error", result.error || "Unable to read host info.");
    }
  }

  function getPromptSkills(prompt) {
    var text = String(prompt || "").toLowerCase();
    return state.skills.filter(function (skill) {
      return text.indexOf("/" + skill.id.toLowerCase()) !== -1 ||
        text.indexOf(String(skill.name || "").toLowerCase()) !== -1;
    });
  }

  function promptOptionsFor(prompt) {
    return {
      attachments: state.attachments.map(function (attachment) {
        return {
          id: attachment.id,
          name: attachment.name,
          type: attachment.type,
          size: attachment.size,
          path: attachment.path,
          text: attachment.text || ""
        };
      }),
      skills: getPromptSkills(prompt)
    };
  }

  async function createPlanFromPrompt(prompt, showRunButton, options) {
    setBusy(true);
    try {
      var plan = await root.agent.createPlan(prompt, state.hostInfo, options || {});
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

  async function createCheckpoint(label, visible) {
    var result = await root.cep.runHostCommand("createCheckpoint", {
      label: label || "AI+ checkpoint",
      visible: visible !== false
    });

    if (!result.ok) {
      addLog("warn", result.error || "Checkpoint unavailable.");
      return null;
    }

    if (result.value && result.value.skipped) {
      addLog("checkpoint", result.value.message || "Checkpoint skipped.");
      return null;
    }

    var value = result.value || {};
    var checkpoint = {
      id: uid("checkpoint"),
      label: value.label || label || "AI+ checkpoint",
      path: value.path || "",
      createdAt: new Date().toISOString(),
      visible: visible !== false
    };

    state.checkpoints.unshift(checkpoint);
    state.checkpoints = state.checkpoints.slice(0, 50);
    persistCheckpoints();
    renderCheckpoints();
    addLog("checkpoint", value.message || "Checkpoint created.");
    return checkpoint;
  }

  async function restoreCheckpoint(checkpoint) {
    if (!checkpoint) {
      return;
    }

    if (root.provider.loadSettings().confirmReverts && !window.confirm("Restore checkpoint \"" + checkpoint.label + "\"?")) {
      return;
    }

    setBusy(true);
    try {
      var result = await root.cep.runHostCommand("restoreCheckpoint", {
        path: checkpoint.path
      });
      if (!result.ok) {
        addLog("error", result.error || "Checkpoint restore failed.");
        return;
      }
      addLog("checkpoint", result.value && result.value.message || "Checkpoint restored.");
      addMessage("assistant", "Checkpoint restored.", {
        result: result
      });
    } finally {
      setBusy(false);
    }
  }

  async function executePlan(plan) {
    if (!plan || !plan.actions || !plan.actions.length) {
      return {
        result: {
          ok: false,
          error: "Plan has no executable actions."
        },
        checkpoint: null
      };
    }

    setBusy(true);
    try {
      await createCheckpoint("Before " + (plan.title || "automation"), false);

      if (state.cancelRequested) {
        return {
          result: {
            ok: false,
            error: "Stopped before execution."
          },
          checkpoint: null
        };
      }

      var result = await root.agent.executePlan(plan);
      var checkpoint = didPlanSucceed(result) ? await createCheckpoint("After " + (plan.title || "automation"), true) : null;

      if (!result.ok) {
        addLog("error", result.error || "Host execution failed.");
        return {
          result: result,
          checkpoint: checkpoint
        };
      }

      (result.value && result.value.results || []).forEach(function (item) {
        addLog(item.ok ? "done" : "error", item.message || item.tool);
      });

      if (root.provider.loadSettings().notificationSound) {
        playDoneSound();
      }

      return {
        result: result,
        checkpoint: checkpoint
      };
    } catch (error) {
      addLog("error", error.message);
      return {
        result: {
          ok: false,
          error: error.message
        },
        checkpoint: null
      };
    } finally {
      setBusy(false);
    }
  }

  async function executeAndReply(plan) {
    var outcome = await executePlan(plan);
    var success = didPlanSucceed(outcome.result);
    addMessage("assistant", success ? "Done." : "I ran into an issue.", {
      result: outcome.result,
      checkpoint: outcome.checkpoint
    });
    return outcome.result;
  }

  async function handlePrompt(executeAfterPlan) {
    var prompt = nodes.promptInput.value.trim();

    if (state.busy) {
      requestStop();
      return null;
    }

    if (!prompt) {
      if (executeAfterPlan && state.currentPlan) {
        await executeAndReply(state.currentPlan);
      } else {
        addLog("error", "Message is empty.");
      }
      return null;
    }

    var options = promptOptionsFor(prompt);

    if (state.editingMessageId) {
      var index = state.activeSession.messages.map(function (message) {
        return message.id;
      }).indexOf(state.editingMessageId);
      if (index !== -1) {
        state.activeSession.messages = state.activeSession.messages.slice(0, index);
      }
      state.editingMessageId = "";
      renderMessages();
      addLog("edit", "Message replaced.");
    }

    addMessage("user", prompt, {
      attachments: options.attachments,
      skills: options.skills
    });
    nodes.promptInput.value = "";
    state.attachments = [];
    renderAttachments();
    renderSkillMenu();
    resizeComposer();

    var plan = await createPlanFromPrompt(prompt, !executeAfterPlan, options);
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

  function playDoneSound() {
    try {
      var AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        return;
      }
      var context = new AudioContext();
      var oscillator = context.createOscillator();
      var gain = context.createGain();
      oscillator.frequency.value = 660;
      gain.gain.value = 0.05;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.08);
    } catch (error) {
      // Audio is optional.
    }
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
    writeClipboard(JSON.stringify(state.currentPlan, null, 2), "Plan copied.");
  }

  function openSettings() {
    var settings = root.provider.loadSettings();
    nodes.providerSelect.value = settings.provider || "openai";
    nodes.modelInput.value = settings.model || "";
    nodes.endpointInput.value = settings.endpoint || "";
    nodes.openRouterInput.value = settings.openRouterKey || "";
    nodes.imageModelSelect.value = settings.imageModel || "google/nano-banana";
    nodes.preferredFontsInput.value = settings.preferredFonts || "";
    nodes.mcpPortInput.value = settings.mcpPort || 8787;
    nodes.confirmRevertsInput.checked = settings.confirmReverts !== false;
    nodes.notificationSoundInput.checked = Boolean(settings.notificationSound);
    nodes.mcpClaudeInput.checked = Boolean(settings.mcpClaude);
    nodes.mcpUrlInput.checked = Boolean(settings.mcpUrl);
    nodes.settingsDialog.showModal();
  }

  function saveSettings() {
    var settings = root.provider.mergeSettings({
      provider: nodes.providerSelect.value,
      model: nodes.modelInput.value.trim(),
      endpoint: nodes.endpointInput.value.trim(),
      thinking: nodes.thinkingSelect.value,
      openRouterKey: nodes.openRouterInput.value.trim(),
      imageModel: nodes.imageModelSelect.value,
      preferredFonts: nodes.preferredFontsInput.value.trim(),
      confirmReverts: nodes.confirmRevertsInput.checked,
      notificationSound: nodes.notificationSoundInput.checked,
      mcpClaude: nodes.mcpClaudeInput.checked,
      mcpUrl: nodes.mcpUrlInput.checked,
      mcpPort: Number(nodes.mcpPortInput.value) || 8787
    });

    root.provider.saveSettings(settings);
    state.settings = settings;
    updateHostUi();
    updateMcpOverlay();
    startJobPolling();
    addLog("settings", "Settings saved.");
  }

  function quickSaveComposerSettings() {
    var settings = root.provider.loadSettings();
    settings.thinking = nodes.thinkingSelect.value;
    if (nodes.modelSelect.value === "endpoint") {
      settings.provider = "endpoint";
    } else if (nodes.modelSelect.value === "claude") {
      settings.provider = "anthropic";
    } else {
      settings.provider = "openai";
    }
    root.provider.saveSettings(settings);
    updateHostUi();
  }

  function switchSession(sessionId) {
    persistSessions();
    var next = state.sessions.filter(function (session) {
      return session.id === sessionId;
    })[0];
    if (!next) {
      return;
    }
    state.activeSession = next;
    state.currentPlan = null;
    renderMessages();
    renderHistory();
    addLog("history", "Opened " + next.title + ".");
  }

  function startNewChat() {
    persistSessions();
    state.activeSession = createSession();
    state.currentPlan = null;
    state.attachments = [];
    state.editingMessageId = "";
    persistSessions();
    renderMessages();
    renderAttachments();
    renderPlan(null);
    addLog("chat", "New chat started.");
  }

  function branchFromMessage(messageId) {
    var messages = state.activeSession.messages;
    var index = messages.map(function (message) {
      return message.id;
    }).indexOf(messageId);

    if (index === -1) {
      return;
    }

    persistSessions();
    state.activeSession = createSession((state.activeSession.title || "Chat") + " branch");
    state.activeSession.messages = messages.slice(0, index + 1).map(function (message) {
      var copy = JSON.parse(JSON.stringify(message));
      copy.id = uid("msg");
      return copy;
    });
    persistSessions();
    renderMessages();
    addLog("branch", "Conversation branched.");
  }

  function editMessage(messageId) {
    var message = state.activeSession.messages.filter(function (item) {
      return item.id === messageId;
    })[0];
    if (!message) {
      return;
    }
    state.editingMessageId = messageId;
    nodes.promptInput.value = message.text;
    resizeComposer();
    nodes.promptInput.focus();
    addLog("edit", "Editing previous message.");
  }

  function addFiles(files) {
    Array.prototype.forEach.call(files || [], function (file) {
      var attachment = {
        id: uid("file"),
        name: file.name || "Attachment",
        type: file.type || "file",
        size: file.size || 0,
        path: file.path || file.fullPath || "",
        text: ""
      };
      state.attachments.push(attachment);

      if ((file.type || "").indexOf("text/") === 0 || /\.(csv|tsv|json|md|txt|xml|html)$/i.test(file.name || "")) {
        var reader = new FileReader();
        reader.onload = function () {
          attachment.text = String(reader.result || "").slice(0, 12000);
          renderAttachments();
        };
        reader.readAsText(file);
      }
    });
    renderAttachments();
  }

  function removeAttachment(id) {
    state.attachments = state.attachments.filter(function (attachment) {
      return attachment.id !== id;
    });
    renderAttachments();
  }

  function saveSkill(event) {
    event.preventDefault();
    var name = nodes.skillNameInput.value.trim();
    var instructions = nodes.skillInstructionInput.value.trim();
    var id = slugify(name);

    if (!name || !instructions) {
      addLog("error", "Skill name and instructions are required.");
      return;
    }

    state.skills = state.skills.filter(function (skill) {
      return skill.id !== id;
    });
    state.skills.unshift({
      id: id,
      name: name,
      description: nodes.skillDescriptionInput.value.trim(),
      scope: nodes.skillScopeInput.value,
      instructions: instructions
    });
    persistSkills();
    renderSkills();
    nodes.skillForm.reset();
    addLog("skill", "Saved /" + id + ".");
  }

  function handleSkillAction(action, id) {
    var skill = state.skills.filter(function (item) {
      return item.id === id;
    })[0];
    if (!skill) {
      return;
    }

    if (action === "use") {
      nodes.promptInput.value = "/" + skill.id + " " + nodes.promptInput.value;
      nodes.promptInput.focus();
      resizeComposer();
      renderSkillMenu();
      return;
    }

    if (action === "copy") {
      writeClipboard("---\nname: " + skill.id + "\ndescription: " + (skill.description || "") + "\n---\n\n" + skill.instructions, "Skill copied.");
      return;
    }

    if (action === "delete" && window.confirm("Delete /" + skill.id + "?")) {
      state.skills = state.skills.filter(function (item) {
        return item.id !== id;
      });
      persistSkills();
      renderSkills();
      addLog("skill", "Deleted /" + id + ".");
    }
  }

  function renderSkillMenu() {
    var value = nodes.promptInput.value;
    var slashIndex = value.lastIndexOf("/");
    var query = slashIndex === -1 ? "" : value.slice(slashIndex + 1).toLowerCase();

    if (slashIndex === -1 || /\s/.test(query)) {
      nodes.skillMenu.classList.add("hidden");
      nodes.skillMenu.innerHTML = "";
      return;
    }

    var matches = state.skills.filter(function (skill) {
      return skill.id.indexOf(query) !== -1 || String(skill.name || "").toLowerCase().indexOf(query) !== -1;
    }).slice(0, 8);

    if (!matches.length) {
      nodes.skillMenu.classList.add("hidden");
      return;
    }

    nodes.skillMenu.innerHTML = matches.map(function (skill) {
      return "<button class=\"skill-option\" type=\"button\" data-insert-skill=\"" + skill.id + "\">" +
        "<strong>/" + escapeHtml(skill.id) + "</strong><span>" + escapeHtml(skill.description || skill.name) + "</span></button>";
    }).join("");
    nodes.skillMenu.classList.remove("hidden");
  }

  function insertSkillToken(id) {
    var value = nodes.promptInput.value;
    var slashIndex = value.lastIndexOf("/");
    nodes.promptInput.value = (slashIndex === -1 ? value : value.slice(0, slashIndex)) + "/" + id + " ";
    nodes.promptInput.focus();
    resizeComposer();
    renderSkillMenu();
  }

  function clearActivity() {
    state.logs = [];
    renderLogs();
  }

  function setDrawerTab(tab) {
    state.drawerTab = tab;
    Array.prototype.forEach.call(document.querySelectorAll("[data-drawer-tab]"), function (button) {
      button.classList.toggle("active", button.getAttribute("data-drawer-tab") === tab);
    });
    nodes.historyView.classList.toggle("hidden", tab !== "history");
    nodes.skillsView.classList.toggle("hidden", tab !== "skills");
  }

  function setInspectorTab(tab) {
    state.inspectorTab = tab;
    Array.prototype.forEach.call(document.querySelectorAll("[data-inspector-tab]"), function (button) {
      button.classList.toggle("active", button.getAttribute("data-inspector-tab") === tab);
    });
    nodes.planPane.classList.toggle("hidden", tab !== "plan");
    nodes.checkpointPane.classList.toggle("hidden", tab !== "checkpoints");
    nodes.activityPane.classList.toggle("hidden", tab !== "activity");
  }

  function toggleHistory() {
    state.drawerVisible = !state.drawerVisible;
    nodes.drawerPanel.style.display = state.drawerVisible ? "" : "none";
  }

  function mcpUrl() {
    var settings = root.provider.loadSettings();
    var base = root.provider.getEndpointBase();
    if (base) {
      return base + "/mcp";
    }
    return "http://127.0.0.1:" + (settings.mcpPort || 8787) + "/mcp";
  }

  function updateMcpOverlay() {
    var settings = root.provider.loadSettings();
    var enabled = state.mcpMode || settings.mcpClaude || settings.mcpUrl;
    nodes.mcpUrlLabel.textContent = mcpUrl();
    nodes.mcpOverlay.classList.toggle("hidden", !enabled);
    nodes.mcpModeButton.classList.toggle("active", enabled);
  }

  function toggleMcpMode() {
    state.mcpMode = !state.mcpMode;
    updateMcpOverlay();
    addLog("mcp", state.mcpMode ? "MCP mode enabled." : "MCP mode disabled.");
  }

  function handleMessageClick(event) {
    var button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    var action = button.getAttribute("data-action");
    var messageId = button.getAttribute("data-message-id");

    if (action === "edit-message") {
      editMessage(messageId);
      return;
    }

    if (action === "branch-message") {
      branchFromMessage(messageId);
      return;
    }

    if (action === "run-plan") {
      var message = state.activeSession.messages.filter(function (item) {
        return item.id === messageId;
      })[0];
      if (message && message.plan) {
        state.currentPlan = message.plan;
        executeAndReply(message.plan);
      }
      return;
    }

    if (action === "copy-plan") {
      var planMessage = state.activeSession.messages.filter(function (item) {
        return item.id === messageId;
      })[0];
      if (planMessage && planMessage.plan) {
        writeClipboard(JSON.stringify(planMessage.plan, null, 2), "Plan copied.");
      }
      return;
    }

    if (action === "restore-checkpoint") {
      var checkpointId = button.getAttribute("data-checkpoint-id");
      restoreCheckpoint(state.checkpoints.filter(function (checkpoint) {
        return checkpoint.id === checkpointId;
      })[0]);
    }
  }

  function bindEvents() {
    nodes.refreshHostButton.addEventListener("click", refreshHost);
    nodes.planButton.addEventListener("click", makePlan);
    nodes.composerForm.addEventListener("submit", function (event) {
      event.preventDefault();
      runPlan();
    });
    nodes.runButton.addEventListener("click", function (event) {
      if (state.busy) {
        event.preventDefault();
        requestStop();
      }
    });
    nodes.clearButton.addEventListener("click", clearActivity);
    nodes.copyPlanButton.addEventListener("click", copyPlan);
    nodes.settingsButton.addEventListener("click", openSettings);
    nodes.saveSettingsButton.addEventListener("click", saveSettings);
    nodes.newChatButton.addEventListener("click", startNewChat);
    nodes.historyButton.addEventListener("click", toggleHistory);
    nodes.mcpModeButton.addEventListener("click", toggleMcpMode);
    nodes.leaveMcpButton.addEventListener("click", function () {
      state.mcpMode = false;
      var settings = root.provider.loadSettings();
      settings.mcpClaude = false;
      settings.mcpUrl = false;
      root.provider.saveSettings(settings);
      updateMcpOverlay();
    });
    nodes.copyMcpUrlButton.addEventListener("click", function () {
      writeClipboard(mcpUrl(), "MCP URL copied.");
    });
    nodes.checkpointButton.addEventListener("click", function () {
      createCheckpoint("Manual checkpoint", true);
    });

    nodes.thinkingSelect.addEventListener("change", quickSaveComposerSettings);
    nodes.modelSelect.addEventListener("change", quickSaveComposerSettings);

    nodes.promptInput.addEventListener("input", function () {
      resizeComposer();
      renderSkillMenu();
    });
    nodes.promptInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        runPlan();
      }
    });
    nodes.promptInput.addEventListener("paste", function (event) {
      if (event.clipboardData && event.clipboardData.files && event.clipboardData.files.length) {
        addFiles(event.clipboardData.files);
      }
    });

    nodes.attachButton.addEventListener("click", function () {
      nodes.fileInput.click();
    });
    nodes.fileInput.addEventListener("change", function () {
      addFiles(nodes.fileInput.files);
      nodes.fileInput.value = "";
    });

    nodes.chatPanel.addEventListener("dragover", function (event) {
      event.preventDefault();
    });
    nodes.chatPanel.addEventListener("drop", function (event) {
      event.preventDefault();
      if (event.dataTransfer && event.dataTransfer.files) {
        addFiles(event.dataTransfer.files);
      }
    });

    nodes.messageList.addEventListener("click", handleMessageClick);
    nodes.historyList.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-session-id]");
      if (button) {
        switchSession(button.getAttribute("data-session-id"));
      }
    });
    nodes.attachmentList.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-remove-attachment]");
      if (button) {
        removeAttachment(button.getAttribute("data-remove-attachment"));
      }
    });
    nodes.checkpointList.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-checkpoint-id]");
      if (button) {
        restoreCheckpoint(state.checkpoints.filter(function (checkpoint) {
          return checkpoint.id === button.getAttribute("data-checkpoint-id");
        })[0]);
      }
    });
    nodes.skillList.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-skill-action]");
      if (button) {
        handleSkillAction(button.getAttribute("data-skill-action"), button.getAttribute("data-skill-id"));
      }
    });
    nodes.skillMenu.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-insert-skill]");
      if (button) {
        insertSkillToken(button.getAttribute("data-insert-skill"));
      }
    });
    nodes.skillForm.addEventListener("submit", saveSkill);

    Array.prototype.forEach.call(document.querySelectorAll("[data-drawer-tab]"), function (button) {
      button.addEventListener("click", function () {
        setDrawerTab(button.getAttribute("data-drawer-tab"));
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-inspector-tab]"), function (button) {
      button.addEventListener("click", function () {
        setInspectorTab(button.getAttribute("data-inspector-tab"));
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".tool-chip"), function (button) {
      button.addEventListener("click", function () {
        nodes.promptInput.value = button.getAttribute("data-command");
        resizeComposer();
        renderSkillMenu();
        makePlan();
      });
    });
    window.addEventListener("beforeunload", persistSessions);
  }

  function syncComposerControls() {
    var settings = root.provider.loadSettings();
    nodes.thinkingSelect.value = settings.thinking || "auto";
    nodes.modelSelect.value = settings.provider === "endpoint" ? "endpoint" : (settings.provider === "anthropic" ? "claude" : "codex");
  }

  function initNodes() {
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
      "composerForm",
      "licensePill",
      "newChatButton",
      "historyButton",
      "mcpModeButton",
      "drawerPanel",
      "historyView",
      "skillsView",
      "historyList",
      "skillList",
      "skillForm",
      "skillNameInput",
      "skillDescriptionInput",
      "skillScopeInput",
      "skillInstructionInput",
      "chatPanel",
      "mcpOverlay",
      "mcpUrlLabel",
      "copyMcpUrlButton",
      "leaveMcpButton",
      "attachmentList",
      "fileInput",
      "attachButton",
      "skillMenu",
      "thinkingSelect",
      "modelSelect",
      "planPane",
      "checkpointPane",
      "activityPane",
      "checkpointButton",
      "checkpointList",
      "providerSelect",
      "modelInput",
      "openRouterInput",
      "imageModelSelect",
      "preferredFontsInput",
      "mcpPortInput",
      "confirmRevertsInput",
      "notificationSoundInput",
      "mcpClaudeInput",
      "mcpUrlInput"
    ].forEach(function (id) {
      nodes[id] = $(id);
    });
  }

  function init() {
    initNodes();
    loadPersistentState();
    bindEvents();
    syncComposerControls();
    resizeComposer();
    renderMessages();
    renderHistory();
    renderSkills();
    renderAttachments();
    renderCheckpoints();
    renderLogs();
    renderPlan(null);
    setDrawerTab("history");
    setInspectorTab("plan");
    updateMcpOverlay();
    refreshHost().then(function () {
      startJobPolling();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
