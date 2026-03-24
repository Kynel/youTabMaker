# Architecture

## Chosen Stack

- Next.js App Router
- React and TypeScript
- Native browser canvas for region selection
- Node route handlers for intake and runtime diagnostics
- External CLI tools for later media processing: `yt-dlp`, `ffmpeg`, `tesseract`

## Why This Stack

- The user explicitly wants a web application.
- The UI needs a rich interactive workbench for image and region handling.
- A single TypeScript codebase is the fastest way to get the browser workflow moving.
- The media pipeline can still call native tools on the server side without changing the front-end contract.

## System Shape

### Front-End

- URL intake form
- automatic capture status
- ROI selection on a chosen captured frame
- full-score preview and export
- Future tab review and correction panel

### Server

- URL validation and normalization
- Runtime inspection for required local binaries
- YouTube download and frame extraction
- ROI-based crop, dedupe, overlap cleanup, normalization, and score assembly
- asset serving for extracted frames and final outputs

### Media Pipeline

1. Download source video from a user-supplied URL
2. Extract candidate frames at 1-second intervals
3. Let the user confirm the tab region on one frame
4. Crop every captured frame using that ROI
5. Remove repeated or nearly identical tab crops
6. Normalize the remaining crops to a consistent width
7. Trim overlap between chronological crops when the tab view scrolls or advances
8. Stitch the accepted crops into one continuous score image
9. Produce image, JSON, and later playback-friendly note data

## Why Manual ROI Comes First

- The screenshot pattern in these videos is highly variable.
- The lower tab staff is often stable even when the upper notation changes.
- Giving the user a fast crop tool immediately creates value, even before OCR is production ready.

## Suggested Next Technical Milestones

1. Improve ROI auto-detection for lower-third notation regions.
2. Tune dedupe so slow-moving tab scrolls and creator-specific transitions are handled better.
3. Add OCR for digits and barlines on cropped tab areas.
4. Add a review editor that lets the user fix note positions before export.
5. Add playback-friendly structured note data only after OCR quality is acceptable.

## Directory Guide

- `src/app`: routes and pages
- `src/components`: browser UI and workbench pieces
- `src/lib`: domain logic, URL helpers, runtime inspection
- `docs`: requirements, progress log, and handoff notes
