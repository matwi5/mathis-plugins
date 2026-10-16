# Expo: native release or OTA update

An installed Expo app only accepts OTA updates built for its own runtime version. A release therefore takes one of two paths:
- **OTA**: only JavaScript, assets or styles changed. Published as an update; installed apps receive it.
- **Native**: native code or native configuration changed. Needs a new store build; its runtime version differs from the installed apps', so they no longer receive OTA updates built for it.

## Detect native changes

Compare the commits since the last native release (last tag, or `origin/<default>` if the project does not tag) and look for any of these. One is enough to require a native release.

| Signal | Why it is native |
|---|---|
| Dependency added, removed or re-versioned in `package.json` that ships native code: `expo-*`, `react-native-*`, `@react-native-*/*`, and packages such as `lottie-react-native` or `@shopify/flash-list` | Native modules are compiled into the binary |
| `react-native` or `expo` (SDK) version changed | Changes the native runtime |
| New Metro or Babel plugin or transformer (`*-transformer`, `babel-plugin-*`, including in `devDependencies`) | Runs at build time and changes the bundle the binary expects |
| `plugins`, `ios`, `android`, permissions, `scheme` or similar native sections changed in `app.json` / `app.config.*` | Native configuration |
| Files changed under `ios/`, `android/`, or `metro.config.js`, `babel.config.js`, `eas.json` build profiles | Native project or build pipeline |

Read the diff of `package.json`, not just the commit messages: a dependency added inside a `feat` commit is the usual miss. When a package's native status is unclear, say so and treat it as native.

When native changes are found, do not offer an OTA-only release; name the changes that triggered it. The owner may still skip the bump.

## How the version is recorded

Read the app config to see which scheme the project uses:

- **`runtimeVersion: { policy: "appVersion" }`**: the runtime version is `expo.version`. Bump `version` only for a native release; for an OTA update, leave `version` alone, or the update will not reach installed apps.
- **`runtimeVersion: { policy: "nativeVersion" }`**: the runtime version combines `version` with the build number (`ios.buildNumber` / `android.versionCode`). Change them only for a native release.
- **`runtimeVersion: { policy: "fingerprint" }`**: the runtime version is computed from the native project; `version` is the store-facing number. Bump it for a native release per SemVer.
- **Explicit `runtimeVersion: "x.y.z"`**: change it only for a native release, together with `version`.
- **Custom OTA counter `extra.jsVersion` (`X.Y.Z.N`)**: OTA → increment `N`; native → bump `version` per SemVer and reset `jsVersion` to `<new version>.1`. Keep `version` in `package.json` and the app config equal.

Build numbers (`ios.buildNumber`, `android.versionCode`): if `eas.json` sets `"appVersionSource": "remote"`, EAS manages them; leave them alone. Otherwise increment them for a native release.
