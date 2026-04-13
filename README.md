# Palethea

Palethea is a desktop app for downloading supported video and audio links into one local library.

It is built to feel simple and calm to use:

- paste a link
- choose MP4 or MP3
- download the file
- find it later in Library
- use Utilities if you want a new version of the file

## What the app can do

- Download video as `MP4`
- Download audio as `MP3`
- Keep finished files in a local Library
- Let you reopen and manage past downloads
- Create extra versions with Utilities

## Getting the app

When this project is pushed to GitHub, GitHub Actions will build installers automatically.

If you want a release tag for GitHub Releases, run `python release.py` from the repo root and choose the new version option. It updates the release version files, runs `cargo check`, commits, pushes, and then creates and pushes a `v...` tag that triggers the installer build workflow automatically.

Download the one that matches your system:

- Windows: `.exe`
- Linux: `.AppImage`
- macOS: `.dmg`

If macOS shows a warning the first time you open the app, confirm that you trust it in System Settings and then open it again.

## How to use Palethea

### 1. Paste a link

Open the app and paste the media link you want to save.

### 2. Pick the format

Choose what you want:

- `MP4` for video
- `MP3` for audio

### 3. Download

Press the download button and wait for the file to finish.

### 4. Open Library

Your finished files appear in the Library page.

From there you can:

- play the file
- filter by provider, format, or quality
- open the file in Utilities
- remove history entries
- delete real files from disk

### 5. Use Utilities when needed

Utilities makes new versions of a file without forcing you to start over.

Current tools include:

- Extract Audio
- TikTok 60 FPS Fix
- Compress to Target Size

## Where files are saved

Palethea keeps downloads in its local `library` folder.

You can open that folder directly from the Library page inside the app.

## Helpful notes

- `Clear All` removes only the Library history list.
- `Delete All` removes the actual files from disk.
- Some providers change often, so an older link may stop working later.
- Only download media you have permission to save.

## For developers

The desktop app source is inside `app/`.

For a prompt-driven local release flow, run `python release.py` from the repo root. The script runs `cargo check` automatically before pushing, and the commit prompt accepts Enter to use a default message.

If you only want to create a tag from the current `app/package.json` version without the guided Python flow, run `node scripts/create-version-tag.mjs --push` from the repo root.