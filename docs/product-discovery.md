# Product Discovery

## Problem

The user practices guitar with YouTube videos that show notation or tab overlays. Those overlays are useful during solo practice, but they are not enough during rehearsal because the live band tempo shifts slightly. The user needs a separate tab artifact that can be reviewed without playing the original video.

## Product Goal

Turn a YouTube practice video into one reusable tab score in the browser.

## Primary User Flow

1. Paste a YouTube URL.
2. Automatically capture the full video at 1-second intervals.
3. Mark the tab area once on one representative frame.
4. Crop all captured frames using that ROI.
5. Remove repeated or overlapping tab captures and normalize sizes.
6. Review and export a practice-ready result.

## MVP Scope

- Web application only
- URL intake and validation
- Automatic 1-second frame capture from a YouTube URL
- Manual ROI selection on one captured frame
- Full-video crop, dedupe, overlap cleanup, normalization, and stitching into one combined score image
- A clear project model that later agents can attach frame extraction and OCR to

## MVP Non-Goals

- Perfect automatic tab transcription
- Songsterr-level synchronized playback in the first iteration
- Full MusicXML or Guitar Pro export in the first iteration
- Automatic interpretation of every notation ornament from every creator's overlay

## Key Constraints

- Browser-only access to embedded YouTube pixels is restricted by cross-origin rules.
- Different creators use different fonts, staff spacing, zoom levels, and screen layouts.
- Standard notation and guitar tab are often stacked together, so the crop logic should prefer the bottom tab staff first.
- OCR errors are unavoidable, especially for stacked double-digit frets and repeated symbols.

## Product Decisions Made

- The app will be web-first.
- The MVP can ship with image-based tab creation if direct URL processing is too heavy at first.
- Manual ROI selection is a first-class feature, not just a fallback.
- Auto-detection should be additive, not mandatory.
- The first useful export is one stitched score image plus JSON metadata before a fully interactive player exists.
- The ROI is currently assumed to stay in a stable screen region throughout the video.
- Repeated capture overlap should be removed, but musically repeated sections later in the song should not be collapsed automatically without a deliberate rule.

## Risks And Mitigations

### Risk: direct YouTube processing is blocked on local dependencies

Mitigation: keep image upload and ROI selection working even when `yt-dlp` or `ffmpeg` are missing.

### Risk: OCR quality is not good enough for raw export

Mitigation: keep stitched image export as the reliable baseline and favor semi-automatic extraction over silent automation.

### Risk: the desired Songsterr-like playback becomes a large scope increase

Mitigation: keep the domain model compatible with timed note events, but ship image-first export in the MVP.

## Open Questions For A Later Iteration

- Which export matters most after image output: ASCII tab, JSON, or MusicXML?
- Should the editor optimize for single-riff practice clips first or full-song captures?
- How much user correction is acceptable before the OCR pipeline feels helpful instead of frustrating?
- Should later versions collapse repeated song sections, or only remove capture overlap between neighboring frames?
