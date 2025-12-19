# Project Documentation — SEO SERP Analyzer (Chrome Extension, MV3)

This document provides a complete, orderly walkthrough of the project from start to finish. It covers directory structure, modules, data model, message flows, permissions, and step‑by‑step usage and development guidance so a new developer can resume work with zero confusion.

## Overview
- Purpose: Extract and analyze Google Search results (SERP) and collect structured data for analysis/export.
- Platform: Chrome Extension (Manifest V3) with `service_worker` background script.
- Core flow: Popup UI triggers background actions → background creates hidden Google search windows/tabs → content script scrapes raw data → background normalizes and persists to `chrome.storage.local` → popup displays table and can export CSV.
- No external build tooling; pure MV3 JS, HTML, CSS.

## Quick Start
- Requirements: Chrome (or Chromium-based browser) with Developer Mode enabled.
- Load the extension:
  - Open `chrome://extensions/`.
  - Toggle `Developer mode`.
  - Click `Load unpacked`.
  - Select the folder: `seo-extension-/seo-extension-` (this inner folder contains `manifest.json`).
- Usage:
  - Navigate to a Google search results page (`https://www.google.com/search?q=...`).
  - Click the extension icon to open the popup.
  - Use the controls to extract results (auto mode defaults to 30 results) and optionally export CSV.

## Directory Structure
Top-level repository structure:
- `seo-extension-/` — Project root folder containing the extension source in an inner folder:
  - `seo-extension-/` — Extension source (this is the folder to load in Chrome)
    - `icons/`
      - `icon128.png`
      - `icon16.png`
      - `icon48.png`
    - `background.js`
    - `content.js`
    - `manifest.json`
    - `popup.html`
    - `popup.js`
    - `styles.css` (currently empty)
- `Document/`
  - `project_documentation.md` (this document)

## Modules and Responsibilities
- `manifest.json` (`seo-extension-/seo-extension-/manifest.json:1`)
  - Declares extension metadata, permissions, `service_worker` background, and content scripts.
  - MV3 service worker: `background.js` (`manifest.json:21`)
  - Content scripts matched on Google search results pages (`manifest.json:32-38`).
  - Permissions: `activeTab`, `storage`, `scripting`, `tabs`, `windows` (`manifest.json:7-13`).
  - Host permissions: `https://www.google.com/*`, `https://google.com/*` (`manifest.json:15-18`).
  - Incognito mode handling set to `split` (`manifest.json:46`).

- Background Service — `background.js` (`seo-extension-/seo-extension-/background.js:2`)
  - Class `SERPBackground` initializes listeners and controls hidden tab lifecycle (`background.js:2-6`, `background.js:19-31`).
  - Shared “our sites” list used to classify results (`background.js:9-17`).
  - Message router `handleMessage` supports:
    - `openPopup`, `extractFromPage`, `extractFromHiddenTab`, `autoExtractResults`, `processAndStoreData`, `getSERPData`, `clearSERPData`, `exportToCSV`, `navigateToPage` (`background.js:33-92`).
  - Hidden window/tab creation with robust incognito handling:
    - `extractFromHiddenTab(pageNum, query, senderTab)` creates tiny off-screen window, waits for load, injects content script, extracts, then closes (`background.js:120-242`).
  - Multi-page auto extraction:
    - `autoExtractResults(query, targetResults, senderTab)` loops through pages until target results collected (`background.js:245-292`).
  - Page URL builder for Google:
    - `buildGoogleSearchUrl(query, pageNum)` (`background.js:295-302`).
  - Content script injection and raw → processed data pipeline:
    - `extractFromPage(tabId, pageNum, query)` executes `content.js` and routes raw data to processing (`background.js:305-336`).
    - `processAndStoreData(rawDataArray, query)` normalizes records and assigns continuous ranks (`background.js:339-375`).
  - Classification utilities:
    - `determineResultType(url, title)` (Social, Vendor Site, Referral, Main Site) (`background.js:378-403`).
    - `determineRankType(url)` (Our Site vs Competitor via domain list) (`background.js:405-411`).
    - `extractExamCode(query, url, title)` removes variation keywords, returns base exam code (`background.js:413-447`).
    - `determineVariation(query, url, title)` returns matching variation keyword or `Null` (`background.js:450-473`).
    - `extractDomain(url)` (`background.js:475-481`), `getCurrentFormattedDate()` (`background.js:483-489`), `generateUniqueKey(url, query)` (`background.js:491-495`), `generateId()` (`background.js:497-499`).
  - Storage operations & CSV:
    - `storeSERPData(newData)` appends unique items, sorts by rank, caps length (`background.js:501-526`).
    - `getSERPData()` (`background.js:528-536`).
    - `clearSERPData()` async storage clear (`background.js:538-545`).
    - `exportToCSV()` builds headered CSV sorted by rank (`background.js:547-590`).
  - Initialization:
    - `new SERPBackground()` bootstraps the service worker (`background.js:593-594`).
  - Note: There are two `clearSERPData` methods defined; the later async definition (`background.js:538-545`) overrides the earlier one (`background.js:94-117`). The message handler calls the effective (later) method.

- Content Script — `content.js` (`seo-extension-/seo-extension-/content.js:1`)
  - Listens for `extractRawData` messages and returns raw item arrays (`content.js:2-18`).
  - `extractRawDataFromPage(pageNumber, query)`:
    - Waits for page load (`content.js:21-28`, `content.js:321-331`).
    - Page‑1 only: extracts “People also search for” keywords and stores globally in `chrome.storage.local` as `globalKeywords` keyed by `keywordsQuery` (`content.js:30-45`).
    - Pages 2+: retrieves stored keywords for consistency (`content.js:46-60`).
    - Uses multiple selectors to robustly find and filter result blocks (`content.js:62-95`, `content.js:344-366`, `content.js:368-372`).
    - Iterates up to 10 valid results per page and collects raw fields (`content.js:97-118`, `content.js:242-318`).
  - `extractPeopleAlsoSearchFor()`:
    - Parses suggestion blocks using specific selectors and heuristics, filters unrelated/noisy entries, returns up to 8 comma‑separated keywords (`content.js:122-235`).
  - Helpers:
    - Rank start calculation via URL `start` param (`content.js:333-342`).
    - Result validity checks (`content.js:374-380`).
    - Location extraction via page spans/footer or URL params (`content.js:382-424`).
    - URL query parsing (`content.js:426-436`).
  - Script gate:
    - Logs when loaded on Google search pages (`content.js:439-441`).

- Popup UI — `popup.html` (`seo-extension-/seo-extension-/popup.html:1`)
  - Full‑screen table layout with sticky headers and responsive adjustments.
  - Controls: Extract, Export CSV, Clear Data; mode selector shows Auto mode (30 results) by default (`popup.html:515-521`, `popup.html:433-449`).
  - Optional/hidden navigation panels prepared for manual multi‑page flows (`popup.html:473-486`, `popup.html:266-306`).
  - Table headers match the processed data fields (`popup.html:526-538`).
  - Inlined styles define header, badges, table, and control appearance (`popup.html:6-424`).

- Popup Logic — `popup.js` (`seo-extension-/seo-extension-/popup.js:1`)
  - Startup & auto‑mode:
    - `getCurrentActiveTab()` robust tab selection with helpful errors (`popup.js:9-25`).
    - `autoExtractOnOpen()` sets auto mode and triggers extraction for 30 results (`popup.js:45-104`).
    - `extractAutoMode()` delegates multi‑page extraction to background and updates UI (`popup.js:526-558`).
  - Manual/single‑page:
    - `extractData()` routes to auto or single page (`popup.js:509-524`).
    - `extractSinglePage()` requests one page from background (`popup.js:561-574`).
  - Data lifecycle:
    - Two `clearData()` functions exist; the later one confirms and resets UI/state (`popup.js:394-418`) and overrides earlier definition (`popup.js:256-282`).
    - `loadStoredData()` populates table from background storage (`popup.js:1006-1025`).
    - CSV:
      - UI button calls `exportToCSV` in early code; later `exportCSV()` builds and triggers blob download and then clears data (`popup.js:285-320`). Align button handler if you adjust naming.
  - UI utilities:
    - `addEnhancedControls()` wires mode toggles and navigation (`popup.js:434-465`).
    - `handleModeChange()` toggles UI panels and labels (`popup.js:467-506`).
    - `optimizeTableForFullScreen()` sizes table container dynamically (`popup.js:420-432`).
    - Status display and URL query helpers (`popup.js:1027-1054`).
  - Note: Duplicate function names (`extractAutoMode`, `clearData`, `handleTargetResultsChange`) appear; in JS the later declaration wins. Keep this in mind when modifying behavior.

- Styles — `styles.css` (`seo-extension-/seo-extension-/styles.css`)
  - Currently empty; styling for the popup is inlined within `popup.html`.

## Data Model
Processed record fields (output of `processAndStoreData`):
```json
{
  "rankPositions": 1,
  "resultLink": "https://example.com/path",
  "targetURL": "example.com",
  "resultType": "Main Site | Social | Vendor Site | Referral",
  "rankType": "Our Site | Competitor",
  "date": "19 Dec 2025",
  "examCode": "az-900",
  "variation": "exam dumps | questions | pdf | Null",
  "location": "Desktop | <extracted city/region>",
  "title": "Result title",
  "snippet": "Result snippet excerpt",
  "keywords": "comma, separated, suggestions",
  "query": "original search query",
  "extractedAt": "2025-12-19T10:00:00.000Z",
  "id": "<unique id>",
  "uniqueKey": "<normalized_url>|<query>"
}
```
- Ranking is continuous across pages:
  - Highest existing rank is found, then new items are assigned incrementally (`background.js:339-371`).
- Storage:
  - `chrome.storage.local.set({ serpData: ... })` for records (`background.js:520-521`).
  - `globalKeywords` and `keywordsQuery` cached in content script for subsequent pages (`content.js:37-41`, `content.js:48-56`).
  - `lastQuery` used by popup for continuity (`popup.js:91-93`, `popup.js:142-144`).

## Message Flows
Popup/UI → Background (`chrome.runtime.sendMessage`):
- `extractFromPage` with `tabId`, `pageNum`, `query` → background injects `content.js` and processes results (`background.js:305-336`).
- `autoExtractResults` with `query`, `targetResults` → background loops pages using hidden windows (`background.js:245-292`).
- `getSERPData` → background returns stored results (`background.js:528-536`).
- `clearSERPData` → background clears storage (async override) (`background.js:538-545`).
- `exportToCSV` → background returns CSV string (`background.js:547-590`).

Background → Content (`chrome.tabs.sendMessage`):
- `extractRawData` instructs content script to scrape current page (`background.js:315-326`, `content.js:2-18`).

## Permissions and Incognito
- Permissions:
  - `activeTab`, `tabs`, `windows`: used to query tabs, create hidden windows, and control navigation (`manifest.json:7-13`).
  - `scripting`: injects `content.js` into tabs (`background.js:308-311`).
  - `storage`: persists results and cross‑page keywords (`background.js:341-343`, `content.js:37-41`, `popup.js:91-93`).
- Incognito:
  - `incognito: "split"` isolates contexts.
  - Hidden windows honor sender’s incognito context; incognito flag added only when needed; graceful fallback on failure (`background.js:134-171`, `background.js:172-184`).

## Usage Flow (Step‑By‑Step)
- Open Google search results in a tab.
- Open the extension popup:
  - Auto mode is the default; it triggers a background extraction up to the selected target (default 30).
- Data appears in the table with columns:
  - Rank Position, Result Link, Target URL, Result Type, Rank Type, Date, Exam Code, Variation, Location, Keywords (`popup.html:526-538`).
- Export:
  - Click Export CSV; a file is generated and downloaded; table may be cleared afterward (depending on which export function is wired).
- Clear:
  - Click Clear Data to reset UI and storage across both popup and background.

## Development Guidance
- Add new result types/rank logic:
  - Update `determineResultType` / `determineRankType` (`background.js:378-411`).
- Adjust selectors for scraping:
  - Tune `searchSelectors`, link/title/snippet selectors (`content.js:62-69`, `content.js:248-253`, `content.js:280-293`, `content.js:294-305`).
- Change ranking:
  - Modify continuous rank calculation in `processAndStoreData` (`background.js:339-371`).
- Expand CSV:
  - Edit headers and row mapping in `exportToCSV` (`background.js:562-585`).
- UI tweaks:
  - Update `popup.html` styles/layout; or extract styles to `styles.css`.
- Duplicated functions:
  - `popup.js` defines duplicates (e.g., `extractAutoMode`, `clearData`, `handleTargetResultsChange`); the final declaration overrides earlier ones. If consolidating, remove earlier versions and keep a single source of truth.
- MV3 notes:
  - The background `service_worker` is event‑driven. Avoid relying on long‑running state in memory; persist necessary data in `chrome.storage`.

## Known Limitations and Considerations
- Google SERP markup changes frequently; selectors may need maintenance.
- Extraction caps at top 10 results per page (by design in `content.js`), so total results depend on page iteration.
- Hidden window creation can fail in certain environments; code retries without incognito flag (`background.js:172-184`).
- Some popup functions reference different export methods; ensure UI wiring aligns with the intended export path.

## How to Resume Development
- Load the extension from `seo-extension-/seo-extension-`.
- Run manual tests:
  - Try single‑page and auto extraction.
  - Verify CSV export and data clearing.
- Plan enhancements:
  - Normalize function duplication in `popup.js`.
  - Migrate inline styles to `styles.css` as needed.
  - Add unit or integration tests via a lightweight harness if desired (not present currently).

## File Reference Index
- `seo-extension-/seo-extension-/manifest.json:1` — Extension manifest and permissions.
- `seo-extension-/seo-extension-/background.js:2` — Background service class and router.
- `seo-extension-/seo-extension-/content.js:1` — Content script, DOM scraping, and keyword logic.
- `seo-extension-/seo-extension-/popup.html:1` — Popup UI structure and styles.
- `seo-extension-/seo-extension-/popup.js:1` — Popup logic, event handlers, and data management.
- `seo-extension-/seo-extension-/icons/*` — Extension icons.

