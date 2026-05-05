(function () {
  "use strict";

  var root = window.AIPlus || (window.AIPlus = {});

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

    return Promise.resolve({
      ok: true,
      mock: true,
      value: {
        message: "Previewed " + commandName + "."
      }
    });
  }

  async function runHostCommand(commandName, payload) {
    if (!isCepAvailable()) {
      return mockHostCommand(commandName, payload || {});
    }

    var request = JSON.stringify({
      command: commandName,
      payload: payload || {}
    });
    var script = "AIPlusHost.run('" + escapeForExtendScript(request) + "')";
    var raw = await evalScript(script);

    try {
      return JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        error: "Host returned a non-JSON response.",
        raw: raw
      };
    }
  }

  root.cep = {
    isCepAvailable: isCepAvailable,
    runHostCommand: runHostCommand
  };
})();
