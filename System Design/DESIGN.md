# AI Workflow Platform — Chat UI Design System
> Chat-first AI orchestration interface. Clean white gallery aesthetic meets Space Grotesk geometric precision. Apple-derived foundational tokens adapted for interactive chat, plan preview cards, and live execution monitoring.

**Theme:** light (dark mode tokens included)

Source tokens are adapted from Apple's gallery aesthetic. Component catalog is purpose-built for a conversational AI workflow platform with 7 message types, human-in-the-loop plan approval, and live execution monitoring.

---

## Tokens — Colors

### Core Palette (Apple Gallery Foundation)

| Name | Value | Token | Role |
|------|-------|-------|------|
| Gallery White | `#ffffff` | `--color-gallery-white` | Primary chat canvas, message bubbles, card surfaces, modals |
| Studio Mist | `#f5f5f7` | `--color-studio-mist` | Sidebar background, secondary panels, code block backgrounds, alternating rows |
| Paper Frost | `#fafafc` | `--color-paper-frost` | Hover states on sidebar items, subtle surface elevation, dropdown menus |
| Hairline Silver | `#d6d6d6` | `--color-hairline-silver` | 1px dividers, card borders, input outlines at rest |
| Control Gray | `#e6e6e8` | `--color-control-gray` | Disabled buttons, muted surfaces, skeleton loading placeholders |
| Ink | `#1d1d1f` | `--color-ink` | Headlines, primary body text, navigation labels, icons |
| Slate | `#707070` | `--color-slate` | Secondary copy, timestamps, metadata, placeholder text |
| Steel | `#86868b` | `--color-steel` | Input outlines on focus ring outer, inactive tab labels |
| Apple Blue | `#0066cc` | `--color-apple-blue` | Text links, interactive labels, "Sửa qua Chat" text buttons |
| Pricing Blue | `#0071e3` | `--color-pricing-blue` | Primary CTA pills: [Duyệt kế hoạch], [Gửi], [Kết nối], send button |

### Semantic Status Colors (Chat Application)

| Name | Value | Token | Role |
|------|-------|-------|------|
| Success Green | `#34c759` | `--color-success` | Step succeeded ✅, connection verified, message sent confirmed |
| Warning Amber | `#ff9500` | `--color-warning` | Clarification needed ⚠️, approaching rate limit, token expiring |
| Error Red | `#ff3b30` | `--color-error` | Step failed ❌, connection error, message send failed |
| Unknown Purple | `#af52de` | `--color-unknown` | UNKNOWN state ❓ (network timeout on write — requires human check) |
| Running Blue | `#007aff` | `--color-running` | Step in progress ⏳ with pulse animation |
| Info Teal | `#5ac8fa` | `--color-info` | Gather progress, informational banners, tool badges |

### User Message Surface

| Name | Value | Token | Role |
|------|-------|-------|------|
| User Bubble | `#e9e9eb` | `--color-user-bubble` | User message background (light gray, Apple iMessage style) |
| User Bubble Dark | `#0071e3` | `--color-user-bubble-dark` | User message background in dark mode (blue) |

### Dark Mode Mapping

| Light Token | Light Value | Dark Value | Dark Token |
|---|---|---|---|
| Gallery White | `#ffffff` | `#1c1c1e` | `--color-dark-surface` |
| Studio Mist | `#f5f5f7` | `#2c2c2e` | `--color-dark-surface-secondary` |
| Paper Frost | `#fafafc` | `#3a3a3c` | `--color-dark-surface-tertiary` |
| Hairline Silver | `#d6d6d6` | `#48484a` | `--color-dark-border` |
| Control Gray | `#e6e6e8` | `#636366` | `--color-dark-disabled` |
| Ink | `#1d1d1f` | `#f5f5f7` | `--color-dark-text` |
| Slate | `#707070` | `#aeaeb2` | `--color-dark-text-secondary` |
| User Bubble | `#e9e9eb` | `#0071e3` | `--color-dark-user-bubble` |

---

## Tokens — Typography

### Space Grotesk — Headlines, product name, section titles, feature labels, navigation, and UI controls. The geometric letterforms with distinctive angular curves create a modern AI-tech identity without sacrificing readability. · `--font-space-grotesk`
- **Source:** Google Fonts (free, open-source)
- **Weights:** 300, 400, 500, 600, 700
- **Sizes:** 12px, 13px, 14px, 16px, 18px, 20px, 24px, 28px, 32px, 40px, 48px
- **Line height:** 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
- **Letter spacing:** -0.02em at 40px+; -0.01em at 24-32px; normal at 14-20px; +0.02em at 12-13px
- **Role:** All UI text — headlines, body, labels, navigation, controls, chat messages

### JetBrains Mono — Code blocks, tool names, parameter values, JSON previews, and monospace data in plan steps. · `--font-jetbrains-mono`
- **Source:** Google Fonts (free, open-source)
- **Weights:** 400, 500, 600
- **Sizes:** 12px, 13px, 14px
- **Role:** Code rendering in chat markdown, tool call display in plan steps, JSON data

### Type Scale

| Role | Weight | Size | Line Height | Letter Spacing | Token |
|------|--------|------|-------------|----------------|-------|
| page-title | 700 | 28px | 1.2 | -0.02em | `--text-page-title` |
| section-heading | 600 | 20px | 1.3 | -0.01em | `--text-section-heading` |
| card-title | 600 | 16px | 1.3 | normal | `--text-card-title` |
| body | 400 | 15px | 1.6 | normal | `--text-body` |
| body-small | 400 | 13px | 1.5 | normal | `--text-body-small` |
| label | 500 | 13px | 1.2 | +0.02em | `--text-label` |
| label-small | 500 | 11px | 1.2 | +0.03em | `--text-label-small` |
| nav-item | 500 | 14px | 1.0 | normal | `--text-nav-item` |
| chat-message | 400 | 15px | 1.6 | normal | `--text-chat-message` |
| chat-input | 400 | 15px | 1.5 | normal | `--text-chat-input` |
| code | 400 | 13px | 1.5 | normal | `--text-code` |
| timestamp | 400 | 12px | 1.0 | +0.02em | `--text-timestamp` |
| tool-badge | 500 | 12px | 1.0 | +0.02em | `--text-tool-badge` |
| pill-button | 500 | 14px | 1.0 | normal | `--text-pill-button` |

---

## Tokens — Spacing & Shapes

**Base unit:** 4px

**Density:** comfortable

### Spacing Scale

| Name | Value | Token |
|------|-------|-------|
| 2 | 2px | `--spacing-2` |
| 4 | 4px | `--spacing-4` |
| 6 | 6px | `--spacing-6` |
| 8 | 8px | `--spacing-8` |
| 12 | 12px | `--spacing-12` |
| 16 | 16px | `--spacing-16` |
| 20 | 20px | `--spacing-20` |
| 24 | 24px | `--spacing-24` |
| 32 | 32px | `--spacing-32` |
| 40 | 40px | `--spacing-40` |
| 48 | 48px | `--spacing-48` |
| 64 | 64px | `--spacing-64` |
| 80 | 80px | `--spacing-80` |

### Border Radius

| Element | Value | Token |
|---------|-------|-------|
| message-bubble | 20px | `--radius-message` |
| cards | 16px | `--radius-card` |
| modals | 20px | `--radius-modal` |
| pills / CTA buttons | 9999px | `--radius-pill` |
| inputs | 12px | `--radius-input` |
| chips / badges | 8px | `--radius-chip` |
| sidebar-item | 10px | `--radius-sidebar-item` |
| code-block | 8px | `--radius-code` |
| avatar | 9999px | `--radius-avatar` |

### Shadows

| Name | Value | Token |
|------|-------|-------|
| subtle | `0 0 0 1px rgba(0,0,0,0.06)` | `--shadow-subtle` |
| card | `0 1px 3px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04)` | `--shadow-card` |
| elevated | `0 4px 12px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)` | `--shadow-elevated` |
| modal | `0 8px 32px rgba(0,0,0,0.18)` | `--shadow-modal` |

### Layout Constants

| Name | Value | Token |
|------|-------|-------|
| Sidebar width | 280px | `--layout-sidebar-width` |
| Chat max-width | 768px | `--layout-chat-max-width` |
| Top bar height | 56px | `--layout-topbar-height` |
| Input bar height (min) | 56px | `--layout-input-min-height` |
| Message gap | 16px | `--layout-message-gap` |
| Card padding | 20px | `--layout-card-padding` |
| Mobile breakpoint | 768px | `--breakpoint-mobile` |
| Tablet breakpoint | 1024px | `--breakpoint-tablet` |

---

## Components

### Top Navigation Bar
**Role:** App-level persistent header

A 56px-tall Gallery White bar with 1px Hairline Silver bottom border. Left: app icon + "AI Workflow Platform" in Space Grotesk 16px/600 Ink. Right: Settings gear icon (Slate), "+ Cuộc hội thoại mới" Pricing Blue pill button with white text 14px/500. On mobile, replace app name text with icon only; add hamburger menu icon on the far left to toggle sidebar.

### Conversation Sidebar
**Role:** Conversation history navigation

280px-wide Studio Mist panel with 1px Hairline Silver right border. Top: search input with 12px radius, Steel outline, Slate placeholder "Tìm cuộc hội thoại...". Below: conversation items grouped by date headers ("Hôm nay", "Hôm qua", "Tuần trước") in Space Grotesk 12px/500 Slate with uppercase tracking +0.05em. Each item: 10px radius, 12px padding, truncated title in 14px/500 Ink, last message preview in 13px/400 Slate, timestamp in 12px/400 Slate right-aligned. Active item: Paper Frost background with Pricing Blue 2px left border accent. Hover: Paper Frost background. Bottom: user profile row with 32px avatar circle, name 14px/500 Ink, "Đăng xuất" text link in Apple Blue 13px/400. On mobile (< 768px): sidebar slides in from left as overlay with backdrop blur, toggled by hamburger icon.

### User Message Bubble
**Role:** User-sent chat message

Right-aligned bubble with User Bubble `#e9e9eb` background, 20px radius (top-right: 6px for tail effect), max-width 75% of chat area. Text: Space Grotesk 15px/400 Ink, line-height 1.6. Bottom-right: timestamp in 12px/400 Slate. Optimistic state: reduced opacity 0.6 with ⏳ icon. Failed state: Error Red 1px outline with ❌ icon and "Gửi lại" Apple Blue text link below.

### Assistant Message Bubble
**Role:** AI assistant response

Left-aligned, no background (transparent on Gallery White canvas), max-width 85% of chat area. Content: rendered Markdown with Space Grotesk 15px/400 Ink line-height 1.6. Code blocks: JetBrains Mono 13px/400 on Studio Mist background with 8px radius. Inline code: JetBrains Mono 13px on Paper Frost with 4px radius. Links: Apple Blue with no underline, underline on hover. Streaming state: blinking cursor `|` at end of text with 500ms blink animation.

### Typing Indicator
**Role:** AI is processing

Left-aligned, transparent background. Three dots (● ● ●) in Slate 8px circles with sequential pulse animation (opacity 0.3 → 1.0, 400ms delay between each dot). Appears below last message during processing, replaced by actual response when streaming begins.

### Gather Progress Card
**Role:** Shows real-time tool discovery/search activity

Left-aligned collapsible card with Gallery White surface, 16px radius, shadow-card. Header: "🔍 Đang khảo sát..." in Space Grotesk 14px/500 Ink with chevron toggle icon. Collapsed: single line summary "Tìm thấy 3 boards, 5 members". Expanded: vertical list of search steps, each showing tool badge (Info Teal background, white 12px/500 tool name like `search_boards`) followed by result count in 13px/400 Slate. Active search step: Running Blue dot with pulse animation. Completed step: Success Green checkmark.

### Clarification Card
**Role:** AI asks user to choose or clarify

Left-aligned card with Gallery White surface, 16px radius, shadow-card, Pricing Blue 2px left border accent. Question: Space Grotesk 15px/500 Ink. Options (if provided): horizontal wrap of pill chips — each chip has Paper Frost background, 8px radius, 14px/400 Ink text, hover: Studio Mist background with Pricing Blue text. Selected chip: Pricing Blue background with white text. Open-ended: if no predefined options, show compact text input below the question. "Bỏ qua" ghost text button in Slate 13px/400 right-aligned.

### Plan Preview Card
**Role:** Human-in-the-loop plan approval — the most complex interactive card

Full-width card with Gallery White surface, 16px radius, shadow-elevated. Structure:

1. **Header bar:** "📋 Kế hoạch thực thi" in 16px/600 Ink, right-side count badge "3 bước" in 12px/500 on Paper Frost with 8px radius.

2. **Thinking Accordion (Chain-of-Thought):** Collapsible section with chevron. Label "💭 Suy luận của AI" in 13px/500 Slate. Expanded: Studio Mist background, 8px radius inset, italic Space Grotesk 13px/400 Slate text showing AI reasoning. Default: collapsed.

3. **Step List:** Vertical sequence of plan steps, each step:
   - Left: step number circle (24px, Pricing Blue background, white 12px/700 number)
   - Center-top: tool badge pill (Info Teal background, white JetBrains Mono 12px/500 tool name like `trello.create_card`)
   - Center: step description in 14px/400 Ink
   - Resolved inputs: key-value pairs in 13px/400 Slate, values in JetBrains Mono
   - Cross-step references: `$step_1.output.id` rendered as Apple Blue monospace chips
   - Connector: vertical 2px Hairline Silver line between steps

4. **Warning banner (if present):** Warning Amber left border, Paper Frost background, "⚠️" icon with warning text in 13px/400 Ink.

5. **Action Bar:** Horizontal layout with 16px gap, right-aligned:
   - **[Duyệt kế hoạch]**: Pricing Blue fill, white 14px/500 text, 9999px radius, min-width 140px
   - **[Sửa qua Chat]**: transparent fill, Apple Blue 14px/500 text, 1px Steel outline, 9999px radius
   - **[Hủy]**: transparent fill, Error Red 14px/500 text, no outline, 9999px radius

### Execution Progress Card
**Role:** Live step-by-step execution monitoring

Full-width card with Gallery White surface, 16px radius, shadow-card. Header: "⚡ Đang thực thi..." in 16px/600 Ink with animated Running Blue dot. Step list:

Each step row: 48px height, horizontal layout:
- **Status icon** (24px): ✅ Success Green filled circle | ⏳ Running Blue circle with spin animation | ⏸ Warning Amber pause icon | ❌ Error Red X | ❓ Unknown Purple question mark
- **Tool badge**: same as Plan Preview
- **Description**: 14px/400 Ink
- **Duration**: 12px/400 Slate right-aligned (e.g., "1.2s")
- **Connector**: vertical 2px line colored by state (Success Green for completed, Hairline Silver for pending)

Active step: subtle Running Blue background glow (rgba(0,122,255,0.06) background).

### Partial Failure Recovery Card
**Role:** Error handling with 4 recovery actions

Inline card replacing the failed step's row, 16px radius, Error Red 2px left border, Gallery White surface, shadow-elevated. Content:
- Error icon ❌ + "Bước X thất bại" in 14px/600 Error Red
- Tool badge + error message in 13px/400 Ink on Studio Mist 8px radius inset
- Action buttons (horizontal, 12px gap):
  - **[🔄 Thử lại]**: Pricing Blue pill
  - **[✏️ Sửa & tiếp tục]**: Apple Blue outlined pill
  - **[⏭ Bỏ qua]**: Slate outlined pill
  - **[⏹ Dừng lại]**: Error Red ghost text button

### Chat Input Bar
**Role:** Message composition

Fixed to bottom of chat area. Gallery White surface with 1px Hairline Silver top border. Inner container: max-width matches chat area (768px), centered. Input: auto-expanding textarea (min 1 line, max 6 lines) with 12px radius, Studio Mist background, 15px/400 Ink text, Slate placeholder "Mô tả công việc bạn muốn thực hiện...". Right side: circular 40px Pricing Blue send button with white arrow icon, disabled (Control Gray) when input is empty. Keyboard: Enter sends, Shift+Enter new line.

### Login Card
**Role:** Operator authentication

Centered vertically and horizontally on Studio Mist full page. Gallery White card, 20px radius, shadow-modal, max-width 400px, 40px padding. Top: app icon + "AI Workflow Platform" in 20px/600 Ink centered. Fields: "Email" and "Mật khẩu" labels in 13px/500 Slate above inputs (12px radius, Studio Mist background, full width). Submit: full-width Pricing Blue pill "Đăng nhập" 14px/500 white. Below: "Demo: admin@wap.local / password123" in 12px/400 Slate with one-click auto-fill functionality.

### Empty State (First Conversation)
**Role:** Onboarding and prompt suggestion

Centered in chat area when no messages exist. Top: large app icon (64px) + "Bạn muốn làm gì hôm nay?" in 24px/600 Ink centered. Below: horizontal wrap of suggestion chips — each chip is Paper Frost background, 9999px radius, 14px/400 Ink, hover: Pricing Blue outline. Chips are dynamically generated based on connected services:
- Trello only: "Tạo task mới trên Trello", "Xem danh sách board"
- Trello + Slack: "Tạo task và thông báo Slack", "Gán task cho thành viên & notify"
- No services: "Kết nối dịch vụ đầu tiên →" (links to Settings)

### Service Connection Card
**Role:** Configure external service credentials and access scope

Gallery White card, 16px radius, shadow-card. Header row: service icon (32px) + service name in 16px/600 Ink + status pill (Success Green "Đã kết nối" or Control Gray "Chưa kết nối"). Body:
- Credential fields: API Key / Token inputs (12px radius, type=password, with show/hide toggle)
- **Allowed Scope** section: "Phạm vi cho phép" label in 13px/500 Slate. Multi-select chips for boards/channels — each chip: 8px radius, Studio Mist background, with ✕ remove icon. Add button: "+ Thêm board" Apple Blue text.
- **[Kiểm tra kết nối]**: outlined pill, Apple Blue. Loading state: spinner replacing text. Success: Success Green check + "Kết nối thành công". Failure: Error Red ✕ + error message.
- **[Lưu]**: Pricing Blue fill pill.

### Toast Notification
**Role:** Ephemeral feedback

Fixed bottom-center, max-width 400px, Gallery White surface, 12px radius, shadow-elevated, Ink 14px/400 text with left icon (✅ or ❌ or ⚠️ colored appropriately). Auto-dismiss after 4 seconds with fade-out transition. Slide-up entrance from bottom.

### Status Badge
**Role:** Service connection status indicator

Inline pill: 8px radius, 12px/500 text. Connected: Success Green background at 10% opacity, Success Green text. Disconnected: Control Gray background, Slate text. Error: Error Red background at 10% opacity, Error Red text.

---

## Do's and Don'ts

### Do
- Use Gallery White `#ffffff` as the primary chat canvas. Reserve Studio Mist `#f5f5f7` for sidebar, code blocks, and secondary surfaces.
- Use Space Grotesk for all text. Reserve JetBrains Mono for code and technical data only.
- Use 16px radius for cards and 9999px for pill buttons. Keep these values consistent.
- Use Pricing Blue `#0071e3` only for primary CTA actions (Duyệt, Gửi, Kết nối). Do not use it for informational elements.
- Use semantic colors consistently: Success Green only for succeeded/verified, Error Red only for failed/error, Warning Amber only for attention-needed, Unknown Purple only for UNKNOWN write states.
- Space messages with 16px gap. Use 20px padding inside cards.
- Keep shadows minimal — prefer 1px borders (shadow-subtle) for most elements. Use shadow-elevated only for Plan Preview Card and modals.

### Don't
- Do not add gradients to any surfaces or buttons.
- Do not use more than 2 shadow levels in a single view.
- Do not show raw error messages or stack traces to users. Wrap errors in friendly Vietnamese text.
- Do not auto-retry UNKNOWN state writes — always show recovery UI and let the user decide.
- Do not use color alone to convey status — always pair with icon + text label.
- Do not place dense data tables in the chat flow. Use collapsible cards instead.
- Do not break the 768px max-width for chat messages. Wider content (tables, large plans) should scroll horizontally inside cards.

---

## Surfaces

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 0 | Gallery White | `#ffffff` | Chat canvas, message bubbles, cards, modals, input backgrounds |
| 1 | Studio Mist | `#f5f5f7` | Sidebar, code blocks, thinking accordion, secondary surfaces |
| 2 | Paper Frost | `#fafafc` | Hover states, dropdown menus, chip backgrounds |
| 3 | Control Gray | `#e6e6e8` | Disabled states, skeleton placeholders |

---

## Elevation

Cards gain separation through shadow-subtle (1px outline) for standard cards and shadow-card for interactive cards (Plan Preview, Execution Progress). Modals use shadow-modal with backdrop overlay (rgba(0,0,0,0.4)). The sidebar uses only a 1px Hairline Silver right border with no shadow.

---

## Responsive Behavior

| Breakpoint | Layout |
|---|---|
| Desktop (≥ 1024px) | Sidebar 280px + Chat area side-by-side |
| Tablet (768px – 1023px) | Sidebar 240px collapsed to icons, expand on hover/click |
| Mobile (< 768px) | Sidebar hidden, hamburger toggle, Chat full-width, Input bar fixed bottom |

Mobile-specific adaptations:
- Plan Preview Card: steps stack vertically, action buttons stack vertically
- Execution Progress: horizontal step indicator with scroll
- Service Connection Cards: full-width, stacked vertically
- Settings: full-page instead of modal

---

## Animation & Motion

| Interaction | Duration | Easing | Notes |
|---|---|---|---|
| Message appear | 200ms | ease-out | Slide up 8px + fade in |
| Card expand/collapse | 250ms | ease-in-out | Height transition with content fade |
| Button hover | 150ms | ease | Background color transition |
| Sidebar slide (mobile) | 300ms | cubic-bezier(0.4, 0, 0.2, 1) | Slide from left with backdrop fade |
| Toast enter | 300ms | ease-out | Slide up from bottom |
| Toast exit | 200ms | ease-in | Fade out |
| Typing indicator dots | 400ms | ease-in-out | Sequential opacity pulse, 200ms stagger |
| Execution step pulse | 1500ms | ease-in-out | Running Blue glow pulse, infinite |
| Streaming cursor blink | 500ms | step-end | Opacity 0 ↔ 1 |
| `prefers-reduced-motion` | — | — | Disable all animations except opacity transitions |

---

## Agent Prompt Guide

Quick Color Reference:
- Gallery White: #ffffff — Chat canvas, cards, message surfaces
- Studio Mist: #f5f5f7 — Sidebar, code blocks, secondary panels
- Paper Frost: #fafafc — Hover states, chip backgrounds
- Hairline Silver: #d6d6d6 — Borders, dividers
- Ink: #1d1d1f — Primary text, headlines
- Slate: #707070 — Secondary text, timestamps
- Pricing Blue: #0071e3 — Primary buttons (Duyệt, Gửi)
- Apple Blue: #0066cc — Text links, secondary actions
- Success Green: #34c759 — Succeeded, connected
- Warning Amber: #ff9500 — Needs attention, clarification
- Error Red: #ff3b30 — Failed, disconnected
- Unknown Purple: #af52de — UNKNOWN write state
- Running Blue: #007aff — In-progress with pulse

Create a full-width top bar with left app title "AI Workflow Platform" in Space Grotesk 16px/600 Ink, right "+ Cuộc hội thoại mới" Pricing Blue pill with white 14px/500 text and gear icon in Slate; use Gallery White background and 1px #d6d6d6 bottom border.
Create a 280px sidebar on Studio Mist with date-grouped conversation items using 10px radius hover, active item with Paper Frost fill and 2px Pricing Blue left border.
Create an assistant message with rendered Markdown body text in Space Grotesk 15px/400 Ink with JetBrains Mono code blocks on Studio Mist 8px radius.
Create a Plan Preview Card with collapsible thinking accordion on Studio Mist, numbered step list with Info Teal tool badges, cross-step references in Apple Blue monospace, and bottom action bar: Pricing Blue [Duyệt kế hoạch] pill, Apple Blue outlined [Sửa qua Chat] pill, Error Red ghost [Hủy].
Create an Execution Progress Card with vertical step list — each step has a 24px status icon (Success Green ✅, Running Blue ⏳ spin, Error Red ❌), tool badge, description, and duration timestamp.
Create a Partial Failure Recovery Card with Error Red left border, error message inset on Studio Mist, and 4 action buttons: Pricing Blue [🔄 Thử lại], Apple Blue [✏️ Sửa], Slate [⏭ Bỏ qua], Error Red [⏹ Dừng].

## Similar Products
- **Claude.ai** — Clean white chat canvas with geometric Space Grotesk-style type, minimal chrome, and functional code rendering.
- **ChatGPT** — Sidebar conversation history, streaming text, and interactive tool-use cards in a two-panel layout.
- **Linear** — Minimalist SaaS with Status badges, keyboard shortcuts, and Apple-inspired spacing precision.
- **Vercel Dashboard** — Space Grotesk typography, clean surfaces, status indicators, and dev-tool integration UI.
