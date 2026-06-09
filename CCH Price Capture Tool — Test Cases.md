# CCH Price Capture Tool — Test Cases

Generated from source code analysis. Each case includes the expected result and the code path it exercises.

---

## 1. Order Price Calculation

### TC-OPC-01 — KG line: Order Price = Net weight × Rate
- **Setup:** Line with `Base_UOM = "Y"` (maps to KG), Net weight = 200 kg, Rate entered = 32.50
- **Expected:** Order Price = 200 × 32.50 = **6 500.00**
- **Code:** `displayLineUom` → `isWeightBased`, `ReceiptLineEditor.displayTotal`

### TC-OPC-02 — KG line via BSKG Base_UOM
- **Setup:** `Base_UOM = "BSKG"`, Net weight = 50 kg, Rate = 10.00
- **Expected:** Order Price = 50 × 10.00 = **500.00** (BSKG maps to KG)
- **Code:** `displayLineUom`

### TC-OPC-03 — Non-KG line: Order Price = Quantity × Rate
- **Setup:** `Base_UOM = "BSCS"`, `Unit_Of_Measure = "CTN"`, Quantity = 10, Rate = 45.00
- **Expected:** Order Price = 10 × 45.00 = **450.00**
- **Code:** `displayLineUom` returns UOM for BSCS, `isWeightBased = false`

### TC-OPC-04 — EA line: Order Price = Quantity × Rate
- **Setup:** `Unit_Of_Measure = "EA"`, Quantity = 50, Rate = 3.20
- **Expected:** Order Price = 50 × 3.20 = **160.00**

### TC-OPC-05 — Order Price rounded to 2 decimal places
- **Setup:** Net weight = 33.333 kg, Rate = 3.00
- **Expected:** Order Price = **100.00** (not 99.999)
- **Code:** `round2()`

### TC-OPC-06 — Total row sums all line Order Prices
- **Setup:** 3 lines: KG 200 kg × R32.50, KG 50 kg × R10.00, EA 50 × R3.20
- **Expected:** Total Order Price = 6 500 + 500 + 160 = **7 160.00**
- **Code:** `ReceiptEditor` totals block

### TC-OPC-07 — Total excludes lines with no rate
- **Setup:** 2 lines, only one has a rate entered
- **Expected:** Total Order Price = price of the one completed line only; the other shows "—"

---

## 2. Rate Entry (ReceiptLineEditor)

### TC-RE-01 — Comma accepted as decimal separator
- **Setup:** User types "32,50" in rate field
- **Expected:** Committed as 32.50; Order Price calculates correctly
- **Code:** `tryParseRateDraft` → `.replace(",", ".")`

### TC-RE-02 — In-progress decimal not forced to round2 mid-typing
- **Setup:** User types "24.0" (trailing zero)
- **Expected:** Draft stays "24.0" while focused; committed as 24.00 on blur
- **Code:** `formatRateFromNumber` only runs on blur/Enter

### TC-RE-03 — Non-numeric input reverts to previous rate on blur
- **Setup:** Rate is 32.50, user types "abc" then blurs
- **Expected:** Field reverts to "32.5" (previous committed value)
- **Code:** `commitDraft` → `Number.isNaN(r)` → `setDraft(formatRateFromNumber(rate))`

### TC-RE-04 — Clearing rate field sets Order_Price to null
- **Setup:** Rate is 32.50, user clears the field then blurs
- **Expected:** `onOrderPriceChange(null)` called; Order Price shows "—"
- **Code:** `commitDraft` empty-string branch

### TC-RE-05 — Enter key commits the rate
- **Setup:** User types "45.00" then presses Enter
- **Expected:** Rate committed, same as blur behaviour
- **Code:** `onKeyDown` → `blur()`

### TC-RE-06 — Rate field not updated from parent while focused
- **Setup:** User is mid-edit in rate field; parent receives new payload
- **Expected:** Draft value preserved (no overwrite); `focusedRef.current = true` guards the effect
- **Code:** `useEffect([rate, rowKey])` guarded by `focusedRef`

### TC-RE-07 — Averaged rate shown with asterisk
- **Setup:** Two sub-lines with different rates (e.g. 30.00 and 34.00); grouped together
- **Expected:** Displayed rate = 32.00 (average), asterisk (*) shown, footnote "Average of line prices captured" appears
- **Code:** `ReceiptEditor.displayRows` → `rateIsAveraged`, footnote render

### TC-RE-08 — Rate read-only when foreign session lock active
- **Setup:** `foreignSessionLockActive = true`
- **Expected:** Rate field replaced by read-only span; title tooltip shows lock message
- **Code:** `rateReadOnly = foreignSessionLockActive`, `ReceiptLineEditor` read-only branch

---

## 3. Post to ERP Validation

### TC-POST-01 — Post button disabled when any line has no rate
- **Setup:** Receipt with 3 lines; one line has `Order_Price = null`
- **Expected:** Post button disabled; title "Enter a rate (R/UOM) on every line."
- **Code:** `hasMissingOrderPrice`, `canPost = !needsPrice && ...`

### TC-POST-02 — Post button disabled when any rate = 0 or negative
- **Setup:** One line with `Order_Price = 0`
- **Expected:** Post button disabled; title "Every rate must be greater than 0."
- **Code:** `hasInvalidOrderPrice`

### TC-POST-03 — ZERO-OUT-LINE items excluded from validation
- **Setup:** Receipt has one normal line (rate entered) and one line with `Item_Code = "ZERO-OUT-LINE"` (no rate)
- **Expected:** Post button enabled — ZERO-OUT-LINE not validated
- **Code:** `isZeroOutLine` check in `hasMissingOrderPrice` and `hasInvalidOrderPrice`

### TC-POST-04 — Post requires confirmation text "Y"
- **Setup:** All rates valid; user types "n" in confirmation dialog
- **Expected:** Post cancelled; warning alert shown; ERP not called
- **Code:** `postConfirmText.trim().toUpperCase() !== "Y"`

### TC-POST-05 — Post confirmation case-insensitive ("y" accepted)
- **Setup:** User types "y" (lowercase)
- **Expected:** Post proceeds normally

### TC-POST-06 — Post blocked when foreign session lock active
- **Setup:** `foreignSessionLockActive = true`; user clicks Post
- **Expected:** Warning alert "Another tab may be editing…"; ERP not called
- **Code:** Early return in `handlePost`

### TC-POST-07 — Receipt removed from list after successful post
- **Setup:** Post succeeds
- **Expected:** Success message shown; receipt removed from orders list; "OK — load next receipt" button appears
- **Code:** `onPostSuccess` → `setOrders(prev => prev.filter(...))`

### TC-POST-08 — Error message shown on post failure
- **Setup:** `postToErp` returns `{ ok: false, errorDetail: "ERP error" }`
- **Expected:** Error banner shown in editor; alert fired via Flowgear SDK
- **Code:** `result.ok === false` branch

---

## 4. Order List Filtering

### TC-FLT-01 — Company filter is case-insensitive partial match
- **Setup:** Orders contain companies "CCH Logistics" and "Acme Corp"; filter = "cch"
- **Expected:** Only "CCH Logistics" shown
- **Code:** `filterReceiptOrders` → `company.toLowerCase().includes(fc)`

### TC-FLT-02 — Probill filter partial match
- **Setup:** Probills "PB-991", "PB-992"; filter = "992"
- **Expected:** Only "PB-992" shown

### TC-FLT-03 — Receipt No filter partial match
- **Setup:** Receipt nos "RCV-001", "RCV-002"; filter = "001"
- **Expected:** Only "RCV-001" shown

### TC-FLT-04 — Date From filter excludes earlier orders
- **Setup:** Orders on 2024-01-10 and 2024-03-15; From date = 2024-02-01
- **Expected:** Only 2024-03-15 order shown; 2024-01-10 excluded
- **Code:** `utcDayFromIsoTimestamp`, `orderDay < fromDay`

### TC-FLT-05 — Date To filter excludes later orders
- **Setup:** Orders on 2024-01-10 and 2024-03-15; To date = 2024-02-01
- **Expected:** Only 2024-01-10 order shown

### TC-FLT-06 — Orders with no date pass through date filter
- **Setup:** Order has no Date_Details; From/To date filter active
- **Expected:** Order with no date is **not** excluded (passes through)
- **Code:** `if (orderDay == null) return true`

### TC-FLT-07 — Date filter uses calendar day (UTC), not timestamp
- **Setup:** Order date = "2024-03-15T22:00:00+02:00"; From date = 2024-03-15
- **Expected:** Order included (UTC day matches)
- **Code:** `utcDayFromIsoTimestamp` → `Date.UTC(year, month, day)`

### TC-FLT-08 — Lock user filter "Mine" matches current user
- **Setup:** Two orders: one locked to "jsmith", one to "mjones"; current user = "jsmith"; filter = Mine
- **Expected:** Only jsmith's order shown
- **Code:** `LOCK_USER_FILTER_MINE`, `lockUsersMatch`

### TC-FLT-09 — Lock user filter "Mine" shows nothing while user unresolved
- **Setup:** Current user not yet resolved (empty string); filter = Mine only
- **Expected:** No filtering applied (all orders shown) until user identity resolves
- **Code:** `onlyMineWhileUnresolved` guard

### TC-FLT-10 — Multiple lock users selected (OR logic)
- **Setup:** Filter selects "jsmith" and "mjones"; orders locked to jsmith, mjones, and kpatel
- **Expected:** Orders for jsmith and mjones shown; kpatel excluded
- **Code:** `rowMatch = true; break` on first matching selection

### TC-FLT-11 — Order count badge shows filtered / total
- **Setup:** 45 orders loaded; 16 match current filters
- **Expected:** Badge shows "16 / 45"
- **Code:** `OrderListPanel` badge — `orders.length !== totalLoadedCount`

### TC-FLT-12 — Order count badge shows single number when no filter active
- **Setup:** 45 orders loaded; no filters active
- **Expected:** Badge shows "45" only (no slash)

### TC-FLT-13 — "Clear filters" button only visible when filters are active
- **Setup:** All filter fields empty
- **Expected:** Clear filters button not rendered
- **Code:** `hasActiveFilters` gate in both `OrderFiltersBar` and `OrderListPanel`

---

## 5. Date Sorting

### TC-SORT-01 — Default sort is ascending (oldest first)
- **Setup:** Orders on 2024-01-01, 2024-06-15, 2024-03-10; no sort toggle applied
- **Expected:** Order: Jan → Mar → Jun
- **Code:** `listDateSortDesc = false`, `compareReceiptOrdersByDetailDate(..., "asc")`

### TC-SORT-02 — Toggle to descending (newest first)
- **Setup:** Same orders; user clicks Date header
- **Expected:** Order: Jun → Mar → Jan

### TC-SORT-03 — Orders with no date appear last in both directions
- **Setup:** Orders on 2024-01-01, 2024-06-15, and one with no date
- **Expected:** No-date order always last regardless of sort direction
- **Code:** `aMiss → return 1`, `bMiss → return -1`

### TC-SORT-04 — Same-date orders sorted by Reference No (numeric)
- **Setup:** Two orders on same date, refs "REF-9" and "REF-10"
- **Expected:** REF-9 before REF-10 (numeric collation, not lexicographic)
- **Code:** `localeCompare(..., { numeric: true })`

### TC-SORT-05 — Prefers Date_Identifier "RD" over other date entries
- **Setup:** Order has two dates: `Date_Identifier = "SD"` (2024-01-01) and `"RD"` (2024-06-15)
- **Expected:** 2024-06-15 used for sorting
- **Code:** `getReceiptDetailDateForFilter` → `dates.find(d => d.Date_Identifier === "RD")`

---

## 6. Hold Code Details

### TC-HC-01 — Toggle disabled when no item+lot has multiple hold codes
- **Setup:** All lines on receipt have a single hold code per item+lot group
- **Expected:** "Show Hold Code details" checkbox is disabled (greyed out)
- **Code:** `hasDistinctHoldCodesPerItemLot` returns false

### TC-HC-02 — Toggle enabled when one item+lot has 2+ hold codes
- **Setup:** Same item code + lot appears on two lines with hold codes "AV" and "HLD"
- **Expected:** Checkbox is enabled
- **Code:** `hasDistinctHoldCodesPerItemLot` returns true

### TC-HC-03 — ZERO-OUT-LINE items excluded from hold code detection
- **Setup:** ZERO-OUT-LINE item has multiple hold codes
- **Expected:** Does not enable the toggle
- **Code:** `isZeroOutLine` check inside `hasDistinctHoldCodesPerItemLot`

### TC-HC-04 — Hold code view splits rows by hold code
- **Setup:** Two lines: same item + lot, hold codes "AV" and "HLD"; toggle turned on
- **Expected:** Two rows shown in table (one per hold code); Hold Code column visible
- **Code:** `groupReceiptItemsForDisplay({ includeHoldCode: true })`

### TC-HC-05 — Rate fields are read-only in hold code view
- **Setup:** Hold code toggle is on
- **Expected:** Rate inputs replaced by read-only spans; tooltip explains rates must be entered with toggle off
- **Code:** `ratesBlockedForHoldView = showHoldCodeDetails`; `rateReadOnly` prop

### TC-HC-06 — Rates entered with toggle off; turning on shows same rates
- **Setup:** Rate of 32.50 entered for item+lot group with hold code toggle off; toggle turned on
- **Expected:** Both split rows show 32.50 (read-only); rate is shared by the group
- **Code:** `groupReceiptItemsForDisplay` consolidation key without hold code for rate entry

### TC-HC-07 — Toggle auto-disables when hold code info disappears
- **Setup:** Toggle is on; order changes to one with no multi-hold-code lines
- **Expected:** Toggle turns off automatically
- **Code:** `useEffect` → `if (!hasHoldCodeExtraInfo && showHoldCodeDetails) setShowHoldCodeDetails(false)`

---

## 7. Line Grouping / Consolidation

### TC-GRP-01 — Lines with same item code and lot are grouped
- **Setup:** Lines 10 and 20 both have Item_Code "CHKN" and Inventory_Level3 "10KG"
- **Expected:** Single row showing combined Qty and Net weight; Line column shows "10, 20"
- **Code:** `getReceiptLineConsolidationKey`, `groupReceiptItemsForDisplay`

### TC-GRP-02 — Lines with different items are not grouped
- **Setup:** Line 10: ITEM-001, Line 20: ITEM-002
- **Expected:** Two separate rows

### TC-GRP-03 — Lines with same item but different lots are not grouped
- **Setup:** Both ITEM-001, but Inventory_Level3 = "10KG" vs "5KG"
- **Expected:** Two separate rows

### TC-GRP-04 — ZERO-OUT-LINE excluded from all display rows
- **Setup:** Receipt has 2 normal lines + 1 ZERO-OUT-LINE
- **Expected:** Table shows 2 rows only; totals exclude the ZERO-OUT-LINE
- **Code:** `visibleItems = items.filter(item => !isZeroOutLine(item))`

### TC-GRP-05 — Lines sorted numerically within a group
- **Setup:** Group contains lines "30", "10", "20"
- **Expected:** Displayed as "10, 20, 30"
- **Code:** `compareReceiptLineNoAsc` → `localeCompare({ numeric: true })`

### TC-GRP-06 — Pipe-separated merged fields use first consistent segment
- **Setup:** `Attribute_1 = "150526|150526"` (all same)
- **Expected:** Displays as "150526"
- **Code:** `normalizeReceiptMergedField` → all segments equal → return first

### TC-GRP-07 — Pipe-separated with differing segments uses first segment
- **Setup:** `Attribute_1 = "150526|999999"` (different)
- **Expected:** Displays as "150526"
- **Code:** `normalizeReceiptMergedField` → not all equal → return `parts[0]`

---

## 8. Session Locking (Tab Lock)

### TC-LOCK-01 — First tab acquires lock
- **Setup:** No existing lock in localStorage; tab A calls `tryAcquireReceiptLock`
- **Expected:** Returns `true`; lock entry written with tab A's ID

### TC-LOCK-02 — Second tab blocked by active lock
- **Setup:** Tab A holds lock (fresh timestamp); tab B calls `tryAcquireReceiptLock`
- **Expected:** Returns `false`

### TC-LOCK-03 — Stale lock (> 120 s) can be taken over
- **Setup:** Lock entry timestamp is 121 000 ms ago; tab B calls `tryAcquireReceiptLock`
- **Expected:** Returns `true`; lock re-assigned to tab B
- **Code:** `now - entry.ts < STALE_MS` (STALE_MS = 120 000)

### TC-LOCK-04 — Tab can re-acquire its own lock
- **Setup:** Tab A already holds lock; calls `tryAcquireReceiptLock` again
- **Expected:** Returns `true`; timestamp refreshed

### TC-LOCK-05 — `releaseReceiptLock` only removes own lock
- **Setup:** Tab A holds lock; tab B calls `releaseReceiptLock`
- **Expected:** Lock entry not removed (tabId mismatch)

### TC-LOCK-06 — Lock gracefully degrades when storage unavailable
- **Setup:** localStorage throws (sandboxed iframe)
- **Expected:** `tryAcquireReceiptLock` returns `true` (no exclusion, editing allowed)
- **Code:** `if (!storage) return true`

### TC-LOCK-07 — Server lock by another user blocks rate editing
- **Setup:** `selectedOrder.currentLockUser = "mjones"`; current user = "jsmith"
- **Expected:** Yellow warning banner shown; rate fields read-only; Post button disabled
- **Code:** `serverLockedByOther = true`, `foreignSessionLockActive = true`

### TC-LOCK-08 — Server lock by same user does not block
- **Setup:** `currentLockUser = "jsmith"`; current user = "jsmith"
- **Expected:** No banner; editing allowed
- **Code:** `lockUsersMatch(locker, me)` returns true

### TC-LOCK-09 — Domain-prefixed username matches bare username
- **Setup:** Lock user = "DOMAIN\\jsmith"; current user = "jsmith"
- **Expected:** Treated as same user (lock not blocked)
- **Code:** `normalizeLockUserLabel` → replace `\\` with `/`; `x.endsWith(`/${y}`)`

### TC-LOCK-10 — Navigating to new order releases server lock (no rate edits)
- **Setup:** Order A has server lock (no rate edits made); user selects order B
- **Expected:** `setReceiptNoPriceLock({ dashboardId: A, username: null })` called (release)
- **Code:** `useEffect` on `selectedOrder`; `hadRateEdits = false` branch

### TC-LOCK-11 — Navigating away does NOT release lock when rates were edited
- **Setup:** Rate edited on order A (sets `rateEditFlagsRef`); user selects order B
- **Expected:** Server lock on A NOT released (pending save/post)
- **Code:** `if (hadRateEdits) { delete rateEditFlagsRef...; return; }`

---

## 9. Lock User Username Normalisation

### TC-USER-01 — Matching is case-insensitive
- **Setup:** `lockUsersMatch("JSmith", "jsmith")`
- **Expected:** `true`

### TC-USER-02 — Empty strings never match
- **Setup:** `lockUsersMatch("", "jsmith")`
- **Expected:** `false`

### TC-USER-03 — Domain prefix (backslash) normalised to forward slash
- **Setup:** `lockUsersMatch("DOMAIN\\jsmith", "jsmith")`
- **Expected:** `true` (normalized to `domain/jsmith`, ends with `/jsmith`)

### TC-USER-04 — Unrelated users do not match
- **Setup:** `lockUsersMatch("jsmith", "mjones")`
- **Expected:** `false`

---

## 10. Gross Price / Order Price Normalisation

### TC-NORM-01 — Gross_Price (line total) converted to rate on load (KG)
- **Setup:** `Gross_Price = 6500`, Net weight = 200 kg, UOM = KG
- **Expected:** `Order_Price` normalised to **32.50** (rate per kg)
- **Code:** `normalizePayloadOrderPriceToRate` → `gross / net`

### TC-NORM-02 — Order_Price (line total) used when no Gross_Price (non-KG)
- **Setup:** `Gross_Price = null`, `Order_Price = 450`, Quantity = 10, UOM = CTN
- **Expected:** `Order_Price` normalised to **45.00** (rate per unit)
- **Code:** `else if (total != null && total > 0)`

### TC-NORM-03 — Zero Gross_Price falls back to Order_Price
- **Setup:** `Gross_Price = 0`, `Order_Price = 450`, Quantity = 10
- **Expected:** Falls through to Order_Price branch; rate = 45.00
- **Code:** `if (gross != null && gross > 0)` is false

### TC-NORM-04 — Zero quantity/weight yields null rate (no division)
- **Setup:** KG line, `Net_Weight_Shipped = 0`
- **Expected:** `Order_Price` set to `null` (avoid divide-by-zero)
- **Code:** `if (byWeight && net > 0)` condition

---

## 11. UOM Display Logic

### TC-UOM-01 — Base_UOM "Y" → displays "KG"
- **Setup:** `Base_UOM = "Y"`
- **Expected:** UOM column shows "KG"; line is weight-based

### TC-UOM-02 — Base_UOM "BSKG" → displays "KG"
- **Expected:** Same as TC-UOM-01

### TC-UOM-03 — Base_UOM "BSCS" → displays Unit_Of_Measure
- **Setup:** `Base_UOM = "BSCS"`, `Unit_Of_Measure = "CTN"`
- **Expected:** UOM column shows "CTN"

### TC-UOM-04 — Other Base_UOM → displays Unit_Of_Measure if set
- **Setup:** `Base_UOM = "EA"`, `Unit_Of_Measure = "EA"`
- **Expected:** "EA"

### TC-UOM-05 — Falls back to Base_UOM if Unit_Of_Measure empty
- **Setup:** `Base_UOM = "BOX"`, `Unit_Of_Measure = ""`
- **Expected:** "BOX"

---

## 12. Tour Overlay

### TC-TOUR-01 — Auto-shows on first load when storage available and flag not set
- **Setup:** localStorage accessible; `cch-receipt-tour-v1` not set
- **Expected:** Tour opens automatically on app load

### TC-TOUR-02 — Does NOT auto-show when storage is unavailable (sandboxed iframe)
- **Setup:** localStorage and sessionStorage both throw
- **Expected:** Tour does NOT open automatically; Help button still works
- **Code:** `isStorageAvailable() && !isTourCompleted()`

### TC-TOUR-03 — Does NOT auto-show after tour has been seen
- **Setup:** `cch-receipt-tour-v1 = "1"` in storage
- **Expected:** Tour does not open on load

### TC-TOUR-04 — Flag written immediately on tour mount
- **Setup:** Tour opens; storage available
- **Expected:** `cch-receipt-tour-v1 = "1"` written before user interacts
- **Code:** `useEffect(() => markTourCompleted(), [])`

### TC-TOUR-05 — Help button always opens tour regardless of flag
- **Setup:** Tour already completed; user clicks ? Help
- **Expected:** Tour opens from step 1

### TC-TOUR-06 — Keyboard navigation: right arrow / Enter advances step
- **Setup:** Tour open on step 1
- **Expected:** Arrow Right / Enter moves to step 2

### TC-TOUR-07 — Keyboard navigation: Escape closes tour
- **Expected:** Tour dismissed

### TC-TOUR-08 — Skip tour link closes on welcome step
- **Setup:** Tour on step 1 (Welcome)
- **Expected:** "Skip tour" link visible; clicking it closes and marks completed

### TC-TOUR-09 — Tour has 11 steps total
- **Expected:** Step indicator shows "1 / 11" through "11 / 11"

### TC-TOUR-10 — Spotlight targets missing element gracefully
- **Setup:** Tour step targets `receipt-header` but no receipt is loaded yet
- **Expected:** Tooltip centres on screen without a spotlight box; no error thrown
- **Code:** `el == null → setRect(null)`; `computeTooltipStyle(null, ...)` → center

---

## 13. App Initialisation

### TC-INIT-01 — Orders loaded automatically on mount
- **Setup:** App loads (embedded in Flowgear Console)
- **Expected:** `getOrdersList()` called immediately without user clicking Refresh
- **Code:** `useEffect(() => void loadOrders(), [loadOrders])`

### TC-INIT-02 — Auth failure shows red banner
- **Setup:** `getOrdersList` throws `AuthError`
- **Expected:** "Not signed in or session expired" banner shown
- **Code:** `setAuthFailed(true)`

### TC-INIT-03 — Connection failure shows red banner
- **Setup:** `getOrdersList` throws `ConnectionError`
- **Expected:** "No response from Flowgear" banner shown

### TC-INIT-04 — Non-embedded app shows orange warning banner
- **Setup:** `isEmbeddedInConsole()` returns false
- **Expected:** Orange "must be opened from Flowgear Console" banner shown

### TC-INIT-05 — First order auto-selected after list loads
- **Setup:** 3 orders returned
- **Expected:** First order (index 0) selected automatically in the list

### TC-INIT-06 — Selection resets to 0 when filters reduce list
- **Setup:** Order at index 3 selected; filter applied that reduces list to 2 items
- **Expected:** Selected index clamped to 0

---

## 14. Left Panel Collapse

### TC-PANEL-01 — Collapsed state persisted in localStorage
- **Setup:** User collapses left panel
- **Expected:** `cch-receipt-orders-panel-collapsed = "1"` written; panel stays collapsed on next load

### TC-PANEL-02 — Expand restores panel and clears storage flag
- **Setup:** Panel collapsed; user clicks toggle
- **Expected:** Panel visible; storage value set to "0"

---

## 15. Payload Viewer

### TC-PAY-01 — Base64-encoded JSON decoded and pretty-printed
- **Setup:** `targetPayloadBase64` contains base64 of `{"foo":"bar"}`
- **Expected:** Payload viewer shows formatted JSON

### TC-PAY-02 — Source payload view only shown when source base64 provided
- **Setup:** `sourcePayloadBase64 = null`
- **Expected:** "View source payload" button not rendered

### TC-PAY-03 — Side-by-side diff shown when both payloads visible
- **Setup:** Both target and source payload views toggled on; source differs from target
- **Expected:** `PayloadDiffComparePanes` renders line diff

### TC-PAY-04 — Copy to clipboard button available for each payload
- **Setup:** Target payload view open
- **Expected:** "Copy target JSON" button present; clicking it calls `navigator.clipboard.writeText`

---

*Last updated: v3.1.0.0*
