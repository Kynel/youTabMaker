# YouTabMaker

YouTabMaker is a web-first tool for turning a YouTube guitar practice video into one long reusable tab score.

The current MVP is focused on a very specific workflow:

1. Paste a YouTube URL.
2. Capture the full video at 1-second intervals.
3. Pick the tab ROI once on a representative frame.
4. Assemble all visible tab frames from the full video into one stitched score image.

This project exists because watching a practice video is useful when learning alone, but not enough when rehearsal tempo drifts and the player needs a standalone tab artifact.

## What It Does Today

- validates and normalizes YouTube URLs
- downloads the source video with `yt-dlp`
- extracts 1-second interval frames with `ffmpeg`
- shows captured frames in time order inside a web workbench
- lets the user select a single ROI for the tab area
- crops the full video with that ROI
- removes local near-duplicates and chronological overlap
- normalizes crop sizes and stitches one full score image
- supports fullscreen viewing of the final tab
- supports `원본` / `반전` display modes for white-paper and dark-paper tab sources
- exports the currently selected final tab view as PNG

## Product Notes

- The app is intentionally image-first right now.
- Manual ROI selection is a core feature, not a fallback.
- Musical repeats should remain in the final score.
- Only capture overlap and near-duplicate neighboring frames are removed.
- OCR and playback are later milestones, not part of the current reliable path.

## Tech Stack

- Next.js App Router
- React 19
- TypeScript
- Sharp
- Native Node route handlers
- Local CLI tools: `yt-dlp`, `ffmpeg`

## Local Development

### Requirements

- Node.js 20+
- npm 11+
- `yt-dlp`
- `ffmpeg`

Optional for future OCR work:

- `tesseract`

### Install

```bash
npm install
```

Install local media tools on macOS with Homebrew:

```bash
brew install yt-dlp ffmpeg
```

### Run

```bash
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

### Verify

```bash
npm run typecheck
npm run build
```

## Deployment Note

The current capture pipeline depends on native binaries and project-local filesystem writes.

That means:

- the UI can build as a normal Next.js deployment
- the full YouTube capture pipeline expects `yt-dlp` and `ffmpeg` to exist at runtime
- Vercel uses an ephemeral writable temp directory for draft storage in this codebase
- deployment targets like Vercel need extra runtime strategy work if the goal is fully functional remote capture

In other words, the current architecture is production-shaped for the browser workflow, but the media-processing backend still assumes a machine with those binaries available.

## Project Structure

- `src/app`: pages and route handlers
- `src/components`: UI workbench components
- `src/lib`: project model, runtime checks, storage, and media pipeline logic
- `docs`: discovery, architecture, implementation plan, and handoff notes

## Key Documents

- [Product discovery](docs/product-discovery.md)
- [Architecture](docs/architecture.md)
- [Implementation plan](docs/implementation-plan.md)
- [Progress log](docs/progress-log.md)
- [Agent handoff](docs/agent-handoff.md)

## Current Status

- local development server works
- full-video capture works on a machine with `yt-dlp` and `ffmpeg`
- ROI selection, full-score assembly, fullscreen viewing, and PNG export are implemented
- OCR, structured tab data, and playback remain future work
