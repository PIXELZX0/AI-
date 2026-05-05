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

    if (host === "illustrator" || name.indexOf("illustrator") !== -1) {
      return "illustrator";
    }

    return "preview";
  }

  function firstAttachmentPath(context) {
    var attachments = context && Array.isArray(context.attachments) ? context.attachments : [];
    var match = attachments.filter(function (attachment) {
      return attachment && attachment.path;
    })[0];
    return match ? match.path : "";
  }

  function addContextReads(actions, text, context) {
    var host = context && context.host;

    if (includesAny(text, ["summarize", "summary", "analyze", "analyse", "project", "요약", "분석"])) {
      actions.push({
        tool: "summarizeProject",
        args: {},
        reason: "Collect project context before changing the edit."
      });
    }

    if (host === "illustrator" && includesAny(text, ["inspect", "analyze", "analyse", "layer", "selected", "object", "selection", "검사", "분석", "레이어", "객체", "오브젝트", "선택"])) {
      actions.push({
        tool: "inspectIllustratorDocument",
        args: {},
        reason: "Read the active Illustrator document and selected objects."
      });
    } else if (includesAny(text, ["inspect", "layer", "expression", "selected", "comp", "컴프", "레이어", "표현식"])) {
      actions.push({
        tool: "inspectComposition",
        args: {},
        reason: "Read the active composition and selected layers."
      });
    }

    if (context && context.skills && context.skills.length) {
      actions.push({
        tool: host === "illustrator" ? "inspectIllustratorDocument" : "inspectComposition",
        args: {
          focus: "skills"
        },
        reason: host === "illustrator" ? "Load Illustrator context for the active skill instructions." : "Load composition context for the active skill instructions."
      });
    }
  }

  function fallbackPlan(prompt, context) {
    var text = String(prompt || "").toLowerCase();
    var host = context.host;
    var actions = [];
    var attachmentPath = firstAttachmentPath(context);
    var settings = context.settings || {};
    var preferredFonts = settings.preferredFonts || "";

    addContextReads(actions, text, context);

    if (host === "illustrator") {
      var wantsIllustratorText = includesAny(text, ["title", "text", "caption", "subtitle", "타이틀", "텍스트", "자막"]);

      if (includesAny(text, ["document", "artboard", "canvas", "poster", "logo", "flyer", "card", "illustration", "새 문서", "문서", "아트보드", "포스터", "로고", "카드", "일러스트"])) {
        actions.push({
          tool: "createIllustratorDocument",
          args: {
            name: includesAny(text, ["logo", "로고"]) ? "AI+ Logo Artboard" : "AI+ Illustrator Document",
            width: includesAny(text, ["poster", "포스터"]) ? 1080 : 1200,
            height: includesAny(text, ["poster", "포스터"]) ? 1350 : 1200,
            colorSpace: includesAny(text, ["print", "cmyk", "인쇄"]) ? "cmyk" : "rgb"
          },
          reason: "Create a clean Illustrator document for the requested artwork."
        });
      }

      if (includesAny(text, ["square", "grid", "shape", "box", "vector", "rectangle", "사각", "그리드", "도형", "벡터"])) {
        actions.push({
          tool: "createIllustratorShapeGrid",
          args: {
            namePrefix: "Vector",
            count: includesAny(text, ["five", "5"]) ? 5 : 6,
            columns: includesAny(text, ["five", "5"]) ? 5 : 3,
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
            text: includesAny(text, ["subtitle", "caption", "자막"]) ? "AI generated caption" : "AI+",
            fontSize: 76,
            fillColor: [28, 31, 36],
            justify: "center",
            preferredFonts: preferredFonts
          },
          reason: "Add editable Illustrator text."
        });
      }

      if (!wantsIllustratorText && includesAny(text, ["style", "font", "selected text", "스타일", "폰트", "선택한 텍스트"])) {
        actions.push({
          tool: "applyIllustratorTextStyle",
          args: {
            fontSize: 76,
            fillColor: [28, 31, 36],
            justify: "center",
            preferredFonts: preferredFonts
          },
          reason: "Style selected Illustrator text."
        });
      }

      if (includesAny(text, ["rename", "clean names", "rename objects", "이름 변경", "이름 바꾸", "오브젝트 이름 변경"])) {
        actions.push({
          tool: "normalizeIllustratorObjectNames",
          args: {
            prefix: "AI+ Object"
          },
          reason: "Make selected Illustrator object names predictable."
        });
      }

      if (includesAny(text, ["organize", "folder", "layer", "project", "정리", "폴더", "레이어"])) {
        actions.push({
          tool: "organizeProject",
          args: {},
          reason: "Create a standard Illustrator layer structure."
        });
      }

      if (includesAny(text, ["image", "generate", "texture", "reference", "이미지", "생성", "텍스처", "레퍼런스"])) {
        actions.push({
          tool: "generateImageAsset",
          args: {
            prompt: prompt,
            ratio: includesAny(text, ["9:16"]) ? "9:16" : includesAny(text, ["16:9"]) ? "16:9" : "1:1",
            count: includesAny(text, ["three", "3"]) ? 3 : 1,
            imageModel: settings.imageModel || "google/nano-banana"
          },
          reason: "Prepare a visual reference placeholder on the artboard."
        });
      }

      if (attachmentPath && includesAny(text, ["attach", "import", "file", "reference", "asset", "place", "첨부", "가져", "배치"])) {
        actions.push({
          tool: "importAttachmentAsset",
          args: {
            path: attachmentPath
          },
          reason: "Place the attached local file into the Illustrator document."
        });
      }

      if (includesAny(text, ["render", "export", "png", "output", "내보내기", "익스포트", "출력"])) {
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
          reason: "Start by reading the current Illustrator document."
        });
        actions.push({
          tool: "inspectIllustratorDocument",
          args: {},
          reason: "Inspect the active artboard and selection before choosing edits."
        });
      }

      return {
        title: "Illustrator plan",
        actions: filterUnsupported(actions, host)
      };
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

    if (includesAny(text, ["square", "grid", "shape", "box", "사각", "그리드", "도형"])) {
      actions.push({
        tool: "createShapeGrid",
        args: {
          namePrefix: "Square",
          count: includesAny(text, ["five", "5"]) ? 5 : 6,
          columns: includesAny(text, ["five", "5"]) ? 5 : 3,
          size: 140,
          gap: 26
        },
        reason: "Create editable shape layers in the active comp."
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
          fillColor: [0.95, 0.96, 0.98],
          justify: "center",
          preferredFonts: preferredFonts
        },
        reason: "Use a readable default style and preferred fonts when available."
      });
    }

    if (includesAny(text, ["reveal", "stagger", "cascade", "offset", "캐스케이드", "스태거"])) {
      actions.push({
        tool: "cascadeReveal",
        args: {
          duration: 0.45,
          stagger: 0.12,
          yOffset: 32
        },
        reason: "Animate selected layers with a staggered reveal."
      });
    } else if (includesAny(text, ["fade", "animation", "animate", "키프레임", "애니메이션", "페이드"])) {
      actions.push({
        tool: "addFadeInOut",
        args: {
          fadeIn: 0.5,
          fadeOut: 0.75
        },
        reason: "Animate selected layers with simple timing."
      });
    }

    if (includesAny(text, ["easy ease", "ease", "easing", "polish", "부드럽", "이징"])) {
      actions.push({
        tool: "applyEasyEase",
        args: {},
        reason: "Smooth selected keyframes."
      });
    }

    if (includesAny(text, ["controller", "null", "rig", "slider", "intensity", "컨트롤", "널", "리그", "슬라이더"])) {
      actions.push({
        tool: includesAny(text, ["slider", "intensity", "슬라이더"]) ? "createSliderRig" : "addNullController",
        args: {
          name: includesAny(text, ["master"]) ? "Master Controller" : "AI+ Control",
          sliderName: "Intensity",
          targetProperty: "opacity"
        },
        reason: "Add a reusable controller for selected layers."
      });
    }

    if (includesAny(text, ["wiggle", "expression", "loop", "bounce", "표현식", "흔들"])) {
      actions.push({
        tool: "applyExpression",
        args: {
          property: "position",
          expression: includesAny(text, ["loop"]) ? "loopOut(\"cycle\")" : "wiggle(2, 24)"
        },
        reason: "Apply a safe expression to the selected property."
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

    if (includesAny(text, ["reset", "scale 100", "rotation 0", "초기화"])) {
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

    if (includesAny(text, ["image", "generate", "texture", "sprite", "mood", "reference", "이미지", "생성", "텍스처"])) {
      actions.push({
        tool: "generateImageAsset",
        args: {
          prompt: prompt,
          ratio: includesAny(text, ["9:16"]) ? "9:16" : "16:9",
          count: includesAny(text, ["three", "3"]) ? 3 : 1,
          imageModel: settings.imageModel || "google/nano-banana"
        },
        reason: "Prepare a generated visual asset for the project."
      });
    }

    if (attachmentPath && includesAny(text, ["attach", "import", "file", "reference", "asset", "첨부", "가져"])) {
      actions.push({
        tool: "importAttachmentAsset",
        args: {
          path: attachmentPath
        },
        reason: "Import the attached local file into the project."
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
          tool: "inspectComposition",
          args: {},
          reason: "Inspect the active comp before choosing edits."
        });
      }
    }

    return {
      title: "AI+ plan",
      actions: filterUnsupported(actions, host)
    };
  }

  function dedupeActions(actions) {
    var seen = {};
    return actions.filter(function (action) {
      var key = action.tool + ":" + JSON.stringify(action.args || {});
      if (seen[key]) {
        return false;
      }
      seen[key] = true;
      return true;
    });
  }

  function filterUnsupported(actions, host) {
    return dedupeActions(actions).reduce(function (filtered, action) {
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
      source: plan.source || "endpoint",
      warning: plan.warning || "",
      actions: filterUnsupported(actions, context.host)
    };
  }

  async function createPlan(prompt, hostInfo, options) {
    var settings = root.provider.loadSettings();
    var opts = options || {};
    var context = {
      host: normalizeHost(hostInfo),
      hostInfo: hostInfo || {},
      attachments: opts.attachments || [],
      skills: opts.skills || [],
      settings: settings
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
        source: "fallback",
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
