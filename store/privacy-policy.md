# Privacy Policy - Focus Saving Assistant

**Effective date:** 31.10.2026

Focus Saving Assistant ("the extension") is a Chrome extension that helps a parent or learner stay focused while browsing. This policy explains what data the extension handles, where it goes, and how you can delete it.

> **Hosting note for the publisher (delete before publishing):** every statement below is tied to code in the repository; the file/line evidence is in the "Evidence" section at the end, which can stay or be removed. Replace the bracketed placeholders. Do not add claims about encryption or hashing of the settings password - it is stored in plain text (see Security).

## In short

- The developer does **not** run any server for this extension and **does not receive** your data.
- Your browsing log, settings, tokens and logs are stored **locally in your browser**.
- If you turn on **AI classification**, the address (URL) and title of pages you visit are sent to the AI services **you selected**, using **your own** keys: with the optional **decision model**, to OpenRouter (Decisions API) for every page that is not cached; the **explanation model** (GitHub Models or OpenRouter) receives them only for pages the decision model blocked. Without a decision model, one AI provider receives every classified page, as before.
- If you turn on **Telegram notifications**, messages containing page URLs and titles are sent to Telegram, through **your own** bot, to **your own** chat.
- We do not sell your data, show ads, or use analytics or tracking.

## What data the extension handles

| Data | Where it is kept | Why |
|---|---|---|
| Browsing log: page URL, page title, visit times, how the page was reached, whether it was blocked and why, the AI result for it, and whether it was visited in an incognito window | Locally, in `chrome.storage.local` | To show you a history of what was visited and what was blocked |
| Imported Chrome history (URL, title, visit times) | Merged into the same local log, every 5 minutes | So the log is complete |
| Your settings: allow / restrict / ignore URL patterns, restricted-page message, categories and risk levels you chose to restrict (with the optional descriptions you wrote for them), display name, notification options, quiet hours (on/off and the hours you set), AI provider and models (decision model, explanation model), the audience text you chose (for example "children aged 6-10"), AI prompts (explanation prompt, single-call prompt) | Locally | To make the extension work the way you configured it |
| Your AI API tokens (OpenRouter key for the decision model, GitHub Models or OpenRouter token for the explanation model) and your Telegram bot token and chat id | Locally, in plain text inside your settings (and in the settings export file you can download) | To call the services you chose |
| Optional settings password and its hint | Locally, in plain text inside your settings | To lock the settings, history, cache and log pages (see Security) |
| AI classification cache (result per website, kept 24 hours): category, risk level, the decision model's probabilities and exact model name, the written reason and suggested link, and, until the Telegram notice for a blocked site is finalised, the Telegram message id and the notice text | Locally | To avoid asking the AI provider twice for the same site, and to finish editing the Telegram notice |
| System log (up to 100 entries, can be switched off) | Locally | Troubleshooting; entries can include URLs, the decision model's answers and parts of AI responses |
| Timestamps for the weekly report (when the last report was sent, when counting started, when it was last attempted) and the date of the last quiet-hours notification (no URLs) | Locally, in `chrome.storage.local` | To send the weekly report every 7 days and the quiet-hours notice once per quiet period |

The extension also reads the title, description, keywords and Open Graph tags of each page you visit, and passes them to its own background process. That information is currently not stored and not sent anywhere.

## What is sent off your device, and to whom

Data leaves your device **only** to the services below, **only** when you have configured them, and always over HTTPS.

1. **AI services you choose - OpenRouter Decisions (`openrouter.ai`), and GitHub Models (`models.github.ai`) or OpenRouter chat (`openrouter.ai`).** Which of them receive data depends on the mode you set up on the AI Classification tab.
   - **Decision model (Stage 1, optional).** When it is turned on with a pinned model and an OpenRouter key, each page you visit (that is not on your ignore list and not already in the 24-hour cache) causes one request to the OpenRouter Decisions API (`https://openrouter.ai/api/v1/systemone`) containing: the page's **full URL** (cut to 1,000 characters, including any query string), the page **title** (cut to 200 characters), the **audience text**, the **names and descriptions of your categories and risk levels**, the model name and a fixed set of questions. Your OpenRouter key is sent in the `Authorization` header; the extension's own address and the name "Focus Saving Assistant" are sent as headers. The model's answers (yes/no probabilities, category, risk level) are stored locally. The "Test model" button on the options page sends one such request with a fixed public sample page (a Wikipedia article), your audience text and your lists; no browsing data. OpenRouter forwards the request to the provider of the model you chose.
   - **Explanation model (Stage 2).** When a decision model is used, the explanation model (GitHub Models or OpenRouter chat, your own token) receives a request **only for pages the decision model blocked by category or risk level**, and only once per website per 24 hours: the page URL, title, the audience text, the category and risk level, your explanation prompt and the model name. Its reply (a reason and a suggested educational link) is stored locally. If you turn the explanation model off or leave its token empty, this request is never made.
   - **Single-call mode (no decision model set).** As before: each classified page causes one request to GitHub Models or OpenRouter containing the full URL, the title, your classification prompt (including the audience text), your category and risk level lists and the model name, with your own token in the `Authorization` header (with OpenRouter, also the headers above). The reply is stored locally.
   - The extension also asks OpenRouter for its list of decision models and the provider for its list of models, using your key.
   The providers handle this data under **their own** terms and privacy policies. Suggested links are written by a generative model and are only format-checked by the extension; they are not opened or checked.

2. **Telegram (`api.telegram.org`), through your own bot.**
   When Telegram notifications are on and you entered a bot token and chat id, the extension sends messages to your chat. Depending on your notification options these messages contain: the display name you set, the page **title and URL**, whether access was allowed or blocked and why (including the matching pattern), the AI classification details if available (for a blocked page this can include the reason and suggested link **written by the explanation model**), and a timestamp. A blocked-site notice is sent immediately and, when an explanation is produced, **the same message is edited once** (no additional message) to add the reason and suggestion; the edit goes to the same chat through the same bot. If you choose hourly or daily notification frequency, notifications about allowed pages are queued locally (title, URL, classification) until sent; blocked-site notices are never queued. If you also enable Telegram commands, the extension periodically asks Telegram for new messages sent to your bot and acts only on commands from the chat id you configured (for example to add a site to the allow list).
   Two more messages exist, both only if enabled in the notification options and both only to your own bot and chat: a **weekly report**, sent every 7 days (display name, the number of visits, educational visits and blocked attempts in the past 7 days, up to three category names, and the date range; no URLs or titles), and, if you turn on **quiet hours**, a **quiet-hours notice** once per quiet period on the first blocked attempt (display name, the **hostname** of the blocked site, the quiet hours and a timestamp; no full URL and no title).
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
- Quiet hours, if you enable it, also applies to incognito windows. If Telegram notifications are on, a blocked incognito attempt can be reported in the quiet-hours notice by **hostname** only.
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
- **Stop sending data:** leave the AI tokens empty or switch AI classification off (to stop only the decision model request, turn off "Use a decision model"; to stop only the explanation request, turn off the explanation model); leave the Telegram token/chat id empty or switch notifications off.
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

## Evidence (verified against code, v1.2.0)

| Statement | Source |
|---|---|
| Local storage of log, settings, cache, logs | `src/utils/storage.ts:18-104,110-268`; `src/utils/system-logger.ts:31-48`; `src/background/navigation-handler.ts:201,433` |
| Log fields incl. incognito flag | `src/background/navigation-handler.ts:272-274,342-353,364-373` |
| History import every 5 min, empty in incognito | `src/background/service-worker.ts:80`; `src/utils/constants.ts:9`; `src/utils/history-sync.ts:16-18,38-47` |
| Decision model request contents (full URL cut to 1,000, title cut to 200, audience, category/risk-level names and descriptions, model, key, headers) | request built `src/core/decision-request.ts:8-13,33-39,58-105`; items and descriptions `src/core/classification-limits.ts:50-62`, `src/core/decision-request.ts:41-56`; sent to `https://openrouter.ai/api/v1/systemone` with the key in `Authorization` and the two extra headers `src/utils/decision-classifier.ts:42-52`; key resolution `src/core/ai-mode.ts:6-10`; request assembled from settings `src/utils/decision-classifier.ts:113-123` |
| Decision answers stored locally | `src/core/decision-response.ts:72-114`; cached `src/background/navigation-handler.ts:306-309`; logged without key `src/utils/decision-classifier.ts:145-149` |
| "Test model": fixed sample page, your audience and lists, no browsing data | `src/pages/utils/ai-models-handler.ts:269-304`; catalog list request `:164,241-246` |
| Explanation model request (URL, title, audience, category, risk level, prompt, token, model); only for blocked pages; once per cache entry | prompt `src/core/explanation.ts:42-45`; variables `src/utils/ai-classifier.ts:319-326`; HTTP calls `:82-102` (OpenRouter, headers `:87-88`), `:139-159` (GitHub Models); trigger rule `src/core/explanation.ts:20-31`; claim and tail in `src/background/navigation-handler.ts:87-97,224-235`; at most one attempt per entry `src/utils/storage.ts:200-206`, `src/core/explanation.ts:138-141` |
| Single-call request contents (URL, title, prompt with audience, category/risk-level lists, token, model) | `src/utils/ai-classifier.ts:225-243,82-102,139-159` |
| AI only when enabled and a token/decision model is set; ignore list skipped | mode `src/core/ai-mode.ts:17-31`; `src/background/navigation-handler.ts:293-295`; dispatch `src/utils/ai-classifier.ts:290-303` |
| Cache reuse (24 h TTL; Stage 2 does not extend it) | `src/background/navigation-handler.ts:297-299`; `src/utils/storage.ts:149-168,190-193`; `src/utils/constants.ts:8` |
| Telegram blocked-site notice contents | `src/core/telegram-block-message.ts:70-119`; sent `src/utils/telegram-notifier.ts:234-278`; allowed-page notices `:283-418`; classification details `:48-91`; local queue `:489-563` |
| Telegram notice edited once, same chat, same bot, no second message | send result `src/utils/telegram-notifier.ts:98-161`; `editMessageText` `:169-212`; first message `src/background/navigation-handler.ts:143-181`; edit once plus one fallback retry, chat/token check `src/background/explanation-runner.ts:141-159,214-217`; recovery after a stopped worker `:227-258`; message reference kept in the cache entry `src/types/index.ts:120-135`, `src/background/explanation-runner.ts:116-135`; reference never copied to history `src/background/navigation-handler.ts:219` |
| Weekly report: contents and trigger | message `src/utils/telegram-notifier.ts:421-452`; statistics are counts and category names only `src/core/weekly-report.ts:43-82`; sent from `src/background/weekly-report-handler.ts:42-43`; hourly alarm `src/background/weekly-report-handler.ts:87`; local timestamps `src/utils/constants.ts:24-27` |
| Quiet-hours notice: hostname only, once per quiet period | message `src/utils/telegram-notifier.ts:455-487`; sent from `src/background/quiet-hours-handler.ts:80-104`; the check is a clock comparison with the quiet hours, no network request `src/core/quiet-hours.ts:28-69` |
| Quiet hours also applies in incognito | no incognito condition in `src/background/quiet-hours-handler.ts:31-73`; the weekly check runs only in the normal (non-incognito) worker `src/background/weekly-report-handler.ts:21-22` |
| Quiet-hours blocks never reach AI | `src/background/navigation-handler.ts:262-265` (before classification); Stage 2 only for `content-restricted` `src/core/explanation.ts:23` |
| Telegram only with token + chat id | `src/utils/telegram-notifier.ts:105`; `src/core/telegram-eligibility.ts:37-45`; `src/utils/telegram-notifier.ts:289,326,422` |
| Telegram command polling restricted to configured chat | `src/background/telegram-commands.ts:280-284,330-342` |
| Sole network targets | all `fetch(` calls: `src/utils/ai-classifier.ts:82,139`, `src/utils/decision-classifier.ts:42`, `src/utils/telegram-notifier.ts:122,183`, `src/background/telegram-commands.ts:292,365`, `src/pages/utils/ai-models-handler.ts:36,50,241`, `src/pages/utils/telegram-handler.ts:34,126`. No other host. |
| No page content read | single content script `src/content/restriction-overlay.ts`; `src/manifest.json:25-30` |
| Google Fonts | `src/pages/options.html:7-9`, `history.html:7-9`, `cache.html:7-9`, `system-logs.html:7-9` |
| Incognito split | `src/manifest.json:45` |
| Limits: 10,000 history, 100 logs | `src/utils/constants.ts:6-7` |
| Clear buttons | `src/pages/history.ts:66,356-358`; `src/pages/cache.ts:90,370-372`; `src/pages/system-logs.html:60`; Telegram `/clear_cache`: `src/pages/options.html:444`, `src/background/telegram-commands.ts:158` |
| Password plain text; decision key in the settings export | `src/core/default-settings.ts:33`; `src/pages/utils/password-gate.ts:14`; export writes the whole settings object `src/pages/options.ts:791-794` |
| No consent screen exists | `grep -rniE "consent|disclos|privacy" src/pages` -> no matches (gap, see privacy-practices.md section 7) |
