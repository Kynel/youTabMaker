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
- the in-score `+` action now opens a large popup anchored on the score, and the popup lists the full 1-second crop catalog instead of a tiny recommendation subset
- edit mode now keeps each stitched segment's timestamp visible at the top-left of the large score overlay
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

### Remaining Work

- improve repeated-section detection beyond local chronological overlap cleanup
- implement OCR on the stitched score pipeline
- add richer export formats and review tooling
- improve review-candidate detection so more real repeated-bar edge cases surface automatically
- improve omission-gap detection so more real-world dropped systems are flagged automatically without user inspection
- improve ROI auto-detection and repeated-section handling
