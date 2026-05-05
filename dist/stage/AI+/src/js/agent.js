(function () {
  "use strict";

  var root = window.AIPlus || (window.AIPlus = {});

  function includesAny(text, words) {
    return words.some(function (word) {
      return text.indexOf(word) !== -1;
    });
  }

  function normalizeHost(hostInfo) {
    var name = String((hostInfo && hostInfo.appName) || "").toLowerCase();
    var host = String((hostInfo && hostInfo.host) || "").toLowerCase();

    if (host === "after-effects" || name.indexOf("after effects") !== -1) {
      return "after-effects";
    }

    if (host === "premiere-pro" || name.indexOf("premiere") !== -1) {
      return "premiere-pro";
    }

    return "preview";
  }

  function fallbackPlan(prompt, context) {
    var text = String(prompt || "").toLowerCase();
    var host = context.host;
    var actions = [];

    if (includesAny(text, ["summarize", "summary", "analyze", "분석", "요약"])) {
      actions.push({
        tool: "summarizeProject",
        args: {},
        reason: "Collect project context before changing the edit."
      });
    }

    if (includesAny(text, ["intro", "composition", "comp", "cinematic", "인트로", "컴프"])) {
      actions.push({
        tool: "createComposition",
        args: {
          name: "AI+ Cinematic Intro",
          width: 1920,
          height: 1080,
          frameRate: 30,
          duration: 8
        },
        reason: "Create a clean working composition."
      });
    }

    if (includesAny(text, ["title", "text", "caption", "subtitle", "타이틀", "텍스트", "자막"])) {
      actions.push({
        tool: "addTextLayer",
        args: {
          text: includesAny(text, ["subtitle", "caption", "자막"]) ? "AI generated caption" : "AI+",
          position: "center",
          duration: 4
        },
        reason: "Add editable text that can be refined in Adobe."
      });
      actions.push({
        tool: "applyTextStyle",
        args: {
          fontSize: 92,
          fillColor: [0.95, 0.98, 1],
          justify: "center"
        },
        reason: "Give the text a readable default style."
      });
    }

    if (includesAny(text, ["fade", "animation", "animate", "키프레임", "애니메이션", "페이드"])) {
      actions.push({
        tool: "addFadeInOut",
        args: {
          fadeIn: 0.5,
          fadeOut: 0.75
        },
        reason: "Animate selected layers with simple timing."
      });
    }

    if (includesAny(text, ["controller", "null", "rig", "컨트롤", "널"])) {
      actions.push({
        tool: "addNullController",
        args: {
          name: "AI+ Control"
        },
        reason: "Add a parent control for selected layers."
      });
    }

    if (includesAny(text, ["rename", "clean names", "layer names", "정리", "이름"])) {
      actions.push({
        tool: "normalizeLayerNames",
        args: {
          prefix: "AI+ Layer"
        },
        reason: "Make selected layer names predictable."
      });
    }

    if (includesAny(text, ["organize", "folder", "bin", "project", "정리", "폴더", "빈"])) {
      actions.push({
        tool: "organizeProject",
        args: {},
        reason: "Create a standard project structure."
      });
    }

    if (includesAny(text, ["marker", "review", "note", "마커", "리뷰"])) {
      actions.push({
        tool: "addMarkers",
        args: {
          markers: [
            { time: 0, label: "Intro" },
            { time: 3, label: "Review beat" },
            { time: 6, label: "Ending" }
          ]
        },
        reason: "Place review beats on the current timeline."
      });
    }

    if (includesAny(text, ["render", "export", "queue", "출력", "렌더", "익스포트", "내보내기"])) {
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
        reason: "Start by reading the current project context."
      });
      if (host === "after-effects" || host === "preview") {
        actions.push({
          tool: "addMarkers",
          args: {
            markers: [
              { time: 0, label: "AI+ start" },
              { time: 2, label: "AI+ review" }
            ]
          },
          reason: "Leave visible timeline checkpoints for the requested work."
        });
      }
    }

    return {
      title: "AI+ plan",
      actions: filterUnsupported(actions, host)
    };
  }

  function filterUnsupported(actions, host) {
    return actions.reduce(function (filtered, action) {
      var tool = root.toolRegistry.find(action.tool);
      if (!tool) {
        return filtered;
      }
      if (root.toolRegistry.supportsHost(tool, host)) {
        filtered.push(action);
      }
      return filtered;
    }, []);
  }

  function sanitizeProviderPlan(plan, context) {
    var actions = Array.isArray(plan && plan.actions) ? plan.actions : [];
    return {
      title: plan.title || "AI+ provider plan",
      actions: filterUnsupported(actions, context.host)
    };
  }

  async function createPlan(prompt, hostInfo) {
    var context = {
      host: normalizeHost(hostInfo),
      hostInfo: hostInfo || {}
    };

    try {
      var providerPlan = await root.provider.planWithEndpoint(prompt, context);
      if (providerPlan) {
        return sanitizeProviderPlan(providerPlan, context);
      }
    } catch (error) {
      return {
        title: "Provider failed; using built-in planner",
        warning: error.message,
        actions: fallbackPlan(prompt, context).actions
      };
    }

    return fallbackPlan(prompt, context);
  }

  async function executePlan(plan) {
    var payload = {
      actions: plan.actions || []
    };
    return root.cep.runHostCommand("executePlan", payload);
  }

  root.agent = {
    normalizeHost: normalizeHost,
    createPlan: createPlan,
    executePlan: executePlan
  };
})();
