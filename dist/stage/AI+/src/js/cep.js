(function () {
  "use strict";

  var root = window.AIPlus || (window.AIPlus = {});
  var hostScriptLoaded = false;

  function isCepAvailable() {
    return Boolean(window.__adobe_cep__ && typeof window.__adobe_cep__.evalScript === "function");
  }

  function escapeForExtendScript(value) {
    return String(value)
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n");
  }

  function evalScript(source) {
    return new Promise(function (resolve) {
      window.__adobe_cep__.evalScript(source, function (result) {
        resolve(result);
      });
    });
  }

  function withHostEngine(source) {
    return "#targetengine \"AIPlus\"\n" + source;
  }

  function hostScriptPath() {
    if (!window.__adobe_cep__.getSystemPath) {
      return "";
    }

    try {
      return window.__adobe_cep__.getSystemPath("extension").replace(/\\/g, "/") + "/host/jsx/ai-plus.jsx";
    } catch (error) {
      return "";
    }
  }

  function parseHostJson(raw, fallbackLabel) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        error: fallbackLabel + ": " + String(raw || "").slice(0, 500),
        raw: raw
      };
    }
  }

  async function ensureHostScript() {
    var path;
    var script;
    var raw;
    var result;

    if (hostScriptLoaded || !isCepAvailable()) {
      return {
        ok: true
      };
    }

    path = hostScriptPath();
    if (!path) {
      return {
        ok: false,
        error: "Unable to resolve the AI+ host script path."
      };
    }

    script = "(function () {" +
      "function s(v){try{return JSON.stringify(v);}catch(e){return '{\"ok\":false,\"error\":\"Unable to stringify host loader response.\"}';}}" +
      "try {" +
      "if (typeof AIPlusHost !== 'undefined' && AIPlusHost.run) { return s({ok:true, alreadyLoaded:true}); }" +
      "$.evalFile(new File('" + escapeForExtendScript(path) + "'));" +
      "if (typeof AIPlusHost !== 'undefined' && AIPlusHost.run) { return s({ok:true, loaded:true}); }" +
      "return s({ok:false, error:'AIPlusHost.run was not defined after loading host/jsx/ai-plus.jsx.'});" +
      "} catch (e) { return s({ok:false, error:e && e.message ? e.message : String(e)}); }" +
      "}())";

    raw = await evalScript(withHostEngine(script));
    result = parseHostJson(raw, "Host script loader returned a non-JSON response");
    hostScriptLoaded = Boolean(result.ok);
    return result;
  }

  function mockHostCommand(commandName, payload) {
    if (commandName === "getHostInfo") {
      return Promise.resolve({
        ok: true,
        mock: true,
        value: {
          appName: "Browser Preview",
          appVersion: "0.0",
          host: "preview"
        }
      });
    }

    if (commandName === "executePlan") {
      return Promise.resolve({
        ok: true,
        mock: true,
        value: {
          results: (payload.actions || []).map(function (action) {
            return {
              ok: true,
              tool: action.tool,
              message: "Previewed " + action.tool + "."
            };
          })
        }
      });
    }

    if (commandName === "createCheckpoint") {
      return Promise.resolve({
        ok: true,
        mock: true,
        value: {
          message: "Preview checkpoint created.",
          label: payload.label || "Preview checkpoint",
          path: "preview://" + Date.now()
        }
      });
    }

    if (commandName === "restoreCheckpoint") {
      return Promise.resolve({
        ok: true,
        mock: true,
        value: {
          message: "Preview checkpoint restored.",
          path: payload.path || ""
        }
      });
    }

    return Promise.resolve({
      ok: true,
      mock: true,
      value: {
        message: "Previewed " + commandName + "."
      }
    });
  }

  async function runHostCommand(commandName, payload) {
    var ready;
    var request;
    var script;
    var raw;

    if (!isCepAvailable()) {
      return mockHostCommand(commandName, payload || {});
    }

    ready = await ensureHostScript();
    if (!ready.ok) {
      return ready;
    }

    request = JSON.stringify({
      command: commandName,
      payload: payload || {}
    });
    script = "AIPlusHost.run('" + escapeForExtendScript(request) + "')";
    raw = await evalScript(withHostEngine(script));

    return parseHostJson(raw, "Host returned a non-JSON response");
  }

  root.cep = {
    isCepAvailable: isCepAvailable,
    runHostCommand: runHostCommand
  };
})();
