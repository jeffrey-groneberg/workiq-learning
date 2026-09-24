---
name: "Work IQ showcase"
description: "Minimal integration lab / side-by-side code-review workbench."
colors:
  cp-bg: "#f7f4ef"
  cp-bg-elevated: "#fcfbf8"
  cp-surface: "#ffffff"
  cp-surface-soft: "#f5f5f5"
  cp-border: "#dedede"
  cp-border-strong: "#919191"
  cp-text: "#242424"
  cp-text-muted: "#5c5c5c"
  cp-accent: "#b11f4b"
  cp-accent-hover: "#9a1a41"
  cp-accent-soft: "rgba(177, 31, 75, 0.08)"
  cp-accent-fg: "#ffffff"
  cp-success: "#16a34a"
  cp-danger: "#dc2626"
  cp-link: "#0078d4"
  cp-overlay: "rgba(255, 255, 255, 0.8)"
  cp-bg-dark: "#3d3b3a"
  cp-bg-elevated-dark: "#343231"
  cp-surface-dark: "#292929"
  cp-surface-soft-dark: "#2e2e2e"
  cp-border-dark: "#474747"
  cp-border-strong-dark: "#5f5f5f"
  cp-text-dark: "#dedede"
  cp-text-muted-dark: "#b0b0b0"
  cp-accent-dark: "#fd8ea1"
  cp-accent-hover-dark: "#fb7b91"
  cp-accent-soft-dark: "rgba(253, 142, 161, 0.14)"
  cp-accent-fg-dark: "#1a1a1a"
  cp-success-dark: "#4ade80"
  cp-danger-dark: "#f87171"
  cp-link-dark: "#4da6ff"
  cp-overlay-dark: "rgba(41, 41, 41, 0.88)"
typography:
  body:
    fontFamily: '"Segoe UI", Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '"Segoe UI", Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.5
  metadata:
    fontFamily: '"Segoe UI", Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
  code:
    fontFamily: 'Consolas, "Courier New", Courier, monospace'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.75
  trace:
    fontFamily: 'Consolas, "Courier New", Courier, monospace'
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  small: "6px"
  field: "8px"
  control: ".625rem"
  frame: "16px"
spacing:
  "4": "4px"
  "8": "8px"
  "12": "12px"
  "16": "16px"
  "20": "20px"
  "24": "24px"
  "32": "32px"
components:
  button-primary:
    backgroundColor: "{colors.cp-accent}"
    textColor: "{colors.cp-accent-fg}"
    rounded: "{rounded.control}"
    padding: "7px 14px"
  button-primary-hover:
    backgroundColor: "{colors.cp-accent-hover}"
  button-secondary:
    backgroundColor: "{colors.cp-surface}"
    textColor: "{colors.cp-text}"
    rounded: "{rounded.control}"
    padding: "7px 14px"
  button-text:
    backgroundColor: "{colors.cp-surface}"
    textColor: "{colors.cp-text-muted}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  input:
    backgroundColor: "{colors.cp-surface}"
    textColor: "{colors.cp-text}"
    rounded: "{rounded.field}"
    padding: "10px 12px"
  protocol-tab-selected:
    backgroundColor: "{colors.cp-accent-soft}"
    textColor: "{colors.cp-accent}"
    rounded: "8px 8px 0 0"
    padding: "12px 20px"
  transport-selected:
    backgroundColor: "{colors.cp-surface}"
    textColor: "{colors.cp-accent}"
    rounded: "{rounded.small}"
    padding: "3px 12px"
  connection-status:
    textColor: "{colors.cp-text-muted}"
    rounded: "{rounded.small}"
    padding: "2px 8px"
  composer:
    backgroundColor: "{colors.cp-surface}"
    textColor: "{colors.cp-text}"
    rounded: "{rounded.control}"
    padding: "{spacing.12}"
  source-code:
    backgroundColor: "{colors.cp-bg-elevated}"
    textColor: "{colors.cp-text}"
    typography: "{typography.code}"
    padding: "16px 0"
---

# Design System: Work IQ showcase

## Overview

**Creative North Star: "Minimal integration lab / side-by-side code-review workbench"**

The shipped interface is a compact, text-led Electron workbench. Warm Clawpilot neutrals separate conversation, code and connection settings; rose identifies active choices and primary actions.

UI labels use the Segoe UI stack, while source and request data use the Consolas stack. Density comes from small controls, quiet borders and independently scrolling panes. Text-free illustrations generated with MAI-Image-2.6 give each route and explanatory dialog a recognizable scene in one style: flat line art on warm paper, a friendly white robot for the AI, soft greys and a single rose accent. Facts and labels stay in the HTML beside them.

**Key Characteristics:**
- Warm neutral surfaces with a rose interaction accent.
- Compact UI type paired with monospaced code.
- Flat, bordered working panes; modal-only shadow.

Evidence: [stylesheet](src/styles.css), [markup](src/index.html), [renderer](src/renderer.js) and [theme initialization](src/theme.js). This records implemented styling and behavior, not protocol or operating-system test coverage. Radius, spacing and typography keys name observed recurring values; they are not additional CSS custom properties.

## Colors

The palette is warm-neutral in light mode and warm-charcoal in dark mode, with rose controls and separate functional status/link colors.

### Primary
- **Rose** (`cp-accent`): primary actions, selected protocol/transport controls, focus and busy status; also the existing initial mark.
- **Hover rose**, **rose tint** and **accent foreground** supply primary hover, selected-tab fill and button text respectively.

### Neutral
- **Canvas**, **elevated canvas**, **surface** and **soft surface** separate the app background, inspector, working surfaces and user-message/disabled-control fills.
- **Border** divides regions; **strong border** identifies fields and stronger boundaries.
- **Text** carries content; **muted text** carries descriptions, hints and metadata.

Unqualified color keys are light-mode values; `-dark` keys are documentation names for their effective dark-mode equivalents, not new CSS variables. Dark secondary text inherits the body override `--cp-text-muted: var(--cp-text-soft)`, rather than the darker root-level muted declaration. Theme selection happens at startup from `clawpilotTheme`, falling back to the OS preference.

Success colors the connected-state dot; danger marks error borders while error text stays neutral. Link blue identifies documentation and returned citations, not a second brand accent. Overlay is the backdrop behind every dialog.

**The State Before Decoration Rule.** Rose marks primary actions, selections, busy status and focus; readiness and errors retain explicit text labels alongside their color cues.

## Typography

The frontmatter records the shared body, label, metadata, source and trace roles. The hierarchy is compact and task-specific rather than a fixed-ratio scale: pane titles and helper text sit close to body text, while route, dialog and empty-state headings provide localized emphasis. There is no separate display family.

Most controls use semibold weight; supporting prose uses regular weight. Chat replies loosen line height (1.65), and inline/fenced reply code uses a denser mono treatment (12px/1.6). Context identifiers also use monospace. Source text is unhighlighted, with a muted line-number gutter.

**The Code Has Its Own Rhythm Rule.** Source, request traces and context identifiers use the mono stack; interface controls and conversation prose use the UI stack.

## Layout

- The desktop work area is one bordered frame: conversation and inspector columns (1.1fr / 1fr), with an internal divider. Above 740px the page is a column as tall as the window: the frame takes the height left under the header, tabs and route intro, however the intro wraps, with a 490px minimum, so only shorter windows scroll.
- Chat history and inspector content scroll independently. The composer sits outside the scrolling chat history at the bottom of the conversation, not fixed to the window.
- Repeated gaps and padding use the recorded spacing steps; this is a loose rhythm, not a universal grid. Button and compact-control padding retain their literal values.
- At widths up to **980px**, outer gutters reduce from 32px to 20px, the subtitle disappears and headings become smaller.
- At widths up to **740px**, main gutters become 12px and the panes stack. The Learn more tray drops its label and keeps three icon-only buttons, whose names stay available to assistive technology; How it works also opens all three dialogs. Conversation height is 70dvh with a 560px minimum; inspector height is 500px. The expansion control disappears and both panes remain present.

## Elevation & Depth

Working panes use surface tones and thin borders, without shadows. Native dialogs (Connect, Payload, Capabilities, Work IQ vs. Graph, Authentication, How to) use `--cp-shadow` with `--cp-overlay`; the exact light/dark shadow values are recorded in the sidecar. The How to arrows are the only lifted controls: a small shadow keeps them legible where they overlap a screenshot. No glass-panel treatment is implemented.

**The Flat Work, Modal Lift Rule.** Working panes are flat and border-separated; dialogs supply the modal shadow and backdrop.

## Shapes

Small rounded corners serve status labels, transport choices and code blocks; field corners serve inputs and feedback; control corners serve buttons, the composer and user-message bodies. The larger frame radius is shared by the workspace and dialog. Ordinary borders are thin (1px).

Protocol tabs round only their upper corners. Inspector tabs and suggested-prompt rows are square-edged and separated by rules rather than individual cards.

## Components

- **Buttons — quiet, solid controls.** Default buttons have a surface fill and neutral border; primary buttons use rose. Standard minimum height is 36px; small text actions use 32px. Hover changes fill and border. Disabled standard/primary buttons use soft-surface fill and muted text; tabs and text actions retain their variant backgrounds. The only authored transition is background (120ms ease-out).
- **Focus — a clear outline.** Keyboard focus uses an accent outline (2px) with a 3px offset, including the textarea when focus-visible. The composer additionally accents its border on focus within. Reduced-motion preference removes transitions and restores automatic scrolling.
- **Fields and composer — bounded editing areas.** Inputs have strong borders, visible labels and separate help text. The textarea is borderless inside the composer and resizes vertically within limits (60–180px). Send is unavailable while disconnected, busy or empty; Enter submits and Shift+Enter adds a line.
- **Navigation — state is explicit.** Protocol tabs use rose text, tint and a bottom rule (2px) when selected. Inspector tabs keep neutral selected text and a rose bottom rule. Both tab lists support arrow/Home/End navigation when not busy. MCP transport choices use pressed state, a soft surrounding tray and a surface-filled selection.
- **Connection status — text plus a cue.** Not connected is muted; Connected adds a green dot; Working uses rose; Needs attention uses a danger border with neutral text. Inline errors and settings feedback use bounded, wrapping text rather than replacing the workspace.
- **Conversation — content before decoration.** Suggested prompts are full-width text rows that fill the composer without sending. User messages have a soft rounded fill; returned replies remain on the conversation surface, with paragraph, code, table and citation treatments. No response imagery is rendered. Before the first message, the empty state pairs a 148px waving-robot scene with its heading, so the suggested prompts stay above the fold.
- **Inspector — source as working material.** The source pane uses actual loaded file text, a file selector, line count and numbered rows. Requests use collapsible traces; explanation content uses the same UI/mono pairing. Expand replaces the desktop split with the inspector; narrow layout restores the conversation.
- **Learn more — one labelled tray.** The header groups Capabilities, Work IQ vs. Graph and Authentication in a bordered tray on the elevated canvas, using the segmented control's radii (control outside, small inside), with a "Learn more" label behind a hairline divider. Transparent buttons pair a 16px rose line icon, drawn in the entity-chip stroke, with a label; hover gives them the surface fill and border. Two 36px square icon buttons follow: ? reopens How to, and the GitHub mark links to the repository in the system browser.
- **Illustrations — scenes beside the facts.** Every scene is a bordered image with the field radius on the canvas color, cropped to its 1344:768 frame; dark mode dims it (brightness 0.86). How it works opens with the route's scene, at most 200px tall. Dialog heroes are at most 260px tall; side-by-side scenes take two fifths of a 3:2 split and stack at 740px.
- **Dialogs — the title and Close stay reachable.** Every dialog's heading row is sticky at the top edge; once content scrolls under it, a hairline border fades in (120ms). Content never shows above the heading.
- **Export PDF — the chapter as a document.** Each Learn more chapter has Export PDF beside Close; a status line under the title names the saved file and offers Open. The export copies the chapter without its controls into a print-only container and prints it on A4, always in the light palette, with each route, figure and table row kept whole and a small footer (chapter, date, page of pages).
- **How to — a guided tour on screenshots, once.** On the first start a 780px dialog shows one step at a time. Five of its six steps are 16:10 screenshots of the app itself with example data, and the hint is in the screenshot: everything but the step's control is dimmed, a rose ring marks the control and a mouse pointer sits on it. Step 2 puts the needs matrix in the same frame. Below it come "Step N of 6" in rose, a 16px title and the step's text. Round 40px arrows sit on the frame's side edges, centred on it, and hide at the first and last step; six dots (the current one a rose pill) and the arrow keys also move between steps, which crossfade (180ms). The dialog opens on its title, so no control shows a rose focus ring that could pass for a hint. The footer says the screenshots show example data. Start or Close stores that it was seen; ? reopens it at step 1. `npm run screenshots` retakes the five screenshots from the running app (a 1280×800 window at 1.5x), with the model and Work IQ replaced by example data in that process only.
- **Authentication dialog — sign-in as flow diagrams.** The admin checklist sits beside its scene. Each route then opens with a 208px scene next to its title and "Admin, once" line, followed by its flow: a panel on the canvas color where each of the four actors is a 40px round node (rose outline, rose line icon from one shared sprite) with its name and role below, joined by a rose rail that ends in an arrowhead before the next node. The recommended setup for a customer's own desktop tool fills its nodes with rose. At 740px, and on the A4 page of an export, the flow runs downward: nodes on the left, text on the right, rails pointing down. Long URLs break only after slashes.
- **Capabilities dialog — a lean matrix.** A scene of open and padlocked drawers leads into a four-column matrix (capability, MCP, A2A, REST). Each cell leads with a bold status word (Yes, Off by default, Not documented, tbd) defined in one lead line, followed by the tool name; one note and one source line close it. Only the matrix scrolls sideways on narrow screens.
- **Work IQ vs. Graph dialog — one example, sourced numbers.** A wider native dialog (960px) holds the drawer-and-index-card scene, a two-column comparison that stacks at 740px, the measurement table beside a scene of the model carrying all of Graph, the "better fit" list beside a bulk-transfer scene, and one primary action that fills the MCP composer. Captions explain each metaphor.
- **What each route needs — one matrix, two places.** A table in a bordered panel on the surface color: a canvas band holds the three needs (Sign-in, Admin once, Model), each after a 28px round node with a rose line icon from the sprite, as in the Authentication flows. Each route has one row, with its name (14px semibold) and a balanced, muted tagline. Each cell leads with a bold word (Local, Remote, Your app registration, Admin consent, Yours, None) and ends with Microsoft Learn links. Where a route needs nothing (the model for A2A and REST), the cell is muted. Links stay on the surface color, never the canvas, for 4.5:1 contrast. In How to the matrix fills the 16:10 frame, inset 28px past the arrows; `overflow: clip` lets the frame grow rather than hide content, and the step text states what every route shares. Connect opens at the top with "What you need": the same table for its route without the route column, only the chosen MCP transport's lines, and the shared line as a footer. At 740px the frame loses its ratio; below 560px of width the matrix scrolls sideways.
- **Connect dialog — the tab's settings, then its live steps.** Each tab's Connect opens one native dialog with What you need, then only the fields that route needs, grouped with thin separators and helper text. When main finds no Work IQ CLI, as in a download, the local MCP fields add a line on how to install it. A sticky footer keeps the message and the primary Connect action in view; after Connect, the same dialog shows the connection steps as a Flow timeline. Test model lists each check with a ✓ or ✗ marker: the marker's success or danger color carries the state, and the text stays neutral.

## Do's and Don'ts

### Do:
- **Do** keep UI and code typography roles separate.
- **Do** retain the effective dark secondary-text override throughout inherited content.
- **Do** retain explicit connection labels and visible keyboard focus.

### Don't:
- **Don't** substitute status color for its text label.
- **Don't** put facts, labels or text inside an illustration, or mix illustration styles; new scenes use the same line art, warm paper, robot and single rose accent. Don't render imagery in chat responses or invent response content.
- **Don't** promote unused palette declarations or isolated identity measurements into reusable tokens.
