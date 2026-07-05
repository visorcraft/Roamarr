# Collapsible Grouped Sidebar Design

## Goal

Improve the scannability and scalability of Roamarr's left sidebar by replacing
the current flat list of 11–12 navigation items with collapsible grouped
sections.

## Context

The current sidebar (`src/routes/+layout.svelte`) renders a single `NAV` array
of links plus a separate `SETTINGS` link for admins. As the feature surface has
grown, the flat list has become visually crowded and makes it harder to locate
items at a glance. Grouping related items into expandable sections keeps the
sidebar organized and leaves clear buckets for future features.

## Design

### Group structure

| Section | Items | Rationale |
|---|---|---|
| **Plan** | Dashboard, Trips, Notifications | Core trip planning and the activity feed |
| **Me** | Documents, Reminders, Loyalty, Visited, SMTP, Security | Personal traveler data and preferences |
| **Organizer** | Cards, Insurance, Groups | Reference data and sharing |
| **Admin** | Settings | Instance-level configuration (admin only) |

### Behavior

- **Default state on desktop**: all sections start expanded so existing users
  retain their mental model.
- **User toggle**: clicking a section header collapses or expands just that
  section.
- **State persistence**: collapse state is stored in `localStorage` under a key
  such as `roamarr.sidebar.sections` and restored on load.
- **Active item handling**: the active link keeps its existing highlight style.
  If the active item is inside a collapsed section, the section auto-expands.
- **Unread badge**: the Notifications unread count badge is shown on the
  Notifications link when expanded and on the Plan section header when the
  section is collapsed.
- **Mobile drawer**: sections behave the same inside the mobile slide-out
  drawer. Tapping a section header toggles it; tapping a link closes the drawer.
- **Keyboard and accessibility**: section headers are `<button>` elements with
  `aria-expanded`. Arrow keys move between headers. The existing focus trap in
  the mobile drawer remains intact.

### Data structure

Replace the flat `NAV` array with a grouped structure:

```ts
const SECTIONS: {
  label: string;
  admin?: boolean;
  items: { href: string; label: string; icon: IconName }[];
}[] = [
  {
    label: 'Plan',
    items: [
      { href: '/', label: 'Dashboard', icon: 'home' },
      { href: '/trips', label: 'Trips', icon: 'trips' },
      { href: '/notifications', label: 'Notifications', icon: 'notification' }
    ]
  },
  {
    label: 'Me',
    items: [
      { href: '/profile/documents', label: 'Documents', icon: 'document' },
      { href: '/profile/reminders', label: 'Reminders', icon: 'reminder' },
      { href: '/profile/loyalty', label: 'Loyalty', icon: 'loyalty' },
      { href: '/profile/visited', label: 'Visited', icon: 'location' },
      { href: '/profile/notifications', label: 'SMTP', icon: 'notification' },
      { href: '/profile/security', label: 'Security', icon: 'star' }
    ]
  },
  {
    label: 'Organizer',
    items: [
      { href: '/cards', label: 'Cards', icon: 'card' },
      { href: '/insurance', label: 'Insurance', icon: 'insurance' },
      { href: '/groups', label: 'Groups', icon: 'group' }
    ]
  },
  {
    label: 'Admin',
    admin: true,
    items: [{ href: '/settings', label: 'Settings', icon: 'settings' }]
  }
];
```

### Visual design

- Section headers use a slightly muted style compared to links, with a chevron
  icon indicating collapsed/expanded state.
- Links inside a section are indented slightly to reinforce hierarchy.
- The active link style remains unchanged.
- Section spacing uses the existing sidebar padding scale.

## Scope

### In scope

- Regroup existing navigation links into collapsible sections.
- Add expand/collapse toggle buttons on section headers.
- Persist collapse state in `localStorage`.
- Move the Notifications unread badge to the Plan section header when collapsed.
- Update keyboard navigation and mobile drawer behavior.
- Update any e2e tests that rely on the flat sidebar structure.

### Out of scope

- Icon-only collapsed sidebar.
- Reordering or drag-and-drop sections.
- Changes to the top user menu or app footer.

## Testing

- Existing Playwright e2e specs that click sidebar links may need updated
  selectors or an expand step before clicking nested items.
- Add a new e2e spec verifying section expand/collapse and persistence.
- Verify the Notifications badge appears on both the link and the collapsed
  section header.
- Verify mobile drawer focus trap and keyboard navigation still work.

## Risks

- Habituated users may need a short adjustment period; mitigated by starting
  with all sections expanded.
- The unread badge on a section header is a new UI element; keep it visually
  identical to the current badge to avoid confusion.
