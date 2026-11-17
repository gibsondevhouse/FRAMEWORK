# Stage 3 · Phase 2 · Part 2: Accessibility & Focus Trapping

## 1. Objectives
Ensure the dual-track navigation rail complies with WCAG AA standards, supports proper ARIA roles (`tablist`, `tab`, `tabpanel`), and manages focus cleanly during drawer sliding.

## 2. Technical Specification

### 2.1 ARIA Role Hierarchy
- Primary Activity Rail: `role="tablist"` with `aria-orientation="vertical"`.
- Each Rail Item: `role="tab"` with `aria-selected="true|false"` and `aria-controls="sliding-drawer"`.
- Sliding Drawer: `role="tabpanel"` with `aria-labelledby="{activeRailId}"`.

### 2.2 Focus Management
- Expanding the drawer moves keyboard focus into the drawer's filter or first action.
- Collapsing the drawer returns focus gracefully to the active rail icon button.
- Reduced motion preferences instantly zero out transition durations:
```css
@media (prefers-reduced-motion: reduce) {
  .sliding-drawer, .rail-btn::before {
    transition: none !important;
  }
}
```

## 3. Acceptance Criteria
- [ ] Screen readers announce active vertical upon rail switch.
- [ ] Focus does not remain trapped inside hidden DOM nodes when collapsed.
