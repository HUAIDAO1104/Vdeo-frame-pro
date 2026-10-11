# Frame Studio / 帧选

## Product Scope

Windows-first image production workspace for stock-footage sellers. Import videos
or image folders, select locally or with AI, then edit and export cover/detail images.
The current product is image-only. Do not restore retired document or SEO workflows.

## Visual System

`public/static/workspace.css` owns the current quiet white/gray workspace with restrained
violet actions. Preserve its established typography, density and two-view navigation.
The red strip is part of exported detail artwork, not a global theme change.
Keep controls compact, grouped by the asset they edit, with progressive disclosure for
title styling. Use native range inputs, checkboxes and selects with accessible labels.

## Interaction Contracts

- Processing belongs to the task queue; viewing/editing belongs to the selected project.
- Completed images remain available while other tasks run, fail, pause or stop.
- Failed jobs can be appended to an active queue without duplicates. Retry-all skips
  successes. Resume unfinished jobs after stop; never silently regenerate successes.
- Show actual stage/counts and live elapsed times. No simulated progress. Time excludes
  pauses and idle gaps; cumulative project time survives retry and history restoration.
- Navigate to outcomes when a batch ends only if the user is still on Generate.
- Title styling updates actual exported pixels, persists per asset and supports undo.
  Saved defaults apply to future jobs (including not-yet-started queued jobs) across
  restarts. Explicit bulk apply affects only the current project's detail images and
  preserves each title. Old history is never restyled just by changing defaults.
  Height and requested font size are percentages of output width, independent of export
  resolution. Long text shrinks to fit one or at most two lines without stretching.
- Preserve original assets during regeneration, cancellation and failed requests.

## Verification

Run `scripts/run-tests.mjs`, browser suites in `tests/*.e2e.mjs`, native tests and both
web/desktop builds. Recovery tests include 1280/1440/1920 desktop screenshots, actual
canvas-pixel checks, repeated retry, stop/resume, clocks, undo/redo and history.
Windows publication requires CI, installer smoke test, signed updater manifest and
checksums before making the draft release public.
