# Progress Log

## 2026-03-24

### Discovery

- Confirmed the workspace started empty.
- Confirmed the user wants a web app.
- Captured the constraint that image-only tab generation is acceptable for the first version if a Songsterr-like experience is too heavy.

### Environment

- `node` is available.
- `npm` is available.
- `python3` is available.
- `ffmpeg` is installed.
- `yt-dlp` is installed.
- `tesseract` is currently missing.

### Product Decisions

- Selected a web-first Next.js architecture.
- Treated manual ROI selection as a core feature instead of a fallback.
- Chose to keep direct YouTube processing optional until local runtime dependencies are present.
- Refocused the core outcome on combining all tab frames across a video into one score.
- Simplified the UI to a single essential workflow instead of a marketing-style landing page.
- Shifted the app from manual frame uploads to URL-driven automatic capture.

### Code Added

- Next.js project scaffold
- URL intake API
- runtime diagnostics
- image-based ROI selection lab
- project persistence routes
- multi-frame tab stitching and export
- automatic YouTube download and 1-second frame extraction
- ROI-driven full-video crop, dedupe, normalization, and score assembly
- overlap-aware chronological stitching metadata
- automatic bottom-band default ROI suggestion and saved ROI restoration
- simplified URL-first UI focused on capture, ROI, and final score
- constrained frame-strip and score-preview layout to avoid page breakage on long results
- fullscreen viewer for the assembled tab image
- ROI preview background toggle for black/white contrast checking
- workspace reset action that clears the current screen state and local project pointer
- monochrome black/white utilitarian UI pass with tighter spacing and square 1px boxes
- project-level processing status tracking for capture and assemble steps
- full-screen dimmed processing overlay with stage label, progress percentage, and counts
- ROI preview background choice now also applies to the final tab panel and fullscreen tab viewer
- final tab now supports both original and inverted black/white score polarity, and PNG export follows the selected mode
- fullscreen tab viewer now fits the score to the available width and prevents horizontal scrolling
- ROI selection overlay now uses a darker neutral border, subtler dimming, and a less aggressive label style
- Vercel deployments now use a writable temp storage root instead of a project-local `.data` path
- removed per-crop `trim()` and capped overlap trimming so stitched scores no longer clip the top of mid-score lines
- assembly now stores normalized crop assets plus an assembly manifest so suspicious overlap transitions can be reviewed without recapturing the whole video
- ambiguous overlap candidates now stay in the score by default, while a dedicated review route can re-stitch the final tab after quick human decisions
- the workbench now includes an overlap review section with side-by-side previous/current crop previews and `둘 다 유지` / `겹침 제거` decisions
- final PNG export is now locked until review decisions are complete and saved
- the assembly pipeline now persists an editor model of the current stitched order so manual add/remove fixes can re-render the final score without re-capturing the video
- a dedicated manual-edit route now supports deleting a stitched segment and inserting an omitted crop back into the score in real time
- the workbench now highlights editable gaps, shows previous/next context around a suspected omission, and lets the user preview nearby tab crops before adding them
- the workbench is now split into `유튜브 변환` and `악보 수정` tabs, so ROI work and score-edit work no longer compete on one crowded screen
- the `악보 수정` tab now opens with a large full-width `전체 Tab` panel so Manual Edit decisions can be made while looking at the real stitched score layout
- the `악보 수정` tab now lets the user click stitched regions directly on the large score to remove them, or click in-score `+` handles between regions to open insertion candidates
- the in-score `+` action now opens a large centered full-screen popup, and the popup limits candidates to 1-second crops captured strictly between the selected previous/next timestamps
- the add-candidate popup now uses larger crop cards so the user can compare omitted tab systems more quickly
- clicking a candidate crop in the add popup now switches the full popup into a focused preview view with `최소` / `이 조각 추가`, and clicking the backdrop returns to the crop selection list
- the add popup no longer shows the old `프레임` button for each candidate or for the start/end context cards
- the start/end context cards in the add popup are now visually emphasized so the insertion boundaries read more clearly
- the start/end context cards are now also clickable for the same enlarged modal preview, but they stay reference-only and never expose `추가`
- the fullscreen tab viewer now supports `스크롤` / `페이지` modes, a slider-based auto-scroll speed control in scroll mode, and a two-page spread option in page mode without clipping the page vertically
- the fullscreen tab viewer toolbar has been compressed into a low-height inline control bar so the score gets more vertical space immediately when the modal opens
- scroll mode now has `- / +` zoom controls for the stitched score, and low auto-scroll speeds use an accumulated scroll position so they keep moving smoothly instead of stalling
- fullscreen mode can now hide the top toolbar entirely and restore it with a small floating action, so the score can use nearly the whole viewport height
- the viewer and main workbench actions now use `lucide-react` icons where the action is visually obvious, and scroll-view zoom now spans a wider `40% ~ 320%` range
- in score-edit mode, deleting a stitched segment now happens from a hover `X` button at the top-right of the segment instead of relying on the lower detail panel
- the separate `Manual Edit` panel under the score was removed, leaving score editing to happen directly on the large stitched score with in-score `X` and `+` controls
- edit mode now keeps each stitched segment's timestamp visible at the top-left of the large score overlay
- draft projects now expose `updatedAt`, a saved-project summary API, and a convert-tab saved-project list so local work can be resumed from disk
- ROI data is now stored as a timeline of saved segments instead of a single global ROI, so a new ROI can start from any chosen frame timestamp and apply only forward until the next saved segment
- full-score assembly now resolves the active ROI segment for each 1-second frame by timestamp before cropping, so one video can stitch multiple ROI regions across different sections
- the convert tab now includes an ROI timeline panel with per-segment save, insert-from-current, delete-later-segment, and jump-to-segment controls
- the old overlap-review UI has now been removed from the workbench, leaving score editing centered on direct add/remove actions in the stitched score
- the captured-frame strip now highlights frames that are currently used in the assembled score
- switching from `악보 수정` back to `유튜브 변환` now re-renders the source canvas and ROI preview correctly instead of leaving those panels black
- the top workspace chrome now uses a more product-like header with compact status cards, a dedicated current-project summary card, and true full-width navigation tabs with captions
- the saved-project library now exposes inline delete controls in addition to rename/load, and deleting the currently loaded draft clears the active workspace pointer cleanly
- the workspace chrome and inner panels now use fewer borders and lighter gray surfaces, so the page reads less like nested wireframes and more like a finished product UI
- the top workspace tabs now render as a connected tab strip with a shared bottom rule instead of three boxed buttons, and desktop overflow scroll was removed by switching the strip to a fixed three-column layout
- the score-edit workspace now uses a structured editor header and grouped control bar, separating summary, view settings, display mode, and export actions so the edit area reads like a production workbench instead of a loose button row
- the fullscreen score viewer toolbar now uses a product-style two-row control surface, separating viewer status, global actions, mode switching, zoom, and playback/page navigation into clearer groups
- the fullscreen viewer now uses a custom-built monochrome speed slider instead of the browser-default range input, and hidden-toolbar scroll mode can toggle auto-scroll with a single tap/click on the score itself
- project documentation and agent handoff docs

### Verification

- Ran `npm install`
- Installed `yt-dlp` and `ffmpeg` with Homebrew
- Ran `npm run typecheck`
- Ran `npm run build`
- Cleared the corrupted `.next` dev cache after a large UI refactor
- Started `npm run dev -- --hostname 127.0.0.1 --port 3000`
- Confirmed `GET /` and `HEAD /` both returned `200 OK`
- Verified `POST /api/projects/:id/capture` extracts full-video frames
- Verified `POST /api/projects/:id/assemble` produces a stitched score and JSON metadata
- Verified `POST /api/projects/:id/review` re-renders the final score from saved normalized crops and manifest data
- Verified `POST /api/projects/:id/manual-edit` removes and re-adds stitched tab segments using the saved manifest/editor state
- Re-verified `POST /api/projects/draft-df510cbf/assemble` after overlap-aware stitching changes
- Confirmed `draft-df510cbf` now assembles `261` source frames into `31` stitched score segments
- Confirmed `GET /api/projects/draft-df510cbf/assets/output/assembled-score.png` returns `200 OK`
- Re-verified `GET /` returns `200 OK` after layout and fullscreen viewer changes
- Re-verified `GET /` returns `200 OK` after the reset action and monochrome UI pass
- Verified in-flight `processing` state during `POST /api/projects/draft-df510cbf/assemble`
- Verified in-flight `processing` state during `POST /api/projects/draft-df510cbf/capture`
- Confirmed the initial Next.js app builds successfully
- Initialized a local Git repository
- Re-verified `GET /` returns `200 OK` after splitting the workbench into convert/edit tabs and enlarging the edit-mode score view
- Verified `GET /api/projects` returns saved local draft summaries for the new saved-project list
- Re-ran `npm run typecheck` after adding ROI timelines and saved-project loading
- Re-ran `npm run build` after clearing a corrupted `.next` cache caused by Next.js dev/build artifacts
- Re-verified `GET /` returns `200 OK` after the saved-project and ROI-timeline work
- Re-ran `npm run typecheck` and `npm run build` after removing the review UI, adding used-frame highlighting, and fixing convert-tab redraws
- Re-ran `npm run build` and `npm run typecheck` after splitting saved-project loading into a dedicated tab, adding project rename support, and cleaning up the convert-tab header/input copy
- Re-verified local `GET /` returns `200 OK` after the saved-project/workspace tab UI cleanup
- Re-ran `npm run build` and `npm run typecheck` after fixing the stuck failure overlay and adding red failed-frame highlighting for ROI crop-detection errors
- Re-ran `npm run build` and `npm run typecheck` after fixing ROI-bound clamping and replacing the overly coarse `16x16` tab-detection heuristic that caused false `No tab-like crops` failures on segmented ROI projects
- Re-ran `npm run build`, `npm run typecheck`, and local `GET /` after simplifying the top workspace header, reducing the edit/convert subheaders, and making the main navigation read more like a compact tab bar
- Re-ran a clean `npm run build` after clearing `.next` to verify the workspace-header/library delete changes against a fresh Next build
- Re-ran `npm run typecheck` after the production-style workspace header/tab redesign and saved-project delete flow
- Verified local `DELETE /api/projects/:id` by creating a temporary intake draft and deleting it immediately
- Captured local browser screenshots with Playwright CLI to visually check the redesigned workspace header/tab presentation
- Captured an additional Playwright screenshot after reducing border density and panel chrome to verify the lighter visual treatment

### Remaining Work

- improve repeated-section detection beyond local chronological overlap cleanup
- implement OCR on the stitched score pipeline
- add richer export formats and review tooling
- improve review-candidate detection so more real repeated-bar edge cases surface automatically
- improve omission-gap detection so more real-world dropped systems are flagged automatically without user inspection
- improve ROI auto-detection and repeated-section handling
- consider a richer visual timeline for ROI segments if users start managing many ROI changes in long videos
