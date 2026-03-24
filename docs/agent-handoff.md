# Agent Handoff

## Current State

The repository was empty at the start of this session. It now contains a web-first YouTabMaker scaffold with URL intake, automatic YouTube download, 1-second frame extraction, a simplified ROI workbench, and full-video tab stitching into one score. The assembly pipeline removes near-duplicate captures, normalizes crop sizes, and attempts overlap-aware chronological stitching before exporting PNG and JSON. Dependencies are installed and the app has already passed `npm run typecheck` and `npm run build`.

## What Exists

- A simplified single-column workbench focused on the core task
- `POST /api/intake` for URL validation and local dependency diagnostics
- project persistence routes for loading a saved draft, capturing video frames, assembling a full score, and serving project assets
- a client-side ROI lab that supports automatic frame browsing, manual drag selection, default bottom-band auto-suggest, saved ROI restoration, full-video score assembly, and a fullscreen viewer for the final stitched tab
- the ROI preview now supports a black/white background toggle so low-contrast crops can be checked more easily
- the same black/white background choice now also applies to the final tab panel and fullscreen viewer
- the final tab adds an `원본` / `반전` color-mode toggle so white-paper and dark-paper scores are both supported regardless of the source image polarity
- PNG export now renders the currently selected final-tab color mode instead of always downloading the raw assembled image
- the fullscreen tab viewer is width-fitted to the panel and should no longer introduce horizontal scrolling
- the ROI selection overlay on the source frame now uses a dark border, layered dimming, and a neutral label instead of the older red highlight
- Vercel deployments use an OS temp directory for draft storage so the app does not fail immediately on a read-only filesystem
- a workspace reset action clears the current UI state and removes the last-project pointer from local storage
- the UI is currently intentionally stripped down to monochrome black/white boxes with square 1px borders and tight spacing
- long-running capture and assemble routes now write `project.processing` status updates, and the UI polls them to show a full-screen dimmed progress overlay
- documentation for product scope, architecture, and implementation phases

## Important Product Assumptions

- The app should stay web-first.
- The primary workflow is URL-driven automatic capture, not manual image upload.
- The primary artifact is one combined score covering the whole video, not isolated frame crops.
- Songsterr-like playback is a later-stage enhancement, not a blocker for the first useful release.

## Files To Read First

- `/Users/imhyeongjun/Codes/toy/youTabMaker/docs/product-discovery.md`
- `/Users/imhyeongjun/Codes/toy/youTabMaker/docs/architecture.md`
- `/Users/imhyeongjun/Codes/toy/youTabMaker/src/app/page.tsx`
- `/Users/imhyeongjun/Codes/toy/youTabMaker/src/components/youtube-intake-form.tsx`
- `/Users/imhyeongjun/Codes/toy/youTabMaker/src/components/frame-selection-lab.tsx`
- `/Users/imhyeongjun/Codes/toy/youTabMaker/src/app/api/intake/route.ts`

## Recommended Next Steps

1. Improve repeated-section handling without collapsing intentionally repeated musical phrases.
2. Add ROI auto-detection for typical lower-third tab overlays.
3. Build a tab-specific OCR pass for the stitched score pipeline.
4. Add a review editor before exporting any final tab representation.
5. Add structured note data and playback only after OCR quality is acceptable.

## Verified Commands

- `npm install`
- `brew install yt-dlp ffmpeg`
- `npm run typecheck`
- `npm run build`
- `npm run dev -- --hostname 127.0.0.1 --port 3000`
- local `GET /` and `HEAD /` smoke test against `http://127.0.0.1:3000`
- `POST /api/projects/:id/capture`
- `POST /api/projects/:id/assemble`
- re-assembled project `draft-df510cbf` with `261` source frames into `31` stitched score segments

## Cautions

- Do not assume browser access to embedded YouTube pixels.
- Do not assume OCR alone will be accurate enough without a correction UI.
- Keep the stitched-image fallback healthy even after URL processing is added.
- The current ROI is assumed to stay spatially stable across the video.
- The current overlap cleanup is local and chronological. It should not be treated as full repeated-section detection yet.
- The captured-frame strip and final score preview are intentionally height-limited so the page does not explode on long videos.
- The ROI preview defaults to a dark background, but the user can switch between black and white backgrounds from the preview card.
- The reset action is a UI/session reset. It does not currently delete stored project files on disk.
- Download progress from `yt-dlp` is stage-based and best-effort, while frame extraction and score assembly have more granular progress updates.
