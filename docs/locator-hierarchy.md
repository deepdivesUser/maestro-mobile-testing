# Maestro Locator Hierarchy

When Maestro encounters a command like `tapOn`, `assertVisible`, `inputText`, or
`scrollUntilVisible`, it must **find an element on screen**. Maestro tries
locator strategies in a defined priority order, falling through to the next
strategy when a match isn't found.

Understanding this hierarchy is critical for writing **reliable, fast, and
maintainable** flows — and for debugging flaky tests that intermittently fail
to find elements.

## Hierarchy (Highest → Lowest Priority)

```
  1. id           Accessibility identifier / resource-id
  2. text         Exact or partial visible text match
  3. textRegex    Regex match against visible text
  4. label        iOS accessibilityLabel / Android content-description
  5. className    Widget class name (e.g. Button, TextView)
  6. size         Width × height pixel dimensions
  7. below        Relative: directly below another element
  8. above        Relative: directly above another element
  9. leftOf       Relative: directly left of another element
 10. rightOf      Relative: directly right of another element
 11. image        Visual matching against a reference image
 12. containsChild Element containing a child matching criteria
 13. index        Positional index among multiple matches
```

### Visual

```
  ┌─────────────────────────────────────────────────────┐
  │              MAESTRO LOCATOR STRATEGY               │
  ├─────────────────────────────────────────────────────┤
  │                                                     │
  │   LAYER 1 — EXACT MATCH (fast, deterministic)       │
  │   ┌─────────┐  ┌─────────┐  ┌───────────┐          │
  │   │   id    │  │  text   │  │ textRegex │          │
  │   │   ①     │→ │   ②     │→ │    ③      │          │
  │   └─────────┘  └─────────┘  └───────────┘          │
  │        │             │              │                │
  │        └─────────────┴──────────────┘                │
  │                      │ not found?                    │
  │                      ▼                              │
  │   LAYER 2 — SEMANTIC MATCH (accessibility)          │
  │   ┌─────────┐  ┌────────────┐                       │
  │   │  label  │  │ className  │                       │
  │   │   ④     │→ │     ⑤      │                       │
  │   └─────────┘  └────────────┘                       │
  │        │             │                              │
  │        └─────────────┘                              │
  │              │ not found?                           │
  │              ▼                                      │
  │   LAYER 3 — GEOMETRIC / RELATIVE (contextual)      │
  │   ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐             │
  │   │below │ │above │ │leftOf│ │rightO│             │
  │   │  ⑦   │ │  ⑧   │ │  ⑨   │ │  ⑩   │             │
  │   └──────┘ └──────┘ └──────┘ └──────┘             │
  │        └─────────┴───────────┘                      │
  │                  │ not found?                        │
  │                  ▼                                  │
  │   LAYER 4 — HEAVY / FALLBACK (slow)                │
  │   ┌──────┐  ┌──────────┐  ┌──────┐                │
  │   │ image│  │containsCh│  │index │                │
  │   │  ⑪   │→ │   ild ⑫  │→ │  ⑬   │                │
  │   └──────┘  └──────────┘  └──────┘                │
  │                                                     │
  └─────────────────────────────────────────────────────┘
```

## Layer Details

### Layer 1 — Exact Match (fast, deterministic)

These locators are the fastest because they query the accessibility tree
or view hierarchy directly — no parsing of rendered text, no image comparison.

#### ① `id` — Accessibility Identifier

Matches against the platform accessibility identifier:

| Platform | Source |
|----------|--------|
| iOS | `accessibilityIdentifier` (in code) or `accessibility-id` (in SwiftUI) |
| Android | `resource-id` (e.g. `com.example.app:id/email_field`) |

```yaml
- tapOn:
    id: "email_field"

- tapOn:
    id: "skip_button"
    optional: true
```

**When to use:** When the element has a stable, unique accessibility ID. This
is the **single best locator** — it's immune to text changes, translations,
and UI redesigns.

**When to avoid:** When the ID is auto-generated (e.g. `Text(42)`),
non-deterministic, or shared across multiple elements.

#### ② `text` — Visible Text

Matches against the **rendered visible text** of a view. Performs a
**partial, case-insensitive, substring** match.

```yaml
# Shorthand (string)
- tapOn: "Sign in"
- assertVisible: "Home"

# Explicit (map)
- tapOn:
    text: "Create Account"

- inputText:
    text: "hello@example.com"
    into:
      text: "Email"
```

**Matching behavior:**

- Partial match: searching for `"Sign"` will match `"Sign in"`, `"Sign up"`, `"Sign out"`
- Case-insensitive: `"SIGN IN"` matches `"sign in"`
- Searches the **entire visible text** of the view and all its children recursively

**When to use:** Most common case — buttons, labels, links with visible text.

**When to avoid:** When text is dynamic (timestamps, usernames, counters) or
when the same text appears in multiple elements on screen.

#### ③ `textRegex` — Regex on Visible Text

Same as `text` but uses a regular expression for matching.

```yaml
- assertVisible:
    textRegex: "\d+ items? found"

- tapOn:
    textRegex: "(Sign|Log) ?[Ii]n"
```

**When to use:** When text has variable parts (numbers, dates, statuses)
but follows a predictable pattern.

**When to avoid:** Over-complicated regexes become a maintenance burden.
Prefer `text` when possible.

---

### Layer 2 — Semantic Match (accessibility metadata)

#### ④ `label` — Accessibility Label

Matches against the accessibility label, which may differ from visible text.

| Platform | Source |
|----------|--------|
| iOS | `accessibilityLabel` |
| Android | `contentDescription` |

```yaml
- tapOn:
    label: "Navigate back"

- assertVisible:
    label: "User avatar"
```

**When to use:** Icons/buttons that have no visible text but have
accessibility labels set by developers. Also useful for localised apps
where the displayed text differs from the semantic label.

**When to avoid:** When developers haven't set accessibility labels (most
apps have poor a11y coverage). In that case this locator will simply not match.

#### ⑤ `className` — Widget Class Name

Matches the underlying platform class name.

```yaml
# Android
- tapOn:
    className: "android.widget.Button"

# iOS
- tapOn:
    className: "UIButton"
```

**When to use:** Very rarely. Useful as a last-resort filter when no other
locator works, or to target platform-specific widgets.

**When to avoid:** Class names are fragile — they change with refactors,
and a class name alone rarely uniquely identifies a single element.
Always combine with another locator.

---

### Layer 3 — Geometric / Relative (contextual)

These don't match an element on their own — they **narrow down** candidates
found by other locators within the same block.

#### ⑥ `size` — Dimensions

```yaml
- assertVisible:
    size:
      width: 200
      height: 48
      tolerance: 10
```

#### ⑦–⑩ Relative Position — `below`, `above`, `leftOf`, `rightOf`

These are **modifiers**, not standalone locators. They find the element
that matches the primary criteria AND is positioned relative to another
known element.

```yaml
- tapOn:
    text: "Submit"
    below: "Password"        # The "Submit" button below the "Password" field

- inputText:
    text: "john@example.com"
    into:
      text: "Email"
      rightOf: "Logo"        # The "Email" field to the right of the "Logo"

- tapOn:
    text: "Delete"
    rightOf: "Item Name"     # Disambiguate: the "Delete" next to a specific item
```

**When to use:** When multiple elements share the same text/id and you need
to disambiguate by position. Extremely useful for list items, table cells,
and form layouts.

**When to avoid:** As a primary locator — always combine with `text`, `id`,
or `label`. Relative position alone is too fragile (layout changes break it).

---

### Layer 4 — Heavy / Fallback (slow)

#### ⑪ `image` — Visual Image Matching

Maestro takes a screenshot of the device and performs template matching
against a reference image. This is the **slowest** strategy.

```yaml
- tapOn:
    image: "assets/login-button.png"

- assertVisible:
    image: "assets/success-state.png"
```

**How it works:**
1. Takes a screenshot of the current screen
2. Searches for the reference image within the screenshot using template matching
3. Taps/asserts on the matched region

**When to use:** Elements with no text, no ID, and no accessibility label
custom-drawn UI, canvas elements, or brand-specific icons that you can't
reliably target otherwise.

**When to avoid:** As a first choice — it's slow (~1–3s per match), fragile
across screen sizes/densities/themes, and reference images must be
maintained alongside the flows.

#### ⑫ `containsChild` — Child Element Match

Matches a parent element that contains a child matching given criteria.

```yaml
- tapOn:
    containsChild:
      text: "3 new messages"

- assertVisible:
    containsChild:
      id: "notification_badge"
```

**When to use:** When you need to target a container/row/card that holds
a specific child element.

#### ⑬ `index` — Positional Index

When multiple elements match, pick one by its zero-based index.

```yaml
- tapOn:
    text: "Item"
    index: 2                   # The 3rd element matching "Item"
```

**When to use:** Lists where items have identical text but you need a
specific one. Combine with `scrollUntilVisible` for off-screen items.

**When to avoid:** Indices are extremely fragile — adding/removing an
item shifts all subsequent indices. Prefer `rightOf`, `below`, or
`containsChild` for disambiguation.

## Boolean Modifiers

These **do not locate** an element — they filter or modify how a located
element is handled. They combine with any of the locators above.

| Modifier | Type | Description |
|----------|------|-------------|
| `optional: true` | Skip if not found | Don't fail the flow if the element is absent |
| `enabled: true` | Filter | Only match elements that are enabled/interactive |
| `checked: true` | Filter | Only match elements in a checked state |
| `selected: true` | Filter | Only match elements that are selected |
| `focused: true` | Filter | Only match the currently focused element |
| `repeat: N` | Action | Tap/assert N times on the found element |
| `delay: ms` | Timing | Wait N milliseconds before interacting |

```yaml
- tapOn:
    text: "Allow notifications"
    optional: true

- tapOn:
    text: "Next"
    enabled: true           # Only tap if the button is enabled (not greyed out)

- tapOn:
    id: "checkbox"
    checked: false          # Only match unchecked checkboxes

- tapOn:
    text: "Accept"
    repeat: 2               # Double-tap
    delay: 300              # Wait 300ms between taps
```

## Combining Locators

Multiple criteria within a single block are **AND**-combined — all must
match for the element to be found.

```yaml
# Find the "Submit" button that is BELOW the "Password" field
- tapOn:
    text: "Submit"
    below: "Password"

# Find the 2nd "Item" text element, only if it's enabled
- tapOn:
    text: "Item"
    index: 1
    enabled: true

# Find by ID with optional fallback
- tapOn:
    id: "skip_onboarding"
    optional: true
```

## Locating Input Fields

`inputText` supports two modes for finding the target field:

```yaml
# 1. Focus-based: type into whatever field is currently focused
- tapOn: "Email"       # Focus the field first
- inputText: "user@example.com"

# 2. Explicit `into`: find and type into a specific field
- inputText:
    text: "user@example.com"
    into:
      text: "Email"              # By visible text
      # or
      id: "email_field"           # By accessibility ID
      # or
      label: "Email address"      # By a11y label

# 3. With clearTextField: erase existing text first
- inputText:
    text: "new-email@example.com"
    into:
      id: "email_field"
    clearTextField: true
```

**Priority for `into` locator resolution** follows the same hierarchy:
`id` → `text` → `textRegex` → `label` → `className` → relative → image → index.

## Best Practices for This Project

### Decision Tree

```
Element has a stable accessibility ID?
  └─ YES → use id:                  ✅ BEST
  └─ NO  → Element has unique visible text?
           └─ YES → use text: (string)    ✅ GOOD
           └─ NO  → Multiple elements share the same text?
                    └─ YES → add relative position (below/above/leftOf/rightOf)
                    │        or add index
                    └─ NO  → Element has accessibility label?
                             └─ YES → use label:        ⚠️  IF SET
                             └─ NO  → Element has dynamic text (regex pattern)?
                                      └─ YES → use textRegex:  ⚠️  IF SIMPLE
                                      └─ NO  → Last resort: image:  ❌ AVOID
```

### Rules of Thumb

1. **`id` > `text` > everything else** — IDs are immune to i18n and copy changes
2. **Use shorthand when possible** — `tapOn: "Text"` instead of `tapOn: { text: "Text" }`
3. **Disambiguate with relative position, not index** — `below: "Label"` is more readable and resilient than `index: 2`
4. **Mark uncertain elements `optional: true`** — dialogs, onboarding, notifications that may or may not appear
5. **Avoid `image` and `className` as primary locators** — they're slow and fragile
6. **Avoid `index` for list items** — list order changes break indices; prefer `rightOf` or `containsChild`
7. **Use `text` for forms, `id` for actions** — form fields often have IDs; buttons often have clear text
8. **Pair `inputText` with `tapOn`** — tap to focus, then type. Or use `into:` for explicit targeting
9. **Document non-obvious locators** — add a comment explaining why a specific strategy was chosen

### Examples from This Project

```yaml
# ✅ Text shorthand — simple, readable
- tapOn: "Sign in"
- assertVisible: "Home"

# ✅ ID for elements that may not have visible text
- tapOn:
    id: "skip_button"
    optional: true

# ✅ Text + optional — element may not always be present
- tapOn:
    text: "Skip"
    optional: true

# ✅ Relative position — disambiguate when text is generic
- tapOn:
    text: "Log out"
    # (found via scrollUntilVisible with direction)

# ✅ Nested assertion — check specific text is visible
- assertVisible:
    text: "Home"
```

## Debugging Locator Issues

When Maestro can't find an element, it fails with:

```
❌ Assertion 'assertVisible' failed: Could not find element with text '...'
```

### Checklist

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Found wrong element | Text not unique | Add `below:`/`above:` relative, or switch to `id:` |
| Element not found | Text changed | Update the locator text |
| Element not found | Element off-screen | Add `scrollUntilVisible` before the interaction |
| Element not found | Element not yet rendered | Add `waitForAnimationToEnd` or `wait: 1000` |
| Element not found | Wrong screen / not logged in | Add preceding navigation steps |
| Intermittent failures | Timing issue | Add `waitForAnimationToEnd` before the locator |
| Intermittent failures | Multiple matches with `index` | Switch to relative position locators |
| Image match fails | Screen size / theme difference | Use `id` or `text` instead |

### Inspection Tips

```bash
# Dump the current view hierarchy (Android)
adb shell uiautomator dump && adb pull /sdcard/window_dump.xml

# Inspect accessibility tree (iOS Simulator)
xcrun simctl accessibility <udid> inspect

# Maestro Studio — interactive element inspector
maestro studio
```
