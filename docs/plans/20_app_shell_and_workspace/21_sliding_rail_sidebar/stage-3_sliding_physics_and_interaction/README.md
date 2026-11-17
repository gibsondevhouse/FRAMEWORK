# Stage 3: Sliding Physics, State Machine & Keyboard Ergonomics

## Goal
Implement the sliding rail physics, transition state machine (Pinned Dock vs. Flyout Peek mode), `localStorage` state persistence, and full keyboard shortcut ergonomics.

## Phases & Parts

- **Phase 1: Drawer State Machine & Modes**
  - [Part 1: Pinned Dock vs. Flyout Peek Mode](file:///Users/gibdevlite/Desktop/FRAMEWORK/docs/plans/20_app_shell_and_workspace/21_sliding_rail_sidebar/stage-3_sliding_physics_and_interaction/phase-1_drawer_state_machine/part-1_pinned_dock_vs_flyout_overlay.md)
  - [Part 2: State Persistence & Route Synchronization](file:///Users/gibdevlite/Desktop/FRAMEWORK/docs/plans/20_app_shell_and_workspace/21_sliding_rail_sidebar/stage-3_sliding_physics_and_interaction/phase-1_drawer_state_machine/part-2_state_persistence_and_route_sync.md)
- **Phase 2: Keyboard Shortcuts & Ergonomics**
  - [Part 1: Hotkeys & Global Command Bar Integration](file:///Users/gibdevlite/Desktop/FRAMEWORK/docs/plans/20_app_shell_and_workspace/21_sliding_rail_sidebar/stage-3_sliding_physics_and_interaction/phase-2_keyboard_shortcuts_and_gestures/part-1_hotkeys_and_command_bar_integration.md)
  - [Part 2: Accessibility & Focus Trapping](file:///Users/gibdevlite/Desktop/FRAMEWORK/docs/plans/20_app_shell_and_workspace/21_sliding_rail_sidebar/stage-3_sliding_physics_and_interaction/phase-2_keyboard_shortcuts_and_gestures/part-2_accessibility_focus_trapping.md)

## Success Criteria
- Pinned mode cleanly reflows the grid; Flyout mode overlays on top of the reading panel with frosted backdrop blur.
- `Cmd+B` toggles the drawer in under 16ms with zero layout thrashing.
- Pressing `1` through `5` instantly switches the active rail vertical.
