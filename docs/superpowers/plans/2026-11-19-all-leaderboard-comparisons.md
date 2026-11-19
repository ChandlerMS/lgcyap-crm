# All leaderboard and WhatsApp comparisons

User asks for All before Shopper on Leaderboard, combining Shopper/PolicyTek and Standard vs Preferred/HubSpot, preserving Daily/Weekly/Monthly/Custom and policies sold/annual premium. WhatsApp Sales retains All and Standard vs Preferred, then adds vs HubSpot (SP vs WhatsApp SP), vs PolicyTek (Shopper vs WhatsApp SP, explicitly requested), and vs All (combined Leaderboard All vs WhatsApp All).

Evidence: existing sources expose aggregate agent rows, not cross-system policy IDs. All adds existing board totals rather than asserting deduplicated policies. PolicyTek agency report totals may differ from named rows and must remain authoritative for toplines. Money sums in cents; rates are ratios of summed numerators/denominators, not averages. Agent names join by Unicode normalization, case and whitespace only, with no fuzzy aliases; unnamed rows remain source-specific. Missing values and missing sources never become zero. Calls/leads have different source bases; identify the mixed activity denominator rather than presenting a new homogeneous call metric.

Current main 33a1686 supplies a separate whatsapp-sp board with unavailable/awaiting-import status. Preserve that distinction. Build requested comparison views with the available side visible and unavailable side clearly identified until imports exist.

- Backend isolated: all board validation, combined source reader, exact shared Eastern date bounds, additive row metrics, report-level combined totals, preserved source statuses/freshness/partial coverage, unit tests.
- Coordinator: common All metrics/ranking/CSV support plus aligned comparison data/CSV helpers and focused reconciliation/null/identity tests.
- Frontend isolated: All tab and five WhatsApp tabs; shared date/metric/search/sort controls; side-by-side source totals and agent comparisons with shared magnitude scales, loading/error/stale guards, responsive styles, source notes and interaction tests.
- Integrate, independently review arithmetic/privacy/access/source fidelity, verify relevant/full tests, typecheck/lint/build; fetch latest main and publish via existing Git integration. Do not send messages, change source data, or deploy another app.
