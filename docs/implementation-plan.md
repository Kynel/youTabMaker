# Implementation Plan

## Phase 1: Browser Workflow Foundation

- Accept and normalize YouTube URLs
- Automatically capture YouTube frames at 1-second intervals
- Support ROI selection on one captured frame
- Support stitching the full-video tab crops into one score
- Keep every decision documented for the next agent

## Phase 2: Frame Acquisition

- Add a server route that shells out to `yt-dlp`
- Use `ffmpeg` to extract 1-second interval frames
- Persist frame metadata by project id
- Detect repeated or near-identical tab regions across adjacent frames

## Phase 3: ROI Intelligence

- Add a heuristic lower-band detector for tab overlays
- Let the user confirm or adjust the suggested crop
- Save one ROI that can be applied to the full video
- Merge accepted crops into one chronological score and trim overlap when frames advance

## Phase 4: OCR And Structured Output

- Preprocess the crop for better line and digit recognition
- Detect tab strings, fret digits, and measure separators
- Export a simple JSON event model and stitched image bundle

## Phase 5: Review And Playback

- Add note correction UI
- Add basic timed playback aligned to extracted note events
- Explore a Songsterr-like linear timeline only after OCR quality is acceptable
