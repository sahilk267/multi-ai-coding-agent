# Contributing

## Add a new AI provider adapter

The router treats any file in `extension/adapters/*.js` (other than
`baseAdapter.js`) as a provider. Adding one is four small steps.

### 1. Create the adapter

`extension/adapters/<name>.js`:

```js
import AIAdapter from "./baseAdapter.js";

export default class MyProviderAdapter extends AIAdapter {
  constructor(utils) {
    super(utils);
    this.name = "myprovider";          // must match the filename stem
    this.selectors = {
      input:             ["textarea#chat-input", "div[contenteditable='true']"],
      sendButton:        ["button[aria-label*='Send' i]"],
      responseContainer: [".assistant-message"],
      lastResponse:      [".assistant-message:last-of-type .markdown"],
      spinner:           [".typing-indicator", "button[aria-label='Stop' i]"],
      loginIndicator:    ["a[href*='/login']"],
      // optional but recommended:
      captcha:           ["iframe[src*='captcha']"],
      rateLimit:         [".error-toast", "div[role='alert']"],
    };
  }

  async isLoggedIn() {
    if (this.utils.findFirst(this.selectors.loginIndicator)) return false;
    return !!this.utils.findFirst(this.selectors.input);
  }
}
```

All six required selector groups (`input`, `sendButton`,
`responseContainer`, `lastResponse`, `spinner`, `loginIndicator`) must be
non-empty arrays. Put the most specific / current selector first;
`utils.findFirst()` returns the first match.

`baseAdapter.js` already implements `sendPrompt`, `waitForResponse`,
`extractResponse`, `detectRateLimit`, and `detectCaptcha` against these
selectors. Override any of them only if the site needs custom behavior
(unusual input event sequence, streaming detection, multi-frame DOM, etc.).

### 2. Register the provider in `config.json`

```json
"providers": {
  "myprovider": { "url": "https://chat.myprovider.com/", "enabled": true }
},
"modelLimits": {
  "myprovider": 8000
},
"fallbackOrder": ["deepseek", "chatgpt", "gemini", "qwen", "myprovider"]
```

Optionally route a task kind to it:

```json
"routing": { "coding": "myprovider" }
```

### 3. Grant host access in `manifest.json`

```json
"host_permissions": [
  "https://chat.myprovider.com/*"
],
"content_scripts": [{
  "matches": ["https://chat.myprovider.com/*"],
  "js": ["content.js"],
  "run_at": "document_idle"
}],
"web_accessible_resources": [{
  "resources": ["adapters/myprovider.js", ...],
  "matches": ["<all_urls>"]
}]
```

### 4. Verify

```bash
cd extension
npm run check
```

This runs:

- `npm test` — token budgeter unit tests.
- `npm run check-selectors` — fails if any required selector group on
  any adapter is missing or empty (your new adapter is auto-discovered).
- `npm run snapshot-config` — fails if `routing` targets a disabled or
  unknown provider, if `fallbackOrder` references an unknown provider,
  if an enabled provider has no `modelLimits` entry, or if any provider
  URL isn't covered by `manifest.host_permissions`.

When all three pass, reload the extension at `chrome://extensions` and
your provider is live.

### Tip: maintaining selectors

Provider UIs change. When a selector breaks:

1. Open the provider tab, inspect the broken element.
2. Add the new selector to the **top** of the relevant array in your
   adapter (keep the old one as fallback for a release or two).
3. Re-run `npm run check-selectors` and reload the extension.

There's no rebuild step — adapters are loaded directly by Chrome.
