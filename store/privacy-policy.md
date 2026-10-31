# Privacy Policy - Focus Saving Assistant

**Effective date:** 01.09.2026

Focus Saving Assistant ("the extension") is a Chrome extension that helps a parent or learner stay focused while browsing. This policy explains what data the extension handles, where it goes, and how you can delete it.

> **Hosting note for the publisher (delete before publishing):** every statement below is tied to code in the repository; the file/line evidence is in the "Evidence" section at the end, which can stay or be removed. Replace the bracketed placeholders. Do not add claims about encryption or hashing of the settings password - it is stored in plain text (see Security).

## In short

- The developer does **not** run any server for this extension and **does not receive** your data.
- Your browsing log, settings, tokens and logs are stored **locally in your browser**.
- If you turn on **AI classification**, the address (URL) and title of pages you visit are sent to the AI provider **you selected**, using **your own** API token.
- If you turn on **Telegram notifications**, messages containing page URLs and titles are sent to Telegram, through **your own** bot, to **your own** chat.
- We do not sell your data, show ads, or use analytics or tracking.

## What data the extension handles

| Data | Where it is kept | Why |
|---|---|---|
| Browsing log: page URL, page title, visit times, how the page was reached, whether it was blocked and why, the AI result for it, and whether it was visited in an incognito window | Locally, in `chrome.storage.local` | To show you a history of what was visited and what was blocked |
| Imported Chrome history (URL, title, visit times) | Merged into the same local log, every 5 minutes | So the log is complete |
| Your settings: allow / restrict / ignore URL patterns, restricted-page message, categories and safety levels you chose to restrict, display name, notification options, AI provider and model, AI prompt | Locally | To make the extension work the way you configured it |
| Your AI API token (GitHub Models or OpenRouter) and your Telegram bot token and chat id | Locally, in plain text inside your settings | To call the services you chose |
| Optional settings password and its hint | Locally, in plain text inside your settings | To lock the settings, history, cache and log pages (see Security) |
| AI classification cache (result per website, kept 24 hours) | Locally | To avoid asking the AI provider twice for the same site |
| System log (up to 100 entries, can be switched off) | Locally | Troubleshooting; entries can include URLs and parts of AI responses |

The extension also reads the title, description, keywords and Open Graph tags of each page you visit, and passes them to its own background process. That information is currently not stored and not sent anywhere.

## What is sent off your device, and to whom

Data leaves your device **only** to the services below, **only** when you have configured them, and always over HTTPS.

1. **AI provider you choose - GitHub Models (`models.github.ai`) or OpenRouter (`openrouter.ai`).**
   When AI classification is on and an API token is entered, each page you visit (that is not on your ignore list and not already in the 24-hour cache) causes a request containing: the page's **full URL** (including any query string), the page **title**, your classification prompt, the lists of categories and safety levels, and the model name. Your own API token is sent in the `Authorization` header. With OpenRouter, the extension's own address and the name "Focus Saving Assistant" are also sent as request headers. The provider's reply (category, safety level, whether the page is educational, a reason) is stored locally. The extension also asks the provider for its list of available models.
   The provider handles this data under **its own** terms and privacy policy.

2. **Telegram (`api.telegram.org`), through your own bot.**
   When Telegram notifications are on and you entered a bot token and chat id, the extension sends messages to your chat. Depending on your notification options these messages contain: the display name you set, the page **title and URL**, whether access was allowed or blocked and why (including the matching pattern), the AI classification details if available, and a timestamp. If you choose hourly or daily notification frequency, such notifications are queued locally (title, URL, classification) until sent. If you also enable Telegram commands, the extension periodically asks Telegram for new messages sent to your bot and acts only on commands from the chat id you configured (for example to add a site to the allow list).
   Telegram handles this data under **its own** terms and privacy policy.

3. **Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`).**
   The extension's settings, history, cache and log pages load a web font from Google when you open them. Google receives the usual technical information of a web request (such as your IP address). No browsing data is included.

The developer receives none of the above. There is no developer-operated backend, no analytics and no advertising in the extension.

## What we do not do

- We do not sell your data or transfer it to data brokers, advertisers or other third parties.
- We do not use your data for personalised advertising, credit or lending decisions, or any purpose unrelated to the extension's single purpose (helping you stay focused while browsing).
- No person at the developer reads your data, because it never reaches the developer.

## Incognito windows

The extension is configured to run separately in incognito windows (`"incognito": "split"`), and only runs there if you allow it for incognito in Chrome's extension settings. When it runs in incognito:

- Pages are still checked against your allow/restrict lists.
- Pages are recorded in the browsing log with an **incognito** flag.
- AI classification and Telegram notifications are **not** suppressed for incognito pages: if enabled, the URL and title are sent to your AI provider and/or Telegram bot exactly as for normal pages.
- Chrome's own history is not available in incognito, so the 5-minute history import returns nothing there.

If you do not want incognito pages handled, do not allow the extension in incognito.

## How long data is kept

- Browsing log: up to 10,000 entries; older entries are dropped as new ones arrive.
- System log: up to 100 entries.
- AI classification cache: entries are considered stale after 24 hours.
- Settings and tokens: until you change or delete them, or remove the extension.

## Your choices and how to delete your data

- **History:** open the extension's History page and press **Clear**.
- **AI cache:** open the Cache page and press **Clear** (or send `/clear_cache confirm` to your bot if Telegram commands are on).
- **System log:** open the System Logs page and press **Clear All Logs**; or switch system logs off in settings.
- **Tokens and settings:** clear the fields in the options page, or remove the extension. Removing the extension deletes everything it stored in your browser.
- **Stop sending data:** leave the AI token empty or switch AI classification off; leave the Telegram token/chat id empty or switch notifications off.
- **Data already sent** to an AI provider or Telegram is held by them; delete it using their tools. For tokens, you can also revoke them in your GitHub / OpenRouter / BotFather account.

## Security

- Data sent to AI providers and Telegram travels over HTTPS.
- Settings, tokens and the optional access password are stored **unencrypted** in Chrome's local extension storage on your device. The password screen only limits casual use of the extension's own pages; it is **not** encryption, and it does not protect the stored data from someone with access to your browser profile or device. Use a unique, limited-scope API token and bot, and protect your device and Chrome profile.

## Children

The extension is intended to be configured by a parent or guardian. The developer does not collect any information from children or anyone else. Information about pages visited is stored on the device where it is installed and, if you enable them, sent to the AI and Telegram services you choose.

## Chrome Web Store User Data Policy - Limited Use

The use of information received from Chrome extension APIs (including browsing history and tab information) will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only to provide the extension's single purpose, is transferred only to the AI and Telegram services you configure and only as needed for that purpose, is not used for advertising or lending decisions, and is not read by humans.

## Changes to this policy

If the extension's data handling changes, this policy will be updated and the effective date changed. Material changes will also be noted in the extension's store listing.

---

## Evidence (verified against code, v1.0.54)

| Statement | Source |
|---|---|
| Local storage of log, settings, cache, logs | `src/utils/storage.ts:16-101,107-129`; `src/utils/system-logger.ts:31-48`; `src/background/navigation-handler.ts:131,363` |
| Log fields incl. incognito flag | `src/background/navigation-handler.ts:197,265-296` |
| History import every 5 min, empty in incognito | `src/background/service-worker.ts:53`; `src/utils/constants.ts:9`; `src/utils/history-sync.ts:16-18,38-47` |
| AI request contents (full URL, title, prompt, token, model) | `src/utils/ai-classifier.ts:43-64,72-91,128-147`; extra OpenRouter headers `:77-78` |
| AI only when token + enabled; ignore list skipped | `src/utils/ai-classifier.ts:43-45`; `src/background/navigation-handler.ts:217-219,239` |
| Cache reuse (24 h TTL) | `src/background/navigation-handler.ts:221-224`; `src/utils/constants.ts:8` |
| Telegram message contents | `src/utils/telegram-notifier.ts:118-123,128-154,281-363,375-405,411-508`; local queue `:591-596`. (`sendWeeklyReport :513` and `notifyTimeLimitReached :554` exist but have no caller in `src/` per grep; so no such messages are sent today. [Re-check if a caller is added.]) |
| Telegram only with token + chat id | `src/utils/telegram-notifier.ts:166-169,307-310` |
| Telegram command polling restricted to configured chat | `src/background/telegram-commands.ts:280-284,330-342` |
| Sole network targets | all `fetch(` calls: `src/utils/ai-classifier.ts`, `src/utils/telegram-notifier.ts`, `src/background/telegram-commands.ts`, `src/pages/utils/ai-models-handler.ts:31,45`, `src/pages/utils/telegram-handler.ts:34,126`. No other host. |
| No page content read | single content script `src/content/restriction-overlay.ts`; `src/manifest.json:25-30` |
| Google Fonts | `src/pages/options.html:7-9`, `history.html:7-9`, `cache.html:7-9`, `system-logs.html:7-9` |
| Incognito split | `src/manifest.json:45` |
| Limits: 10,000 history, 100 logs | `src/utils/constants.ts:6-7` |
| Clear buttons | `src/pages/history.ts:342-344`; `src/pages/cache.ts:355-357`; `src/pages/system-logs.html:60`; Telegram `/clear_cache`: `src/pages/options.html:281`, `src/background/telegram-commands.ts:168` |
| Password plain text | `src/core/default-settings.ts:34`; `src/pages/utils/password-gate.ts:14` |
| No consent screen exists | `grep -rniE "consent|disclos|privacy" src/pages` -> no matches (gap, see privacy-practices.md section 7) |
