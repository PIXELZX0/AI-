"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const extensionName = "AI+";
const extensionsDir = path.join(os.homedir(), "Library", "Application Support", "Adobe", "CEP", "extensions");
const extensionPath = path.join(extensionsDir, extensionName);
const defaultCsxsVersions = ["11", "12", "13", "14", "15"];

function parseArgs(argv) {
  const options = {
    check: false,
    enableUnsigned: false,
    force: false,
    csxsVersions: defaultCsxsVersions
  };

  argv.forEach((arg) => {
    if (arg === "--check") {
      options.check = true;
      return;
    }
    if (arg === "--enable-unsigned") {
      options.enableUnsigned = true;
      return;
    }
    if (arg === "--force") {
      options.force = true;
      return;
    }
    if (arg.startsWith("--csxs=")) {
      options.csxsVersions = arg
        .slice("--csxs=".length)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      return;
    }
    throw new Error("Unknown option: " + arg);
  });

  return options;
}

function runDefaults(args) {
  return spawnSync("defaults", args, {
    encoding: "utf8"
  });
}

function readDebugMode(version) {
  const result = runDefaults(["read", "com.adobe.CSXS." + version, "PlayerDebugMode"]);
  if (result.status !== 0) {
    return "not set";
  }
  return String(result.stdout || "").trim() || "not set";
}

function writeDebugMode(version) {
  const result = runDefaults(["write", "com.adobe.CSXS." + version, "PlayerDebugMode", "1"]);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error("Unable to enable PlayerDebugMode for CSXS " + version + ".");
  }
}

function getLinkStatus() {
  let stat;
  try {
    stat = fs.lstatSync(extensionPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    return {
      exists: false,
      ok: false,
      summary: "missing"
    };
  }

  const realRoot = fs.realpathSync(rootDir);
  let realTarget = "";

  try {
    realTarget = fs.realpathSync(extensionPath);
  } catch (error) {
    return {
      exists: true,
      isSymbolicLink: stat.isSymbolicLink(),
      ok: false,
      summary: stat.isSymbolicLink() ? "broken symlink" : "unreadable path"
    };
  }

  return {
    exists: true,
    isSymbolicLink: stat.isSymbolicLink(),
    ok: realTarget === realRoot,
    summary: realTarget === realRoot ? "linked to this project" : "points to " + realTarget
  };
}

function ensureLink(force) {
  fs.mkdirSync(extensionsDir, {
    recursive: true
  });

  const status = getLinkStatus();
  if (status.ok) {
    return;
  }

  if (status.exists) {
    if (!force || !status.isSymbolicLink) {
      throw new Error(
        "CEP extension path already exists and " +
          status.summary +
          ". Re-run with --force only if it is safe to replace that symlink."
      );
    }
    fs.unlinkSync(extensionPath);
  }

  fs.symlinkSync(rootDir, extensionPath, "dir");
}

function printStatus(options) {
  const linkStatus = getLinkStatus();
  console.log("AI+ project: " + rootDir);
  console.log("CEP extension path: " + extensionPath);
  console.log("Install link: " + linkStatus.summary);

  options.csxsVersions.forEach((version) => {
    console.log("CSXS " + version + " PlayerDebugMode: " + readDebugMode(version));
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.check) {
    printStatus(options);
    return;
  }

  ensureLink(options.force);

  if (options.enableUnsigned) {
    options.csxsVersions.forEach(writeDebugMode);
  }

  printStatus(options);

  if (!options.enableUnsigned) {
    console.log("");
    console.log("Unsigned CEP loading was not changed.");
    console.log("For local unsigned development, run:");
    console.log("  npm run install:cep -- --enable-unsigned");
    console.log("Restart After Effects, Premiere Pro, or Illustrator after changing CEP install or debug settings.");
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
