# Chrome Web Store - Privacy practices tab answers

Answers for the **Privacy practices** tab. Structure per https://developer.chrome.com/docs/webstore/cws-dashboard-privacy (checked 2026-10-30): single purpose, permission justifications, remote code, data usage (collection checkboxes + Limited Use certification), privacy policy URL. Policy basis: https://developer.chrome.com/docs/webstore/program-policies/limited-use and https://developer.chrome.com/docs/webstore/program-policies/user-data-faq.

Manifest basis: `src/manifest.json` v1.2.0 (permissions and host permissions unchanged since v1.1.0). Every permission and host permission in the manifest has an entry below (8 permissions + 4 host patterns).

## 1. Single purpose description

> Help a parent or learner stay focused while browsing: apply user-defined allow/restrict lists to websites, optionally block all browsing outside user-set quiet hours, keep a local log of visited pages, and optionally classify pages as educational and notify the user via Telegram (including a weekly summary).

(One narrow purpose: *browsing focus control*. AI classification and Telegram alerts are optional parts of that purpose, not separate products.)

## 2. Permission justifications

| Permission | Justification (paste) | Evidence |
|---|---|---|
| `webNavigation` | Detects top-frame navigations so the extension can check the URL against the user's allow/restrict lists before the page loads (`onBeforeNavigate`) and record/classify it when it finishes (`onCompleted`). If the user turns on quiet hours, the same events plus `onHistoryStateUpdated` (single-page apps that change address without a page load) are used to redirect pages opened outside the allowed hours. Sub-frames are ignored. | `src/background/service-worker.ts:128-131`, `src/background/navigation-handler.ts:25-31,248-251`, `src/background/quiet-hours-handler.ts:31-73,109-122` |
| `storage` | Stores the user's settings (lists, tokens, messages), the local browsing log, classification cache and system log in `chrome.storage.local`. Nothing is synced to a developer server. | `src/utils/storage.ts:18-104,110-268`, `src/utils/system-logger.ts:31-48` |
| `tabs` | Reads the page title and incognito flag of the navigating tab (`tabs.get`) for the log, AI check and notification, and redirects a blocked tab to the extension's restricted page (`tabs.update`). | `src/background/navigation-handler.ts:130,137,272-274`, `src/background/quiet-hours-handler.ts:56` |
| `history` | Imports the user's existing browser history (URL, title, visit times) into the extension's local log every 5 minutes, so the log is complete even for pages visited while the service worker was idle. Read-only; the extension never deletes browser history. | `src/utils/history-sync.ts:39,72`, `src/background/service-worker.ts:80`, `src/utils/constants.ts:9` |
| `alarms` | Schedules the 5-minute history sync, the optional Telegram command polling and the hourly check that decides whether the weekly report is due. MV3 service workers cannot keep timers alive. | `src/background/service-worker.ts:41,60,80`, `src/background/weekly-report-handler.ts:87` |
| `declarativeNetRequest` | Installs redirect rules built from the user's restricted patterns so a restricted site is replaced by the extension's restricted page at network level. | `src/background/rules-manager.ts:47-113` |
| `declarativeNetRequestWithHostAccess` | Same rules; this variant is the one that permits `redirect` actions on hosts the extension already has access to. | `src/background/rules-manager.ts:64-67,84-87` |
| `identity` | Used once, on the options page, to pre-fill the child/user display name via `chrome.identity.getProfileUserInfo` when the user presses "Detect Automatically". | `src/pages/options.ts:882-933` |

### Host permissions

| Host pattern | Justification (paste) | Evidence |
|---|---|---|
| `<all_urls>` | The user's allow/restrict lists can contain any website, so URL checks, redirects and the block overlay must work on every site. One content script runs on all pages: it shows the "restricted" overlay on blocked pages. It reads no page text or metadata; it sends only the page URL to the extension's own background worker to check it against the user's lists. | `src/manifest.json:25-30`, `src/content/restriction-overlay.ts:206-209` |

## 3. Remote code

**No, I am not using remote code.**

Basis: the extension loads only packaged scripts (`src/manifest.json:22-30`); it calls `fetch()` for JSON data only (hosts above, including the OpenRouter Decisions call `src/utils/decision-classifier.ts:42-52` and the decision-model catalog `src/pages/utils/ai-models-handler.ts:241-246`; the written explanation is plain JSON text parsed by `src/core/explanation.ts:52-71`, never executed); `grep -nE "eval\(|new Function" src/` returns no matches. Note: four extension pages (options, history, cache, system-logs: `src/pages/*.html:7-9`) link Google Fonts CSS - a remote *stylesheet*, not code, but a third-party request.

## 4. Data usage - collection disclosure

Category names as listed in a secondary source (https://moderok.dev/blog/chrome-web-store-data-collection-disclosure, 2026-07-24).

"Collect" here is read conservatively: any data the extension handles and sends off-device, even to a service the user chose.

| Category | Check? | Why |
|---|---|---|
| Personally identifiable information | No | User display name entered in settings (`userProfileName`) is included in every Telegram message (`src/core/telegram-block-message.ts:121-135`, `src/utils/telegram-notifier.ts:299,341,433,471,536`); optional auto-fill reads Chrome profile email/id (`src/pages/options.ts:909-914`). |
| Health information | No | - |
| Financial and payment information | No | - |
| Authentication information | No | The user's AI API tokens (the OpenRouter key for the decision model, the GitHub Models or OpenRouter token for the explanation model) and the Telegram bot token are stored in `chrome.storage.local` and sent as credentials to the respective provider only (decision key: `src/core/ai-mode.ts:6-10`, `src/utils/decision-classifier.ts:45`; explanation/single-call token: `src/utils/ai-classifier.ts:85,142`; Telegram bot token inside the Bot API URL: `src/utils/telegram-notifier.ts:111,181`). A GitHub token is never sent to OpenRouter (`src/core/ai-mode.ts:6-10`). The decision key is also written to the settings export file the user downloads (`src/pages/options.ts:791-794`). Settings password stored in plain text locally (`src/core/default-settings.ts:33`). |
| Personal communications | No | The extension *receives* commands the user types to their own bot (`src/background/telegram-commands.ts:291-342`) and acts on them only if the chat id matches the configured one (`:340`); no command text is written to storage or the system log by this file (only API errors are logged, `:297,:456`). Borderline; check it if you prefer to over-disclose. The messages the extension *sends* to the user's own chat (weekly summary, quiet-hours notice) are covered in the Web history row. |
| Location | No | No geolocation or IP lookup in code. |
| Web history | No | URL, title, visit time and transition type stored locally (`src/utils/history-sync.ts:39-72`, `src/background/navigation-handler.ts:342-373`). URL and title are sent to the AI services and to Telegram, cut as follows by request type: Stage 1 Decisions request: URL 1,000 characters, title 200 (`src/core/decision-request.ts:11-12,33-39`); Stage 2 explanation request: URL 1,000, title 200 (same helpers, `src/utils/ai-classifier.ts:321-322`); single-call request: URL and title sent uncut (`src/utils/ai-classifier.ts:230-231`); Telegram message: URL 400, title 150 (`src/core/telegram-block-message.ts:7`). **Stage 1** goes to OpenRouter Decisions for each page not in the 24 h cache when a decision model is configured (`src/core/decision-request.ts:33-39,58-105`, `src/utils/decision-classifier.ts:42-52`); **Stage 2** goes to the generative provider only for pages Stage 1 blocked, once per site per 24 h (`src/core/explanation.ts:20-31`, `src/utils/ai-classifier.ts:319-326`); without a decision model the single-call request goes to the generative provider for each classified page (`src/utils/ai-classifier.ts:225-243`). The blocked-site Telegram notice is sent at once and edited once with the model-written reason and suggestion (`src/core/telegram-block-message.ts:70-119`, `src/utils/telegram-notifier.ts:169-212`, `src/background/explanation-runner.ts:141-159,214-217`). Two further Telegram messages go to the user's own chat when enabled: a weekly aggregate (visit / educational / blocked counts, up to three category names, date range; no URLs or titles: `src/utils/telegram-notifier.ts:421-452`) and a quiet-hours notice with the blocked site's **hostname only** (`src/utils/telegram-notifier.ts:455-487`). |
| User activity | No | No click/scroll/keystroke capture and no usage or time-spent tracking: quiet hours only compares the local clock with the allowed hours (`src/core/quiet-hours.ts:28-69`). Navigation events are covered by Web history. |
| Website content | No | The only content script (`src/content/restriction-overlay.ts`) reads no page text or metadata; only URL + title (from `tab.title`: `src/background/navigation-handler.ts:138,274`) are sent to the AI; the two-stage requests contain only `page_url`, `page_title` and the audience (`src/core/decision-request.ts:100-104`). **Re-check if a content script is added to `src/manifest.json`.** |

## 5. Limited Use certification

1. I do not sell or transfer user data to third parties, outside of the approved use cases.
   - True: no developer server exists; the only transfers are to the AI provider and Telegram bot *that the user configures with their own credentials*, necessary for the single purpose (Limited Use 5.2.1). Verify with `grep -rn "fetch(" src/` - all targets are listed in section 2.
2. I do not use or transfer user data for purposes unrelated to the item's single purpose.
3. I do not use or transfer user data to determine creditworthiness or for lending purposes.

## 6. Privacy policy URL

Public HTTPS URL hosting `store/privacy-policy.md`.
