# Releasing FileTube

FileTube publishes a Docker image to `deantammam/filetube` on every push, but the
**tags** differ by what you push — so `latest` means "newest release," not
"newest commit."

## Image tags

| You push… | Image tags produced | Use it for |
|-----------|---------------------|------------|
| A commit to `main` | `edge`, `sha-<short>` | Bleeding-edge testing |
| A version tag `vX.Y.Z` | `X.Y.Z`, `X.Y`, `X`, `latest` | Real releases |

So consumers can:
- **Track releases:** `deantammam/filetube:latest` (updates only when you cut a release)
- **Pin exactly:** `deantammam/filetube:1.4.2`
- **Pin to a minor/major line:** `1.4` or `1` (get patches/minors automatically)
- **Live on the edge:** `deantammam/filetube:edge` (newest `main`)

[Watchtower](https://containrrr.dev/watchtower/) following `latest` auto-updates
on each release; following a pinned `1.4.2` never moves.

## Cutting a release

1. Make sure `main` is green (CI passes) and you're on it:
   ```bash
   git checkout main && git pull
   ```
2. Bump the version in `package.json` to match the release, commit it:
   ```bash
   npm version 1.4.0 --no-git-tag-version
   git commit -am "Release v1.4.0"
   git push
   ```
3. Tag and push the tag (this triggers the versioned image build):
   ```bash
   git tag v1.4.0
   git push origin v1.4.0
   ```
   — or, equivalently, **draft a GitHub Release** in the UI with tag `v1.4.0`
   (publishing it creates and pushes the tag, which triggers the same build).
4. Watch the **Publish Docker Image** workflow. When it's green,
   `deantammam/filetube:1.4.0` and `:latest` are live.

Use [semver](https://semver.org/): bump **patch** for fixes, **minor** for
backward-compatible features, **major** for breaking changes.

## Notes

- The version tag drives the image version; `package.json` is kept in sync by
  step 2 for humans and tooling (it isn't read by the build).
- Only tags matching `v*.*.*` trigger a release build.
