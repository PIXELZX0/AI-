# Building The AI+ ZXP

AI+ can be packaged as a CEP extension archive.

## Development ZXP

```sh
npm run package:zxp
```

This creates:

```text
dist/AIPlus-0.3.0-dev.zxp
```

This file is a development archive with the correct CEP extension contents. Some Adobe extension installers require a signed ZXP and may reject it.

## Signed ZXP

Install Adobe's `ZXPSignCmd`, then run:

```sh
npm run package:zxp:signed
```

The script can create a self-signed development certificate automatically when `ZXPSignCmd` is available. To use your own certificate:

```sh
ZXP_CERT_PATH=/path/to/cert.p12 ZXP_CERT_PASSWORD=... npm run package:zxp:signed
```

If `ZXPSignCmd` is not on `PATH`, provide it explicitly:

```sh
ZXP_SIGN_CMD=/path/to/ZXPSignCmd npm run package:zxp:signed
```

Signed output:

```text
dist/AIPlus-0.3.0.zxp
```

## Installer Version Mapping

Adobe extension installers compare the CEP manifest version, not just the ZXP filename. The package script rewrites the staged `CSXS/manifest.xml` versions from `package.json` into an installer-safe numeric dot format.

For example, `2026.5.5-1` is packaged into the manifest as `2026.5.5.1`. This prevents installers from treating the hyphenated package version as a downgrade from `2026.5.5`.

## GitHub Release Automation

`.github/workflows/release-zxp.yml` packages a signed ZXP automatically when a GitHub release is published or when a version tag such as `v0.1.0` is pushed.

The workflow runs on `macos-latest`, checks that the release tag matches `package.json`, runs the JavaScript syntax check, installs a `ZXPSignCmd` provider, creates `dist/AIPlus-<version>.zxp`, verifies the signature, and stores that signed ZXP as the workflow artifact. Stable tag releases upload the signed ZXP to the GitHub release.
