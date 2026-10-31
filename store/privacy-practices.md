# Chrome Web Store - Privacy practices tab answers

Answers for the **Privacy practices** tab. Structure per https://developer.chrome.com/docs/webstore/cws-dashboard-privacy (checked 2026-10-30): single purpose, permission justifications, remote code, data usage (collection checkboxes + Limited Use certification), privacy policy URL. Policy basis: https://developer.chrome.com/docs/webstore/program-policies/limited-use and https://developer.chrome.com/docs/webstore/program-policies/user-data-faq.

Manifest basis: `src/manifest.json` v1.0.54. Every permission and host permission in the manifest has an entry below (8 permissions + 4 host patterns).

## 1. Single purpose description

> Help a parent or learner stay focused while browsing: apply user-defined allow/restrict lists to websites, keep a local log of visited pages, and optionally classify pages as educational and notify the user via Telegram.

(One narrow purpose: *browsing focus control*. AI classification and Telegram alerts are optional parts of that purpose, not separate products.)

## 2. Permission justifications

| Permission | Justification (paste) | Evidence |
|---|---|---|
| `webNavigation` | Detects top-frame navigations so the extension can check the URL against the user's allow/restrict lists before the page loads (`onBeforeNavigate`) and record/classify it when it finishes (`onCompleted`). Sub-frames are ignored. | `src/background/service-worker.ts:86-87`, `src/background/navigation-handler.ts:17-23,174-180` |
| `storage` | Stores the user's settings (lists, tokens, messages), the local browsing log, classification cache and system log in `chrome.storage.local`. Nothing is synced to a developer server. | `src/utils/storage.ts:16-101`, `src/utils/system-logger.ts:31-48` |
| `tabs` | Reads the page title and incognito flag of the navigating tab (`tabs.get`) for the log, AI check and notification, and redirects a blocked tab to the extension's restricted page (`tabs.update`). | `src/background/navigation-handler.ts:196-198,92` |
| `history` | Imports the user's existing browser history (URL, title, visit times) into the extension's local log every 5 minutes, so the log is complete even for pages visited while the service worker was idle. Read-only; the extension never deletes browser history. | `src/utils/history-sync.ts:39,72`, `src/background/service-worker.ts:53`, `src/utils/constants.ts:9` |
| `alarms` | Schedules the 5-minute history sync and the optional Telegram command polling. MV3 service workers cannot keep timers alive. | `src/background/service-worker.ts:36,53,67-70` |
| `declarativeNetRequest` | Installs redirect rules built from the user's restricted patterns so a restricted site is replaced by the extension's restricted page at network level. | `src/background/rules-manager.ts:47-113` |
| `declarativeNetRequestWithHostAccess` | Same rules; this variant is the one that permits `redirect` actions on hosts the extension already has access to. | `src/background/rules-manager.ts:64-67,84-87` |
| `identity` | Used once, on the options page, to pre-fill the child/user display name via `chrome.identity.getProfileUserInfo` when the user presses "Detect Automatically". | `src/pages/options.ts:853-875` |

### Host permissions

| Host pattern | Justification (paste) | Evidence |
|---|---|---|
| `<all_urls>` | The user's allow/restrict lists can contain any website, so URL checks, redirects and the block overlay must work on every site. One content script runs on all pages: it shows the "restricted" overlay on blocked pages. It reads no page text or metadata; it sends only the page URL to the extension's own background worker to check it against the user's lists. | `src/manifest.json:25-30`, `src/content/restriction-overlay.ts:206-209` |

## 3. Remote code

**No, I am not using remote code.**

Basis: the extension loads only packaged scripts (`src/manifest.json:22-30`); it calls `fetch()` for JSON data only (hosts above); `grep -nE "eval\(|new Function" src/` returns no matches. Note: four extension pages (options, history, cache, system-logs: `src/pages/*.html:7-9`) link Google Fonts CSS - a remote *stylesheet*, not code, but a third-party request.

## 4. Data usage - collection disclosure

Category names as listed in a secondary source (https://moderok.dev/blog/chrome-web-store-data-collection-disclosure, 2026-07-24).

"Collect" here is read conservatively: any data the extension handles and sends off-device, even to a service the user chose.

| Category | Check? | Why |
|---|---|---|
| Personally identifiable information | No | User display name entered in settings (`userProfileName`) is included in every Telegram message (`src/utils/telegram-notifier.ts:315,332,345`); optional auto-fill reads Chrome profile email/id (`src/pages/options.ts:866-872`). |
| Health information | No | - |
| Financial and payment information | No | - |
| Authentication information | No | The user's AI API token and Telegram bot token are stored in `chrome.storage.local` and sent as credentials to the respective provider (`src/utils/ai-classifier.ts:75,131`; `src/utils/telegram-notifier.ts:172`). Settings password stored in plain text locally (`src/core/default-settings.ts:34`). |
| Personal communications | No | The extension *receives* commands the user types to their own bot (`src/background/telegram-commands.ts:291-342`) and acts on them only if the chat id matches the configured one (`:340`); no command text is written to storage or the system log by this file (only API errors are logged, `:297,:456`). Borderline; check it if you prefer to over-disclose. |
| Location | No | No geolocation or IP lookup in code. |
| Web history | No | URL, title, visit time and transition type stored locally (`src/utils/history-sync.ts:39-72`, `src/background/navigation-handler.ts:287-296`); URL and title sent to the AI provider and to Telegram. |
| User activity | No | No click/scroll/keystroke capture. Navigation events are covered by Web history. |
| Website content | No | The only content script (`src/content/restriction-overlay.ts`) reads no page text or metadata; only URL + title (from `tab.title`: `src/background/navigation-handler.ts:198,229`) are sent to the AI. **Re-check if a content script is added to `src/manifest.json`.** |

## 5. Limited Use certification

1. I do not sell or transfer user data to third parties, outside of the approved use cases.
   - True: no developer server exists; the only transfers are to the AI provider and Telegram bot *that the user configures with their own credentials*, necessary for the single purpose (Limited Use 5.2.1). Verify with `grep -rn "fetch(" src/` - all targets are listed in section 2.
2. I do not use or transfer user data for purposes unrelated to the item's single purpose.
3. I do not use or transfer user data to determine creditworthiness or for lending purposes.

## 6. Privacy policy URL

Public HTTPS URL hosting `store/privacy-policy.md`.
