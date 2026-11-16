# Stage 4 · Phase 3 · Part 2: UI Regression & Performance Checklist

## 1. Objectives
Provide an exhaustive verification checklist to ensure visual fidelity, responsiveness, and keyboard accessibility across macOS and Windows browsers.

## 2. Verification Protocol

### 2.1 Visual & Responsive Quality Gates
- [ ] **Broadsheet Grid**:
  - [ ] Desktop (>1024px): 65% Lead Suite Hero / 35% Regulatory Wire.
  - [ ] Tablet/Mobile (<900px): Clean vertical stack without horizontal overflow.
  - [ ] Widescreen (>1400px): Topic desks transition into a 3-column balanced grid.
- [ ] **Transfer Dock**:
  - [ ] Remains anchored at `bottom: 24px; right: 28px` with 16px backdrop blur.
  - [ ] Does not obstruct the pinned `#view-head` or table of contents controls.
  - [ ] Minimized pill stays legible and clickable on screens down to 360px width.
- [ ] **Linear Micro-Interactions**:
  - [ ] Status dots maintain exact 6px diameter with crisp borders on 2x/3x Retina displays.
  - [ ] Action buttons fade in with CSS mask gradient; no clipping on long regulatory titles.
  - [ ] Two-step armed confirmation on "Remove" functions with automatic 4-second disarm timeout.

### 2.2 Keyboard & Accessibility Gates
- [ ] Tab order reaches filter search, desk segments, suite triggers, and title links sequentially.
- [ ] Pressing `Enter` or `Space` on action triggers invokes expected download/open actions.
- [ ] All status dots use `aria-hidden="true"` while semantic text remains accessible to screen readers.
- [ ] `prefers-reduced-motion` cleanly disables the pulse ring and indeterminate progress bar slide.

### 2.3 Performance & Threading Gates
- [ ] Client CPU usage remains below 2% when the transfer dock is polling.
- [ ] Memory footprint does not leak event listeners across view navigation cycles.
- [ ] Pytest suite completes 100% green (`pytest tests -q`).
