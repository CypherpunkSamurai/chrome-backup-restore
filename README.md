# Chrome Data Manager

A Chrome extension to import and export browser data.

## Features

| Data Type    | Export | Import |
|-------------|--------|--------|
| Extensions  | ✅ Full list with enabled state | ✅ Restores enabled/disabled state |
| Bookmarks   | ✅ Full tree with folders | ✅ Merges into existing tree |
| History     | ✅ All URLs, titles, timestamps | ✅ Re-adds URLs to history |
| Cookies     | ✅ All domains, all fields | ✅ Sets cookies back exactly |
| Web Storage | ✅ localStorage + sessionStorage per origin | ✅ Checkbox pick per origin, merges keys |

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Select the `chrome-data-manager` folder

## Usage

Click the extension icon in the toolbar to open the popup.

### Extensions Tab
- **Export** — Downloads a JSON file listing all installed extensions with name, version, and enabled state.
- **Import** — Reads a JSON export, parses the extension list, and shows a checkbox list so you can pick which extensions to apply. Checked extensions get their enabled/disabled state restored; Web Store extensions not currently installed open their Chrome Web Store page in background tabs.

### Bookmarks Tab
- **Export** — Downloads the full bookmark tree as JSON, preserving folder structure.
- **Import** — Recreates the bookmark tree under "Other Bookmarks". Does not overwrite existing bookmarks.

### History Tab
- **Export** — Downloads all browsing history up to the configured max entries.
- **Import** — Re-adds URLs to Chrome history. Note: Chrome's `history.addUrl` API always stamps the current time; original timestamps are stored in the JSON for reference but cannot be fully restored.

### Cookies Tab
- **Export** — Downloads all cookies from all domains, including secure, httpOnly, and SameSite attributes.
- **Import** — Sets cookies back using `chrome.cookies.set`. Session cookies are given a 1-year expiry on import. Cookies that fail (e.g. cross-origin restrictions) are counted and reported.

### Storage Tab
- **Export** — Scans all open tabs, groups them by origin, and reads each site's `localStorage` and `sessionStorage` via `chrome.scripting`. Optionally ("Also export sites from browsing history") it crawls up to 50 most-recent history origins by opening a temporary background tab per site, reading its persisted `localStorage`, and closing the tab — sessionStorage cannot be captured this way because it only exists in live tabs. Origins with empty storage or unreadable pages are skipped. Output shape: `{origins: {"https://site": {local: {...}, session: {...}}}}`.
- **Import** — Parses the JSON export (wrapped `{local, session}` format or a flat localStorage-only map) and shows a checkbox list of origins. Selected origins are restored by injecting `setItem` loops into an existing tab on that origin, or into a new background tab (opened and awaited) when none is open. Import merges — keys not present in the file are untouched.

## Permissions

| Permission | Purpose |
|-----------|---------|
| `management` | Read and toggle extension states |
| `bookmarks` | Read and write bookmarks |
| `history` | Read and write browsing history |
| `cookies` | Read and write cookies |
| `<all_urls>` | Required for cross-domain cookie access and localStorage injection |
| `scripting` | Injects the localStorage read/write functions into web pages |

## Development

The popup icons come from the [Phosphor](https://phosphor-icons.com) set through the [Iconify API](https://iconify.design/docs/). `tools/build-sprite.mjs` fetches the paths and rewrites the `<svg class="sprite">` block in `popup.html`. Run it after adding or renaming an icon:

```bash
node tools/build-sprite.mjs
```

The script fails on a wrong icon name, so a typo cannot reach the popup. Symbols are named for purpose (`i-export`, not `i-arrow-up`), and an icon name maps to one symbol id in the `ICONS` object at the top of the script.

## Notes

- Cookie import may partially fail for domains with strict same-site or secure policies.
- Extension install/uninstall is not possible via any Chrome extension API.
- Bookmark import does not deduplicate — running it twice will create duplicates.
