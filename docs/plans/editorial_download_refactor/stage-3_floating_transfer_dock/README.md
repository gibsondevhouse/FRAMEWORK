# Stage 3: Enterprise Floating Transfer Dock & Progress Telemetry

## Goal
Decouple job tracking from the Library document flow and implement a globally mounted, persistent floating Transfer Dock (HUD) that stays visible across all views in the application while downloads are queued or running.

## Phases & Parts

- **Phase 1: Dock Architecture & Viewport Mounting**
  - [Part 1: Persistent Global Viewport Mounting](file:///Users/gibdevlite/desktop/FRAMEWORK/docs/plans/editorial_download_refactor/stage-3_floating_transfer_dock/phase-1_dock_architecture/part-1_persistent_viewport_mounting.md)
  - [Part 2: Dock States (Minimized Pill vs. Expanded Card)](file:///Users/gibdevlite/desktop/FRAMEWORK/docs/plans/editorial_download_refactor/stage-3_floating_transfer_dock/phase-1_dock_architecture/part-2_dock_minimized_expanded_states.md)
- **Phase 2: Telemetry & Pipeline Progress Engine**
  - [Part 1: Linear Progress Bar & Glow Animation](file:///Users/gibdevlite/desktop/FRAMEWORK/docs/plans/editorial_download_refactor/stage-3_floating_transfer_dock/phase-2_telemetry_and_pipeline_progress/part-1_progress_bar_and_glow.md)
  - [Part 2: Real-time Throughput & Dynamic ETA](file:///Users/gibdevlite/desktop/FRAMEWORK/docs/plans/editorial_download_refactor/stage-3_floating_transfer_dock/phase-2_telemetry_and_pipeline_progress/part-2_throughput_and_eta.md)
  - [Part 3: Pipeline Phase Descriptors & Step Indicators](file:///Users/gibdevlite/desktop/FRAMEWORK/docs/plans/editorial_download_refactor/stage-3_floating_transfer_dock/phase-2_telemetry_and_pipeline_progress/part-3_pipeline_phase_descriptors.md)

## Success Criteria
- Dock remains visible while switching between `#/library`, `#/`, and reading `#/section/{id}`.
- Zero layout shift inside the main reading view when downloads start or finish.
- Accurate MB transferred and dynamic ETA computation.
