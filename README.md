# Focus Saving Browser Extension

Chrome/Edge browser extension for maintaining focus and productive work online.

## Features

- ✅ **Visit History Organization** - automatic saving and structuring of your visits
- ✅ **Site Access Management** - configure allowed and restricted site lists with wildcard pattern support
- ✅ **AI Content Classification** - automatic detection of educational content via GitHub AI Models API
- ✅ **Telegram Notifications** - notifications about important events and activity
- ✅ **Customizable Prompt** - ability to configure classification criteria to your needs
- ✅ **Visit History** - view and filter history with data export
- ✅ **Information Pages** - customizable messages to help maintain focus

## Technologies

- **TypeScript** - typed JavaScript
- **Manifest V3** - latest Chrome Extensions API version
- **GitHub AI Models API** - for content classification
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

`npm run build` runs `tsc`, bundles the service worker, copies assets and strips source maps:

1. TypeScript compiles all `.ts` files from `src/` to `.js` files in `dist/`
2. The service worker (`background/service-worker.ts`) is bundled into a single IIFE file with esbuild, because Chrome service workers don't support ES modules
3. HTML, CSS, icons, images and `manifest.json` are copied from `src/` to `dist/`; `.ts` links in HTML files are replaced with `.js`

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

### Step 2: Configure GitHub AI API

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

1. In the "AI Classification" tab:
   - Select model (GPT-4 recommended)
   - Select prompt template or create your own
   - Enable automatic classification
2. Save settings

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

#### Console errors

- Open `chrome://extensions/`
- Find the extension and click "View service worker"
- Check console errors

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
- Pure logic (URL pattern matching, settings migration, history merging, model-reply parsing, Telegram command parsing) lives in `src/core/`. It must not use `chrome.*`, the DOM or anything outside `core/` and `types/`; `tests/tsconfig.json` type-checks it without those globals
- Files in `src/core/` import each other, and callers import `core/` modules, with explicit `.ts` specifiers (`import { x } from '../core/x.ts'`); `tsc` rewrites them to `.js` on build, and Node can run the same files for tests
- Run the unit tests with `npm test` (type-checks `tests/` and `src/core/`, then runs `node --test`; Node 22.18+ or any Node with type stripping enabled)

## License

MIT
