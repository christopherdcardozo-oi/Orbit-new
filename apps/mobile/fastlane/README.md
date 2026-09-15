fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

### prebuild

```sh
[bundle exec] fastlane prebuild
```



----


## iOS

### ios beta

```sh
[bundle exec] fastlane ios beta
```

Build and upload a new build to TestFlight

### ios release

```sh
[bundle exec] fastlane ios release
```

Build and upload a production-candidate build to App Store Connect. Does NOT submit for review — that click stays manual.

----


## Android

### android build

```sh
[bundle exec] fastlane android build
```

Build a release .aab locally without uploading — for the mandatory manual first Play Console release (Google rejects a new app's first release via API), or any time you just want the artifact. versionCode defaults to 1 since latest_android_version_code queries existing Play tracks, which don't exist yet for a brand-new app; pass version_code: N to override.

### android beta

```sh
[bundle exec] fastlane android beta
```

Build and upload a new build to the Play Console Internal Testing track

### android release

```sh
[bundle exec] fastlane android release
```

Build and upload a production-candidate build to the Play Console, staged as a draft. Does NOT start the rollout — that click stays manual.

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
