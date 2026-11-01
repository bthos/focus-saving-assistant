# Focus Saving Browser Extension

Chrome/Edge browser extension for maintaining focus and productive work online.

## Features

- ✅ **Visit History Organization** - automatic saving and structuring of your visits
- ✅ **Site Access Management** - configure allowed and restricted site lists with wildcard pattern support
- ✅ **Two-Stage AI Content Classification** - a fast OpenRouter *decision model* judges every new site, a *generative model* explains only the blocked ones (or a single GitHub Models / OpenRouter call when no decision model is set)
- ✅ **Telegram Notifications** - notifications about important events and activity
- ✅ **Audience and Prompts** - choose who you protect (audience presets), edit the explanation prompt, describe your own categories and risk levels
- ✅ **Visit History** - view and filter history with data export
- ✅ **Information Pages** - customizable messages to help maintain focus

## Technologies

- **TypeScript** - typed JavaScript
- **Manifest V3** - latest Chrome Extensions API version
- **OpenRouter Decisions API** (`/api/v1/systemone`) - fast verdict on each page (Stage 1)
- **GitHub AI Models API / OpenRouter chat completions** - written reason and suggestion for blocked pages (Stage 2), or the whole classification in single-call mode
- **Telegram Bot API** - for notifications

## Installation and Development

### Requirements

- Node.js 18+ and npm
- Chrome/Edge browser

### Quick Start

1. Install dependencies:

```bash
npm install
```

1. Build the project:

```bash
npm run build
```

This will compile TypeScript files to JavaScript and copy all necessary files to the `dist/` folder.

1. Load the extension from the `dist/` folder in your browser (see [Load Extension](#load-extension) below).

### Development Mode

```bash
npm run watch
```

Runs the TypeScript compiler in watch mode and recompiles `.ts` files on change. It does **not** re-bundle the service worker or copy HTML/CSS/manifest/icons, so run `npm run build` after changing those. After each rebuild, click the reload button for the extension on `chrome://extensions/`.

### Load Extension

1. Build the project: `npm run build`
2. Open Chrome or Edge and navigate to `chrome://extensions/` (or `edge://extensions/`)
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked extension" (Load unpacked)
5. Select the `dist/` folder (not `src/`!)

### Build Structure

`npm run build` runs `tsc`, bundles the service worker, copies assets, strips source maps and packs `dist/` into `focus-saving-extension-<version>.zip` for the store:

1. TypeScript compiles all `.ts` files from `src/` to `.js` files in `dist/`
2. The service worker (`background/service-worker.ts`) is bundled into a single IIFE file with esbuild, because Chrome service workers don't support ES modules
3. HTML, CSS, icons, images and `manifest.json` are copied from `src/` to `dist/`; `.ts` links in HTML files are replaced with `.js`
4. `dist/` is packed into `focus-saving-extension-<version>.zip` in the project root (version from `manifest.json`; `manifest.json` at the archive root, no source maps) — upload this file to the Chrome Web Store / Edge Add-ons. Archives of other versions are kept. The archive step can also be run alone with `npm run store-archive`

**Important:**

- **Content Scripts** and **Pages** can use ES modules (with `type="module"` in HTML)
- Always load the extension from the `dist/` folder, not `src/`

### Cleanup

To remove compiled files (`dist/`):

```bash
npm run clean
```

## Configuration

### Step 1: Prepare Icons

Icon PNGs are gitignored, so add them before building. Create three files in `src/icons/` (they are copied to `dist/icons/`):

- `src/icons/icon16.png` (16x16 pixels)
- `src/icons/icon48.png` (48x48 pixels)
- `src/icons/icon128.png` (128x128 pixels)

Simple colored squares are fine for testing.

### Step 2: Configure the generative model (GitHub AI API)

1. Go to GitHub.com and sign in
2. Open Settings → Developer settings → Personal access tokens → **Fine-grained tokens**
3. Click "Generate new token"
4. Configure the token:
   - **Token name**: Enter a name (e.g., "Focus Saving Extension")
   - **Description**: Describe the token's purpose (optional)
   - **Expiration**: Select an expiration period (recommended: 30-90 days)
   - **Resource owner**: Select your GitHub username
5. Under **Permissions**, find and expand **Account permissions**
6. Find **Models** and set it to **Read** (this grants access to GitHub AI Models API)
7. Click "Generate token"
8. **IMPORTANT:** Copy the token immediately (it won't be shown again)
9. In extension settings (right-click icon → Options) paste the token in the "API Token" field

**Note:** Fine-grained personal access tokens are required for GitHub AI Models API access. Classic tokens are no longer supported for this API.

This is the **explanation model** (two-stage mode) or the **only model** (single-call mode). You can use OpenRouter instead of GitHub: pick the provider in the "Explanation model" section. For the fast decision model you need an OpenRouter key, see [AI Classification](#ai-classification).

### Step 3: Configure Telegram Bot

1. Open Telegram
2. Find @BotFather bot
3. Send command `/newbot`
4. Follow instructions:
   - Enter bot name (e.g., "Focus Saving Bot")
   - Enter bot username (must end with "bot", e.g., "focus_saving_bot")
5. Save the bot token (format: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
6. Find @userinfobot in Telegram
7. Send it any message
8. Copy your Chat ID (this is a number, e.g., `123456789`)
9. In extension settings enter:
   - Bot Token (token from BotFather)
   - Chat ID (your ID from userinfobot)
10. Click "Test Notification" to verify

### Step 4: Configure Restrictions

1. Open extension settings
2. In the "Restriction" tab:
   - Add sites to restricted list (e.g., `example.com`, `*.example.com`)
   - Add exceptions to allowed list if needed
   - Configure message on restriction page
3. Click "Save Settings"

### Step 5: Configure AI Classification

1. Open the "AI Classification" tab.
2. Keep **Enable AI classification** on and enter a token for the explanation model (Step 2). That alone gives you **single-call mode**.
3. Optional, recommended: turn on **Use a decision model**, enter an OpenRouter key, press **Load decision models**, choose `typesafe/jev-1.14-20261014` (marked Recommended) and press **Test model**.
4. Choose the **audience** (who you protect). Check the mode line at the top of the tab: it says which mode is active.
5. Save settings.

Details, limits and caveats: [AI Classification](#ai-classification).

### Verification

1. Try opening a site from the restricted list - restriction page should appear
2. Check Telegram - notification about restriction should arrive
3. Open visit history - all visited sites should be displayed

### Troubleshooting

#### Extension doesn't restrict sites

- Check that site is added to restricted list
- Make sure settings are saved
- Reload the page

#### Telegram notifications don't arrive

- Check Bot Token and Chat ID correctness
- Use "Test Notification" button to verify
- Make sure notifications are enabled in settings

#### AI classification doesn't work

- Check GitHub API token correctness
- Make sure token is a **fine-grained personal access token** (not classic token)
- Verify token has **Models: Read** permission under Account permissions
- Check that automatic classification is enabled
- If using a fine-grained token, ensure it hasn't expired
- If you use a decision model: the options tab shows the last AI error with a prefix, `Decision model: …` or `Explanation model: …`, so you can tell which stage failed
- `Decision model did not accept the request: …` means the chosen model rejects this extension's request; choose a model marked Recommended or Verified
- `OpenRouter rejected the API key` / `OpenRouter account has insufficient credits` / `OpenRouter rate limit reached`: fix the key, top up the account or wait
- Blocked pages show a short automatic reason and no suggestion: the explanation model is off, has no token, or failed (see its error prefix)

#### Console errors

- Open `chrome://extensions/`
- Find the extension and click "View service worker"
- Check console errors

## AI Classification

The extension can look at the address (URL) and title of each page you open and decide, from your own category and risk-level lists, whether to block it. It never reads the page text. There are two ways to do it.

| Mode | When | What happens |
|---|---|---|
| **Off** | AI classification is switched off, or there is no usable token | No page is classified. URL lists and quiet hours still work. |
| **Single call** | No decision model set, explanation-model token present | One generative model (GitHub Models or OpenRouter chat) returns verdict, category, risk level, reason and suggested link in one request. This is the behaviour of earlier versions, unchanged. |
| **Two-stage** | Decision model set (toggle on, pinned model, OpenRouter key) | Stage 1 decides fast; Stage 2 explains only what Stage 1 blocked. |

The mode line at the top of the AI tab shows the active mode. If you turn on the decision model but it is not ready (no pinned model or no key), it is not used and the extension falls back to single call (or off).

Updating from an older version changes nothing by itself: the decision model is off until you turn it on.

### Why two stages

A generative model that must produce verdict, reason and a link in one request is slow, so the page is open for a long time before the child is redirected. A decision model answers only yes/no and multiple-choice questions and returns in a fraction of a second (about 0.24 s median in testing). The slow, human-readable part is moved after the block, where it delays nothing.

- **Stage 1: decision model** (OpenRouter Decisions). Five judgments about the URL and title: is it primarily educational, is it appropriate for your audience, does any of your categories fit (skipped if your list has an `Other` item), which category, which risk level. A probability above 0.7 counts as yes, below 0.3 as no, in between as unknown. **The model only judges; your lists decide.** A page is blocked when its category is on your restricted categories list or its risk level is on your restricted risk levels list (case-insensitive). "Educational" and "age appropriate" are shown in History and Telegram but never block by themselves. If "does any category fit" is answered no, the category becomes `Other`. The model's risk level is used as chosen.
- **Stage 2: explanation model** (GitHub Models or OpenRouter chat). Runs only for pages Stage 1 blocked by category or risk level, and only after the block happened. It writes a short reason for the parent and suggests an educational page. Pages blocked by a URL pattern or by quiet hours never trigger it. Time limit 20 s.

Stage 1 timeout is 8 s; a network error, timeout or HTTP 5xx is retried once after 0.5 s, other errors are not.

### Set up the decision model

1. **OpenRouter key.** Create one at <https://openrouter.ai/keys> and make sure the account has credits. Paste it in "OpenRouter key (decision model)". If you leave the field empty and the explanation model also uses OpenRouter, that key is reused. A GitHub token is never sent to OpenRouter. The key is stored locally in plain text and is part of the settings export file, like the other tokens.
2. **Pick a model.** Press **Load decision models**. Only pinned (versioned) builds are listed, with context size and price from OpenRouter; aliases such as `~vendor/model` or ids ending in `-latest` are not accepted because their behaviour can change without notice. The list is grouped:

| Group | Models | Meaning |
|---|---|---|
| Recommended ✓ | `typesafe/jev-1.14-20261014` | Best stability in our test, no false blocks of educational pages, blocked all 5 adversarial titles |
| Verified ✓ | `perplexity/pplx-decider-flash-v1.2-20261016`, `liquid/d1.1-20261027` | Work well; noisier answers (see Limits) |
| Works, but not recommended ✓ | `baseten/joey-1-20261029` | Accepts the request, but answered risk level `Low` for 55 of 59 test pages and missed gambling and adult pages |
| Not verified | any other model | May reject the request. Cannot be saved until **Test model** has passed for it |
| Incompatible (disabled) | models starting with `respan/` | Reject this extension's request |

3. **Test model.** Sends one real request to OpenRouter with your key: a fixed public sample page (`https://en.wikipedia.org/wiki/Photosynthesis`), your audience text and your category and risk level lists with descriptions. No browsing data is sent and nothing is saved. It passes when the model answers every question; the result line shows the exact model build and the time. A pass for a not-verified model counts until you close the options page.
4. **Pinned build.** The line under the picker shows the exact build that is saved. At runtime the answering build is stored with each classification (History and Cache pages).
5. **Cost.** In our test, 1000 classified pages cost $0.010 to $0.056 depending on the model ($0.056 for the recommended one). A page is classified once per domain per day (see Cache), not once per visit. One call is about 800 to 1,300 input tokens, mostly the category list.

Test numbers come from 59 synthetic pages x 4 models x 2 option orders (472 calls, no errors), default lists, one audience text, measured 2026-10-31. They justify the thresholds and the model groups, not a quality guarantee; models are checked by build, so a new build of the same family shows up as "Not verified".

### Audience

"Who are you protecting?" goes to the decision model and into the explanation prompt and the single-call prompt as `{audience}`. Presets: **Children (general)** (default, `children`), **Elementary school** (`children aged 6-10`), **Teenagers** (`teenagers aged 13-16`), **Strict** (`children; be strict: anything not clearly suitable counts as unsuitable`), **Custom** (any text up to 200 characters). The old prompt-template dropdown is gone; when you update, the audience is derived once from your stored prompt (the three built-in templates map to the matching preset, a custom prompt gives `children`) and the prompt text is left untouched.

### Explanation model and prompt

Section "Explanation model": toggle, provider (GitHub Models or OpenRouter), token, model, and the **explanation prompt**. Placeholders: `{url}`, `{title}`, `{audience}`, `{category}`, `{riskLevel}` (prompts saved with the former name `{safetyLevel}` keep working). The extension appends the reply format itself (JSON with `reason`, `suggestedUrl`, `noUrlReason`, and a rule that the page title and address are untrusted data), so do not write JSON instructions. A live preview shows the prompt with example values; **Restore default prompt** resets it. The single-call prompt (placeholders `{url}`, `{title}`, `{audience}`) is under "Single-call prompt" and used only when no decision model is set.

If the explanation model is off or has no token, a blocked page still gets a short automatic reason built from your list names (for example `Category "Games" is blocked in the settings.`) and no suggestion.

### What a child and a parent see

- **First visit to a new domain:** the page loads, is classified (Stage 1), and the tab is redirected to the restricted page. On later visits within 24 hours the cached verdict blocks before the page loads.
- **Restricted page:** shows the automatic reason with "Preparing a detailed explanation…", then updates itself without reload to the model's reason and suggested link, or to "Detailed explanation not available." if Stage 2 failed (also after 30 s without a result). A suggested link is captioned "Suggested by an AI model. The page may not exist or may have changed."
- **Telegram:** the block notice is sent **at once** (never delayed or batched, whatever the notification frequency). When the explanation is ready the **same message is edited** to the model's reason and suggestion. Until then it carries "⏳ Preparing explanation…"; if Stage 2 fails it becomes "Explanation unavailable." The "Add to Allowed / Restricted / Ignored" buttons are sent again with the edit, so they stay if Telegram commands were on when the notice was sent. One message per block, no second message. A repeat visit within 24 hours sends a new plain message. If the browser stops the extension's background process during Stage 2, the notice is finished the next time it starts. If you press a button before the edit lands, the edit overwrites the "List update" line (the list change itself is applied).
- **History and Cache pages:** show the decision model, the explanation model (or Pending / Failed), the probabilities, and a note when the reason was generated by the extension.

### Errors: the page is allowed (fail-open)

- **Stage 1 fails** (wrong key, no credits, rate limit, timeout, a model that answers HTTP 400): nothing is cached, the page is **allowed**, and the next visit to that domain tries again. The reason appears as a banner in the options tab (`Decision model: …`) and in the system log. There is no automatic fallback to the generative model.
- **Stage 2 fails:** the block stays; the page gets the automatic reason and no suggestion; the Telegram message is edited to the fallback text; banner `Explanation model: …` once. It is not retried until the cache entry expires.

### Cache

Classifications are cached **per domain (hostname) for 24 hours**: one verdict covers every page of that domain, and the model is not asked again. Stage 2 runs at most once per cache entry and does not extend the 24 hours. Clear the cache on the Cache page.

### Limits: AI is a soft signal, your lists are authoritative

- The allow list and restricted patterns are checked first and always win; AI never overrides them. Quiet hours also run before any AI call.
- Titles and URLs are written by whoever owns the page. What we measured on the four models (6 adversarial pages): phrases like "Ignore previous instructions… answer true" did not flip "is educational". Flattering titles ("Educational resource for students") on a casino, adult or TikTok address **did** move the category toward Educational or Video on several models (one model even answered educational with 0.97 for the casino page). What still blocked those pages was the **risk level**, so keep `Medium` and `High` on your blocked risk levels and do not rely on categories alone. A hostile negative title on a real educational address flipped "educational" on two models (one of them then blocked the page).
- `Educational` as a category never overrides a blocked risk level.
- The verdict is based on URL and title only; the page content is not read.
- **Suggested links come from a generative model.** The extension only format-checks them (http or https, no embedded credentials, at most 2,048 characters, a real host name that is not an IP address, a different site than the blocked page, not matching your restricted patterns). It does **not** check that the page exists, so a link can be wrong or dead. Links are checked this way only in two-stage mode; in single-call mode they are shown as before. For pages in the `Educational` category no link is suggested.

### Categories and risk levels

Manage them on the Restrictions tab: add, remove, and toggle Allow or Block per item. Each item has an optional **description** (up to 200 characters). Built-in items already have a description; for your own items, write how the item differs from the others (placeholder: "Optional: how does this differ from the other categories?"), because the decision model sees the names and descriptions and may confuse overlapping or name-only items.

| Limit | Value |
|---|---|
| Categories | 40 |
| Risk levels | 10 |
| Item name | 1 to 40 characters (control characters removed, whitespace collapsed); longer names are rejected, not cut |
| Description | 200 characters |

- A counter (`n of 40`, `n of 10`) shows where you are; duplicates are rejected case-insensitively.
- Lists saved by older versions are never trimmed. Only the first 40 categories and 10 risk levels with a valid name are sent to the decision model; the rest are ignored and block nothing. A warning under the list tells you.
- An empty list means the decision model uses the built-in items and nothing from that list is blocked.
- The `Other` category: while an `Other` item exists, the "does any category fit" question is skipped and the model itself can answer `Other`. If you remove it, pages that fit nothing get the category `Other` and are not blocked by category unless you add `Other` again and set it to Block.
- **New default (new installs only): `Shopping` is blocked** together with `Retail`. In testing `Shopping` and `Retail` overlapped, so shops such as Amazon, Zara, eBay and Shein were labelled `Shopping` and not blocked. Existing installs keep their saved lists: if you block `Retail`, consider blocking `Shopping` too. "Reset to defaults" restores the new default.

### What is sent where

| What | To whom | When |
|---|---|---|
| Full URL (cut to 1,000 characters), title (200), audience, the names and descriptions of your categories and risk levels, model id, your OpenRouter key | OpenRouter (`openrouter.ai/api/v1/systemone`), which routes to the model provider | Stage 1, each page not in the 24 h cache and not on your ignore list; also **Test model** (fixed sample page) |
| URL, title, audience, category, risk level, your prompt, your token | GitHub Models or OpenRouter chat | Stage 2, only pages Stage 1 blocked; in single-call mode every classified page (with the category and risk level lists) |
| Title, URL, classification, reason, suggestion | Your Telegram chat, through your bot | The block notice, edited once afterwards |

Nothing goes to the developer. See `store/privacy-policy.md`.

## Project Structure

```text
focus-saving-assistant/
├── src/                      # Source code (TypeScript)
│   ├── background/          # Service Worker
│   ├── content/             # Content Scripts
│   ├── pages/               # HTML pages and their logic
│   ├── styles/              # CSS styles
│   ├── icons/               # Extension icons (PNGs are gitignored)
│   ├── assets/              # Static images
│   ├── core/                # Pure logic (no chrome.*, DOM or storage), unit-tested
│   ├── utils/               # Utilities (storage, Telegram, AI client, logging)
│   ├── types/               # TypeScript types only
│   └── manifest.json        # Extension manifest
├── tests/                   # Unit tests for src/core (node --test)
├── dist/                    # Compiled files (created after build)
├── scripts/                 # Build scripts (bundle service worker, copy assets)
├── tsconfig.json            # TypeScript configuration
└── package.json             # Dependencies and scripts
```

**Important:** All source files are in the `src/` folder. After building (`npm run build`), all files are copied and compiled to `dist/`. Load the extension from the `dist/` folder.

### Development Notes

- **Always work with files in `src/`**, don't edit files in `dist/` directly
- TypeScript files use ES modules (`import/export`)
- Types are defined in `src/types/index.ts`: `Settings`, `HistoryEntry`, `ClassificationResult`, `UrlCheckResult`
- Pure logic (URL pattern matching, settings migration, history merging, model-reply parsing, Stage 1 request and response handling, Stage 2 explanation and link validation, Telegram message building and command parsing) lives in `src/core/`. It must not use `chrome.*`, the DOM or anything outside `core/` and `types/`; `tests/tsconfig.json` type-checks it without those globals
- Files in `src/core/` import each other, and callers import `core/` modules, with explicit `.ts` specifiers (`import { x } from '../core/x.ts'`); `tsc` rewrites them to `.js` on build, and Node can run the same files for tests
- Run the unit tests with `npm test` (type-checks `tests/` and `src/core/`, then runs `node --test`; Node 22.18+ or any Node with type stripping enabled)

## License

MIT
