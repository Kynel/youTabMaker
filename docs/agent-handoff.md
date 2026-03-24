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
- the score assembly pipeline no longer trims each ROI crop individually, and overlap trimming is capped to prevent clipped top portions in mid-score systems
- score assembly now persists normalized crop PNGs plus an `output/assembly-manifest.json` file so the final tab can be re-stitched without reprocessing the entire video
- ambiguous overlap candidates are now kept by default and exposed through `project.assemblyReview`, while only high-confidence overlaps are removed automatically
- `POST /api/projects/[projectId]/review` applies saved `둘 다 유지` / `겹침 제거` review decisions and regenerates the final score from the manifest
- `project.assemblyEditor` now exposes the current stitched crop order plus the full normalized-crop catalog, and `project.assemblyManualEdit` stores user-driven insert/remove fixes
- `POST /api/projects/[projectId]/manual-edit` re-renders the final score from a user-supplied crop order and forced-insert list, so omitted tab systems can be added back without re-running capture
- a workspace reset action clears the current UI state and removes the last-project pointer from local storage
- the UI is currently intentionally stripped down to monochrome black/white boxes with square 1px borders and tight spacing
- long-running capture and assemble routes now write `project.processing` status updates, and the UI polls them to show a full-screen dimmed progress overlay
- the ROI workbench now has a fast overlap-review section with side-by-side previous/current crop previews, a one-click recommendation filler, and PNG export locking until review is resolved
- the ROI workbench now also has a manual edit section that shows gap markers between stitched segments, lets the user open a gap, compare previous/next context, preview nearby candidate crops, and add/remove segments immediately
- the top-level workbench is now split into `유튜브 변환` and `악보 수정` tabs
- the `악보 수정` tab leads with a large full-width `전체 Tab` panel so the stitched score can be reviewed in a layout closer to the final sheet before using overlap review or manual editing
- the large `전체 Tab` panel now has clickable overlays for each stitched segment plus in-score `+` insertion handles, so add/remove edits can start directly from the main score view instead of only from a separate strip
- the `+` insertion flow now opens as a centered full-screen popup and shows only the 1-second crops captured between the selected previous/next timestamps, which makes manual insertion faster and less noisy
- the insertion popup now renders larger candidate cards so omitted systems are easier to compare at a glance
- clicking a candidate card in the insertion popup now switches the full popup into a large preview state on demand, so users only see the expanded crop after they select it
- the previous/next boundary cards in the insertion popup are also clickable now, using the same enlarged modal preview without exposing an add action
- each stitched region in edit mode now keeps its timestamp visible in the top-left corner of the score overlay
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

1. Improve omission-gap and review-candidate detection so more real repeated-bar or dropped-system edge cases are surfaced automatically.
2. Add ROI auto-detection for typical lower-third tab overlays.
3. Build a tab-specific OCR pass for the stitched score pipeline.
4. Add keyboard shortcuts or batched actions for faster manual editing on large projects.
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
- `POST /api/projects/:id/manual-edit`
- `POST /api/projects/:id/review`
- re-assembled project `draft-df510cbf` with `261` source frames into `31` stitched score segments

## Cautions

- Do not assume browser access to embedded YouTube pixels.
- Do not assume OCR alone will be accurate enough without a correction UI.
- Keep the stitched-image fallback healthy even after URL processing is added.
- The current ROI is assumed to stay spatially stable across the video.
- The current overlap cleanup is local and chronological. It should not be treated as full repeated-section detection yet.
- The new review UI exists, but the heuristic that decides which transitions become review items is still conservative and should be tuned with more real-world tab videos.
- The manual edit UI works even when the omission was not auto-detected, but the current gap hinting is still based on gaps in the stitched crop indices rather than true musical bar semantics.
- The captured-frame strip and final score preview are intentionally height-limited so the page does not explode on long videos.
- The selected source frame still lives in the convert workspace, so future UX polish could add a dedicated source-frame inspector inside the edit tab if users need that context without switching tabs.
- The ROI preview defaults to a dark background, but the user can switch between black and white backgrounds from the preview card.
- The reset action is a UI/session reset. It does not currently delete stored project files on disk.
- Download progress from `yt-dlp` is stage-based and best-effort, while frame extraction and score assembly have more granular progress updates.
- If the dev server starts throwing `Cannot find module './331.js'`-style errors after repeated build/dev cycles, clear `.next` or restart `npm run dev` before assuming the page code is broken.
