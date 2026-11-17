# Stage 4 · Phase 2 · Part 2: Responsive Verification & Quality Checklist

## 1. Objectives
Exhaustive verification protocol across viewport breakpoints, touch devices, and input modes.

## 2. Verification Protocol

### 2.1 Viewport Breakpoint Matrix
- [ ] **Desktop Widescreen (>1400px)**:
  - [ ] 48px Activity Rail + 288px Pinned Drawer + Main reading column + Ask Claude panel can all display concurrently without overlap.
- [ ] **Standard Laptop (1024px – 1399px)**:
  - [ ] Opening Ask Claude automatically shifts drawer to Flyout mode or collapses smoothly.
- [ ] **Tablet (768px – 1023px)**:
  - [ ] Sliding drawer opens as a floating overlay with frosted glass backdrop blur.
  - [ ] Backdrop tap dismisses drawer.
- [ ] **Mobile (<768px)**:
  - [ ] 48px rail remains accessible or tucks into bottom navigation bar.
  - [ ] Drawer slides out over full screen width minus 48px.

### 2.2 Quality & Performance Gates
- [ ] Sliding animations maintain 60/120fps with no CPU spikes or dropped frames.
- [ ] Resizing the drawer updates smoothly with no text selection accidents.
- [ ] Switching between Reader, Projects, and Download retains scroll positions per drawer.
- [ ] All 70 existing test suite tests continue to pass.
