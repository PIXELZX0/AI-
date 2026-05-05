# AI+

AI+ is an Adobe After Effects, Premiere Pro, and Illustrator AI panel scaffold. It turns a natural-language request into a gated execution plan, then runs only registered host tools through ExtendScript.

This first version is intentionally practical:

- a CEP panel UI in `index.html`
- a built-in offline planner for common editing and motion tasks
- an optional local AI planning endpoint
- a no-dependency local planner server in `server.js`
- a no-dependency MCP server in `mcp-server.js` for Codex
- a safe tool registry in `src/js/toolRegistry.js`
- an Adobe host bridge in `host/jsx/ai-plus.jsx`
- support for After Effects first, with Premiere Pro project/marker/export foundations and Illustrator document/artboard/vector foundations

## Why This Shape

"AI can do everything" should not mean arbitrary code execution inside Adobe apps. AI+ uses a command architecture:

1. The user writes a command.
2. The planner creates JSON actions.
3. The panel removes unsupported or unknown tools.
4. The Adobe host script executes the allowed tools.
5. The run log reports every result.

That gives the AI room to grow while keeping destructive behavior behind explicit, auditable tools.

## Install For Local Adobe Testing

Check whether Adobe can discover the local CEP panel:

```sh
npm run check:cep
```

Install the local development panel by symlinking this folder into the CEP extensions directory:

```sh
npm run install:cep
```

Unsigned CEP extensions are blocked by default. To allow this local development panel, explicitly enable Adobe's `PlayerDebugMode`:

```sh
npm run install:cep -- --enable-unsigned
```

That command writes the equivalent of:

```sh
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
defaults write com.adobe.CSXS.13 PlayerDebugMode 1
defaults write com.adobe.CSXS.14 PlayerDebugMode 1
defaults write com.adobe.CSXS.15 PlayerDebugMode 1
```

Restart After Effects, Premiere Pro, or Illustrator, then open `Window > Extensions > AI+`.

## Codex AI Planner

The panel can call a local HTTP planner that uses Codex CLI when the provider is set to `Codex CLI`. Start the bundled planner:

```sh
npm run planner
```

Then set the panel provider endpoint to:

```text
http://127.0.0.1:8787/plan
```

When this endpoint is set, the panel also polls the local `/jobs` queue. Codex or another MCP client can queue work there and the open Adobe panel will execute it.

Codex CLI uses your existing Codex login. If `codex` is not on the server process `PATH`, point AI+ at it:

```sh
AI_PLUS_CODEX_BIN=/Applications/Codex.app/Contents/Resources/codex npm run planner
```

Without Codex CLI access or model credentials, the server uses deterministic fallback planning. To force the OpenAI API planner instead of Codex CLI, start it with:

```sh
AI_PLUS_PLANNER=openai OPENAI_API_KEY=... AI_PLUS_MODEL=... npm run planner
```

The endpoint accepts:

```json
{
  "prompt": "Create a square poster artboard with a vector grid and title text",
  "context": {
    "host": "illustrator"
  },
  "allowedTools": []
}
```

It should return:

```json
{
  "title": "Plan title",
  "actions": [
    {
      "tool": "createIllustratorDocument",
      "args": {
        "name": "AI+ Poster",
        "width": 1080,
        "height": 1080
      },
      "reason": "Create a working Illustrator document."
    }
  ]
}
```

Unknown tools are ignored by the panel before execution.

## Codex / MCP

Start the local bridge:

```sh
npm run planner
```

Register the MCP server:

```sh
codex mcp add ai-plus -- node /Users/yuchan/Desktop/plugins/AI+/mcp-server.js
```

The MCP server exposes:

- `ai_plus_health`
- `ai_plus_list_capabilities`
- `ai_plus_plan`
- `ai_plus_enqueue_adobe_job`
- `ai_plus_get_adobe_job`

Full setup notes live in `docs/mcp/CODEX_SETUP.md`.

## ZXP Build

Create a development ZXP archive:

```sh
npm run package:zxp
```

Output:

```text
dist/AIPlus-0.2.4-dev.zxp
```

For an installer-ready signed ZXP, install `ZXPSignCmd`, then run:

```sh
npm run package:zxp:signed
```

More detail lives in `docs/ZXP_BUILD.md`.

Stable GitHub releases are created from version tags such as `v0.1.0`. The release workflow validates the tag against `package.json` and attaches the signed ZXP when one is available.

## Current Tools

- `summarizeProject`
- `inspectComposition`
- `createCheckpoint`
- `restoreCheckpoint`
- `createComposition`
- `createShapeGrid`
- `addTextLayer`
- `applyTextStyle`
- `addFadeInOut`
- `cascadeReveal`
- `applyEasyEase`
- `addNullController`
- `createSliderRig`
- `applyExpression`
- `normalizeLayerNames`
- `resetTransforms`
- `organizeProject`
- `addMarkers`
- `queueRender`
- `generateImageAsset`
- `importAttachmentAsset`

## Next Build Targets

- real model server with tool-calling
- Premiere Pro encoder preset selection
- transcript-to-subtitle workflows
- media analysis hooks
- generated expressions and animation presets
- user approval prompts for high-risk operations
