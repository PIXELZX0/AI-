"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const version = packageJson.version || "0.0.0";
const distDir = path.join(rootDir, "dist");
const stageRoot = path.join(distDir, "stage");
const stageDir = path.join(stageRoot, "AI+");
const sign = process.argv.includes("--sign");
const unsignedZxp = path.join(distDir, "AIPlus-" + version + "-dev.zxp");
const signedZxp = path.join(distDir, "AIPlus-" + version + ".zxp");
const manifestPath = path.join(stageDir, "CSXS", "manifest.xml");

const packageEntries = [
  "CSXS",
  "host",
  "src",
  "docs",
  "index.html",
  "package.json",
  "server.js",
  "mcp-server.js",
  "README.md"
];

function run(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options && options.cwd ? options.cwd : rootDir,
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(command + " exited with status " + result.status + ".");
  }
}

function findCommand(command) {
  const result = spawnSync("which", [command], {
    encoding: "utf8"
  });

  if (result.status === 0) {
    return result.stdout.trim();
  }

  return "";
}

function resetDir(dir) {
  fs.rmSync(dir, {
    recursive: true,
    force: true
  });
  fs.mkdirSync(dir, {
    recursive: true
  });
}

function copyEntry(entry) {
  const source = path.join(rootDir, entry);
  const target = path.join(stageDir, entry);

  if (!fs.existsSync(source)) {
    return;
  }

  fs.cpSync(source, target, {
    recursive: true,
    filter: (sourcePath) => {
      const basename = path.basename(sourcePath);
      return basename !== ".DS_Store";
    }
  });
}

function normalizeNumericSegment(segment) {
  return String(segment).replace(/^0+(?=\d)/, "");
}

function toAdobeExtensionVersion(rawVersion) {
  const value = String(rawVersion || "").trim();

  if (!value) {
    return "0.0.0";
  }

  const buildIndex = value.indexOf("+");
  const withoutBuild = buildIndex === -1 ? value : value.slice(0, buildIndex);
  const buildPart = buildIndex === -1 ? "" : value.slice(buildIndex + 1);
  const prereleaseIndex = withoutBuild.indexOf("-");
  const basePart = prereleaseIndex === -1 ? withoutBuild : withoutBuild.slice(0, prereleaseIndex);
  const prereleasePart = prereleaseIndex === -1 ? "" : withoutBuild.slice(prereleaseIndex + 1);
  const baseSegments = basePart.split(".");

  if (
    baseSegments.length === 0 ||
    baseSegments.length > 4 ||
    baseSegments.some((segment) => !/^\d+$/.test(segment))
  ) {
    throw new Error("Package version must start with one to four numeric dot-separated segments.");
  }

  const adobeSegments = baseSegments.map(normalizeNumericSegment);
  const suffixPart = [prereleasePart, buildPart].filter(Boolean).join(".");

  if (suffixPart && adobeSegments.length < 4) {
    const suffixNumber = suffixPart.match(/\d+/);
    adobeSegments.push(suffixNumber ? normalizeNumericSegment(suffixNumber[0]) : "0");
  }

  return adobeSegments.join(".");
}

function updateManifestVersions(adobeVersion) {
  if (!fs.existsSync(manifestPath)) {
    return;
  }

  const manifest = fs.readFileSync(manifestPath, "utf8");
  const updatedManifest = manifest
    .replace(
      /(<ExtensionManifest\b[^>]*\bExtensionBundleVersion=")[^"]+(")/,
      "$1" + adobeVersion + "$2"
    )
    .replace(/(<Extension\b[^>]*\bVersion=")[^"]+(")/g, "$1" + adobeVersion + "$2");

  fs.writeFileSync(manifestPath, updatedManifest);
}

function zipStage(outputPath) {
  fs.rmSync(outputPath, {
    force: true
  });
  run("zip", ["-qry", outputPath, "."], {
    cwd: stageDir
  });
}

function getZxpSignCommand() {
  return process.env.ZXP_SIGN_CMD || findCommand("ZXPSignCmd") || findCommand("zxp-sign-cmd");
}

function ensureCertificate(zxpSignCommand) {
  const certPath = process.env.ZXP_CERT_PATH || path.join(distDir, "AIPlus-dev.p12");
  const password = process.env.ZXP_CERT_PASSWORD || "ai-plus-dev";

  if (!fs.existsSync(certPath)) {
    run(zxpSignCommand, [
      "-selfSignedCert",
      "US",
      "CA",
      "AIPlus",
      "AIPlus",
      password,
      certPath
    ]);
  }

  return {
    certPath,
    password
  };
}

function signStage() {
  const zxpSignCommand = getZxpSignCommand();

  if (!zxpSignCommand) {
    throw new Error("ZXPSignCmd was not found. Install Adobe's ZXP signing tool or set ZXP_SIGN_CMD.");
  }

  fs.rmSync(signedZxp, {
    force: true
  });

  const certificate = ensureCertificate(zxpSignCommand);
  const timestampUrl = process.env.ZXP_TIMESTAMP_URL || "http://timestamp.digicert.com/";
  const signArgs = [
    "-sign",
    stageDir,
    signedZxp,
    certificate.certPath,
    certificate.password,
    "-tsa",
    timestampUrl
  ];

  const result = spawnSync(zxpSignCommand, signArgs, {
    cwd: rootDir,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    run(zxpSignCommand, [
      "-sign",
      stageDir,
      signedZxp,
      certificate.certPath,
      certificate.password
    ]);
  }
}

function main() {
  resetDir(stageRoot);
  fs.mkdirSync(distDir, {
    recursive: true
  });
  packageEntries.forEach(copyEntry);

  const adobeVersion = toAdobeExtensionVersion(version);
  updateManifestVersions(adobeVersion);

  if (adobeVersion !== version) {
    console.log("CEP manifest installer version: " + adobeVersion + " (from package version " + version + ")");
  }

  if (sign) {
    signStage();
    console.log("Signed ZXP created: " + signedZxp);
  } else {
    zipStage(unsignedZxp);
    console.log("Development ZXP archive created: " + unsignedZxp);
    console.log("For an installer-ready signed ZXP, install ZXPSignCmd and run `npm run package:zxp:signed`.");
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  toAdobeExtensionVersion
};
