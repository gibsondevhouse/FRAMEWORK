# Master Plan: Dual-Track Sliding Rail Sidebar Navigation

## Executive Overview

This master plan governs the architecture and implementation of a next-generation **Dual-Track Sliding Rail Navigation System** for the **FRAMEWORK** eCFR application.

The design satisfies the user's desire for **sliding rails** while consolidating all primary application verticals into a unified, high-density, Linear-inspired workspace:
1. **Primary Icon Rail (Activity Track)**: A fixed 48px slim rail holding iconic anchors for **Overview**, **Home**, **Reader**, **Projects**, **Download / Library**, and bottom-pinned **Settings**.
2. **Sliding Secondary Drawer (Content Track)**: A smooth slide-out drawer (~280px resizable) that morphs dynamically based on the active rail item:
   - **Reader**: Hosts the 3-tier Table of Contents (Agencies › Parts › Sections) with quick filtering and foldable subparts.
   - **Projects**: Hosts custom compliance dossiers, bookmarked regulatory clauses, audit workspaces, and tag collections.
   - **Download**: Hosts active transfer progress, installed title summaries, and one-click compliance suite triggers.
   - **Settings**: Hosts reader typography controls, offline cache pruner, theme switches, and keyboard shortcut cheatsheets.
   - **Overview / Home**: Auto-retracts for distraction-free broadsheet reading or displays recent reading history.
3. **Sliding Rail Physics**: Dual operating modes: **Pinned/Docked** (pushes content with resizable boundary) and **Flyout/Peek** (floating overlay with frosted backdrop blur, ideal for reading mode without disrupting column width).

---

## Directory Hierarchy & Plan Architecture

The rollout is structured into **4 Stages**, each with **Phases**, and each phase subdivided into **Parts**:

```
docs/plans/sliding_rail_sidebar/
├── MASTER_PLAN.md
├── stage-1_dual_track_rail_architecture/
│   ├── README.md
│   ├── phase-1_dom_and_grid_layout/
│   │   ├── part-1_primary_icon_rail.md
│   │   └── part-2_sliding_secondary_drawer.md
│   └── phase-2_tokens_and_linear_styling/
│       ├── part-1_rail_item_tokens_and_active_pills.md
│       └── part-2_notification_and_transfer_badges.md
├── stage-2_navigation_targets_and_drawers/
│   ├── README.md
│   ├── phase-1_core_navigation_drawers/
│   │   ├── part-1_reader_toc_drilldown_drawer.md
│   │   ├── part-2_download_and_library_drawer.md
│   │   └── part-3_overview_and_home_behaviors.md
│   └── phase-2_workspace_drawers_projects_settings/
│       ├── part-1_projects_workspace_drawer.md
│       └── part-2_settings_and_preferences_drawer.md
├── stage-3_sliding_physics_and_interaction/
│   ├── README.md
│   ├── phase-1_drawer_state_machine/
│   │   ├── part-1_pinned_dock_vs_flyout_overlay.md
│   │   └── part-2_state_persistence_and_route_sync.md
│   └── phase-2_keyboard_shortcuts_and_gestures/
│       ├── part-1_hotkeys_and_command_bar_integration.md
│       └── part-2_accessibility_focus_trapping.md
└── stage-4_projects_engine_and_verification/
    ├── README.md
    ├── phase-1_projects_client_data_engine/
    │   ├── part-1_projects_json_schema_and_dossiers.md
    │   └── part-2_section_bookmarking_and_notes.md
    └── phase-2_testing_and_regression_gates/
        ├── part-1_automated_sidebar_tests.md
        └── part-2_responsive_verification_checklist.md
```

---

## Visual Architecture: Dual-Track Sliding Rail

```
┌──────┬──────────────────────────────┬────────────────────────────────────────────────────────┐
│ PRIMARY│ SECONDARY SLIDING DRAWER     │ MAIN READING PANEL / WORKSPACE                         │
│  RAIL  │ (Dynamically updates content)│                                                        │
│ (48px) │ (~280px · resizable · slide) │                                                        │
├──────┼──────────────────────────────┤                                                        │
│ [ ⚡ ]│  READER TABLE OF CONTENTS    │                                                        │
│ Word │  Agencies › OSHA › Part 1910 │  29 CFR § 1910.1200                                    │
│ mark │  ┌─────────────────────────┐ │  Hazard Communication                                  │
│      │  │ Q Filter sections...    │ │                                                        │
│ [ 🏠 ]│  └─────────────────────────┘ │  (a) Purpose.                                          │
│ Over-│  ▾ Subpart Z — Toxic Subs    │  (1) The purpose of this section is to ensure that...  │
│ view │    § 1910.1000 Air contam.   │                                                        │
│      │    § 1910.1020 Exposure      │                                                        │
│ [ 📖 ]│  ▸ § 1910.1200 HazCom [●]   │                                                        │
│Reader│    § 1910.1450 Lab haz.      │                                                        │
│ (Lit)│                              │                                                        │
│      ├──────────────────────────────┤                                                        │
│ [ 📁 ]│  [Or PROJECTS Drawer]        │                                                        │
│ Proj-│  • OSHA Audit 2026 (4 items) │                                                        │
│ ects │  • EPA Title V Review        │                                                        │
│      │  [+ New Dossier]             │                                                        │
│ [ 📥 ]├──────────────────────────────┤                                                        │
│ Down-│  [Or DOWNLOAD Drawer]        │                                                        │
│ load │  • Title 40: 44% (18.4 MB)   │                                                        │
│ (Dot)│  • EHS Core Suite            │                                                        │
│      ├──────────────────────────────┤                                                        │
│      │                              │                                                        │
│ ──── ┼──────────────────────────────┤                                                        │
│ [ ⚙️ ]│  [Or SETTINGS Drawer]        │                                                        │
│ Set- │  • Theme: Dark / Light       │                                                        │
│ tings│  • Type Size: 16px           │                                                        │
│      │  • Cache: 410 MB [Prune]     │                                                        │
└──────┴──────────────────────────────┴────────────────────────────────────────────────────────┘
  ▲                   ▲                                   ▲
  │                   │                                   │
Fixed Track     Sliding Drawer                      Main Viewport
(Always visible)(Slides in/out via CSS transform)  (Adjusts grid or floats)
```

---

## Architectural Principles

1. **Information Scent with Zero Clutter**: The primary 48px rail provides permanent landmark anchors without consuming horizontal reading space.
2. **Silk-Smooth Sliding Transitions**: Rail drawer slide-ins utilize CSS transform (`translateX`) with GPU acceleration and cubic-bezier easing (`var(--ease)`).
3. **Decoupled Workspaces**: The TOC tree, user Projects dossiers, Library management, and Settings coexist cleanly without modal interruptions.
4. **Offline-First & Local Persistence**: Project dossiers, drawer widths, and open/minimized states are stored locally in indexed `localStorage`.
