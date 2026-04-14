# Palethea Desktop Source

This folder contains the Electron desktop app for Palethea.

## Local development

1. Install dependencies with `npm install`
2. Start the desktop app with `npm run dev:app`
3. Build the renderer with `npm run build`

## Packaging

- Windows installer: `npm run desktop:pack:win`
- Linux AppImage: `npm run desktop:pack:linux`
- macOS DMG: `npm run desktop:pack:mac`

The GitHub workflow in the repo root uses these same scripts.

For the simple guided release flow, run `python release.py` from the repo root. It can either push normally or bump the release version, run `cargo check`, commit, push, and create the release tag automatically. If you press Enter on the commit prompt, it uses a default message, and release commits skip the duplicate branch build so the tagged build can publish the real release files.
