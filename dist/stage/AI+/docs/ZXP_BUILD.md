# Building The AI+ ZXP

AI+ can be packaged as a CEP extension archive.

## Development ZXP

```sh
npm run package:zxp
```

This creates:

```text
dist/AIPlus-0.1.0-dev.zxp
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
dist/AIPlus-0.1.0.zxp
```
