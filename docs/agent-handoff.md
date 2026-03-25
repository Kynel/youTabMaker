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
- the ROI workbench keeps manual score correction in the main stitched-score view, with in-score gap markers, candidate previews, and direct add/remove actions
- the top-level workbench is now split into `유튜브 변환` and `악보 수정` tabs
- the `악보 수정` tab leads with a large full-width `전체 Tab` panel so the stitched score can be reviewed in a layout closer to the final sheet before manual editing
- the large `전체 Tab` panel now has clickable overlays for each stitched segment plus in-score `+` insertion handles, so add/remove edits can start directly from the main score view instead of only from a separate strip
- the `+` insertion flow now opens as a centered full-screen popup and shows only the 1-second crops captured between the selected previous/next timestamps, which makes manual insertion faster and less noisy
- the insertion popup now renders larger candidate cards so omitted systems are easier to compare at a glance
- clicking a candidate card in the insertion popup now switches the full popup into a large preview state on demand, so users only see the expanded crop after they select it
- the previous/next boundary cards in the insertion popup are also clickable now, using the same enlarged modal preview without exposing an add action
- the fullscreen tab viewer now has a scroll mode with slider-based auto-scroll control, plus a page mode with one-page and two-page viewing that keeps full pages visible vertically
- the fullscreen viewer toolbar was refactored from stacked setting cards into a compact inline bar, reducing top chrome so more of the score is visible
- scroll mode now exposes `- / +` zoom controls for the full score, and low auto-scroll values no longer stall because the viewer advances from an accumulated scroll target instead of relying on per-frame integer scrollTop changes
- fullscreen mode can now hide the toolbar completely and bring it back with a small floating action button, which is useful when the user wants maximum score height
- `lucide-react` was added and is now used for the obvious viewer/workbench actions, and the scroll-view zoom range was widened to `40% ~ 320%`
- score-edit deletion now happens directly on the large score overlay via a hover `X` button in the top-right of each segment, while clicking the segment body still selects it for inspection
- the old `Manual Edit` panel below the score has been removed; edit mode is now intentionally centered on direct in-score actions only
- each stitched region in edit mode now keeps its timestamp visible in the top-left corner of the score overlay
- draft projects now carry `updatedAt`, and `GET /api/projects` returns local saved-project summaries that the convert tab uses to resume work from disk
- loading a saved draft now restores it from the saved-project list and only re-runs frame capture when the stored project does not already have captured frames
- ROI persistence is now timeline-based: `project.roiTimeline.segments[]` stores forward-applying ROI segments with start timestamps/frame ids, while the legacy `project.roi` is still mirrored from the first segment for compatibility
- `POST /api/projects/[projectId]/roi` now supports replacing the currently active ROI segment or inserting a new ROI segment starting from the selected frame, and `DELETE` removes later segments
- full-score assembly now resolves the active ROI segment per frame timestamp before cropping, so different sections of one video can use different ROI rectangles
- the convert tab now shows an ROI timeline panel with current-range context, save/insert/delete actions, and quick jumps to saved ROI cut points
- the old overlap-review panel is no longer exposed in the UI; score correction is now centered on direct in-score add/remove editing
- the captured-frame strip now highlights frames that are part of the current stitched score, making it easier to see which 1-second captures are already in use
- switching from `악보 수정` back to `유튜브 변환` now forces the source canvas and ROI preview to redraw, fixing the earlier black-panel issue on return
- the top workspace shell now reads more like a production product header: brand lockup, compact status cards, a current-project summary card, and full-width captioned tabs instead of generic toolbar buttons
- the saved-project library now supports delete alongside rename/load, and deleting the currently loaded draft clears the active workspace state and local last-project pointer
- the UI chrome was lightened further after the production-header pass: helper panels now rely more on spacing and muted surfaces, while hard 1px borders are reserved for outer shells and primary interactive areas
- the workspace tabs were refined again so they read as one connected tab strip with a single bottom baseline; desktop tab overflow scrolling was removed by using a fixed three-column layout and mobile still collapses to one-per-row
- the edit workspace header was refactored into a more production-style control surface: a labeled score-editor header, compact summary chip, grouped settings for background/display, and a dedicated export action cluster above the score canvas
- the fullscreen viewer toolbar was also upgraded into a more production-like control surface with a top status/action row and a separate controls row for mode, zoom, and playback/page navigation
- the fullscreen viewer speed control is now a custom slider component rather than the browser-default range input, and when the viewer toolbar is hidden in scroll mode the user can tap/click the score once to start or stop auto-scroll
- documentation for product scope, architecture, and implementation phases

## Important Product Assumptions

- The app should stay web-first.
- The primary workflow is URL-driven automatic capture, not manual image upload.
- The primary artifact is one combined score covering the whole video, not isolated frame crops.
- ROI is no longer assumed to stay globally stable across the whole video; it is now expected to change only at explicit user-saved cut points.
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
- local `GET /api/projects`
- local `DELETE /api/projects/:id` against a temporary draft created through `POST /api/intake`
- `POST /api/projects/:id/capture`
- `POST /api/projects/:id/assemble`
- `POST /api/projects/:id/manual-edit`
- re-assembled project `draft-df510cbf` with `261` source frames into `31` stitched score segments

## Cautions

- Do not assume browser access to embedded YouTube pixels.
- Do not assume OCR alone will be accurate enough without a correction UI.
- Keep the stitched-image fallback healthy even after URL processing is added.
- The saved-project list now lives in its own `저장된 작업` tab and supports rename/load, but it is still local-disk only and does not yet expose delete/archive controls.
- The ROI timeline UI is list-based for now; there is not yet a dedicated visual ruler or drag-to-retime editor.
- The current overlap cleanup is local and chronological. It should not be treated as full repeated-section detection yet.
- The backend review route still exists for compatibility, but the current UI no longer exposes overlap-review decisions.
- The manual edit UI works even when the omission was not auto-detected, but the current gap hinting is still based on gaps in the stitched crop indices rather than true musical bar semantics.
- The captured-frame strip and final score preview are intentionally height-limited so the page does not explode on long videos.
- If assemble fails with `No tab-like crops were detected in the selected ROI`, the route now stores the failed frame ids in `assemblyFailure`, clears `processing`, and the convert-tab frame strip highlights those frames in red.
- Segmented ROI projects previously triggered false `No tab-like crops` failures because the detection heuristic resized crops too aggressively (`16x16`) before measuring darkness. That heuristic is now based on a larger analysis image and ROI selection is clamped to the frame bounds before saving.
- The top workspace chrome is intentionally leaner now: the header shows only brand, project title, and compact status chips, while the three main workspace modes are styled as a tighter tab bar. The convert/edit section headers were also reduced to title + compact controls to keep the page from feeling stacked and noisy.
- The selected source frame still lives in the convert workspace, so future UX polish could add a dedicated source-frame inspector inside the edit tab if users need that context without switching tabs.
- The ROI preview defaults to a dark background, but the user can switch between black and white backgrounds from the preview card.
- The reset action is a UI/session reset. It does not currently delete stored project files on disk.
- Download progress from `yt-dlp` is stage-based and best-effort, while frame extraction and score assembly have more granular progress updates.
- The convert workspace now removes the duplicate top-level YouTube URL heading and relies on the main workspace header plus a single `영상 링크` field label.
- The top navigation is now a true tab strip (`저장된 작업` / `유튜브 변환` / `악보 수정`) rather than a row of generic buttons, so future additions should preserve that visual model.
- The workspace header is no longer just a stripped-down debug shell; it now intentionally uses a product-style information hierarchy. Future tweaks should preserve the current separation between brand, current project, status cards, and tabs rather than collapsing them back into one noisy row.
- If the dev server starts throwing `Cannot find module './331.js'`-style errors after repeated build/dev cycles, clear `.next` or restart `npm run dev` before assuming the page code is broken.
