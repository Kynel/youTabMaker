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
- Re-verified `POST /api/projects/draft-df510cbf/assemble` after overlap-aware stitching changes
- Confirmed `draft-df510cbf` now assembles `261` source frames into `31` stitched score segments
- Confirmed `GET /api/projects/draft-df510cbf/assets/output/assembled-score.png` returns `200 OK`
- Re-verified `GET /` returns `200 OK` after layout and fullscreen viewer changes
- Re-verified `GET /` returns `200 OK` after the reset action and monochrome UI pass
- Verified in-flight `processing` state during `POST /api/projects/draft-df510cbf/assemble`
- Verified in-flight `processing` state during `POST /api/projects/draft-df510cbf/capture`
- Confirmed the initial Next.js app builds successfully
- Initialized a local Git repository

### Remaining Work

- improve repeated-section detection beyond local chronological overlap cleanup
- implement OCR on the stitched score pipeline
- add richer export formats and review tooling
- improve ROI auto-detection and repeated-section handling
