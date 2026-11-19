# Leaderboard TV (leaderboard.lgcyap.com)

`https://leaderboard.lgcyap.com/` shows the CRM Leaderboard full screen for office TVs. It is part of this app, using the same data, sign-in rules and Vercel project as the CRM. The domain's root is rewritten to `/leaderboard-tv`.

## On a TV

1. Open `https://leaderboard.lgcyap.com/` in the TV's browser.
2. Sign in with an approved Google account when asked. Sign-in happens on crm.lgcyap.com, then the TV returns to the leaderboard.
3. Press **F** or double-click for full screen.

The TV stays signed in for up to 12 hours, or less if that CRM session ends sooner. Signing out of the CRM, or the session expiring, ends it. When that happens the screen shows a **Sign in** button.

Keys: **→ / ←** change boards, **Space** pauses the rotation, **F** toggles full screen. The cursor hides when the mouse is still, and the screen is kept awake where the browser allows it.

## What it shows

Each slide shows one board and period:

- the board's totals, the same figures as the CRM Leaderboard;
- the top agents ranked by premium, with policies or sales beside each.

By default it rotates Standard vs. Preferred, Shopper and WhatsApp Sales for **Today**, every 20 seconds. Each board is re-read at most every five minutes, one at a time, so several TVs stay light on HubSpot and PolicyTek.

Options go in the link:

| Option | Values | Default |
| --- | --- | --- |
| `boards` | any of `sp`, `shopper`, `source`, `whatsapp` | `sp,shopper,whatsapp` |
| `periods` | any of `day`, `week`, `month` | `day` |
| `seconds` | seconds per slide, 8–300 | `20` |
| `rows` | agents per slide, 5–15 | `10` |

Example: `https://leaderboard.lgcyap.com/?boards=sp,shopper&periods=day,month&seconds=30`.

## Security

This follows the queue.lgcyap.com design (`lib/queue-host.mjs`), in `lib/leaderboard-host.mjs`:

- Google OAuth stays on crm.lgcyap.com. `/leaderboard-access` verifies the CRM session and the approved-employee rule. It then copies that same signed session into `__Secure-lgcy-leaderboard.session_token` on `lgcyap.com`: HttpOnly, Secure, SameSite=Lax, at most 12 hours.
- No token or identity ever goes in a URL.
- Only requests to the exact host `leaderboard.lgcyap.com` read that cookie. The CRM and Queue cookies are unaffected.
- `/api/leaderboard` accepts the exact `https://leaderboard.lgcyap.com` origin, as well as the CRM's own.
- Tests: `tests/leaderboard-host.test.mjs` and the Leaderboard case in `tests/auth-integration.test.mjs`, which uses real Better Auth sessions.

## Domain

`leaderboard.lgcyap.com` must be added to the Vercel project `legacy-recruiting-private`. lgcyap.com uses Vercel DNS, so no separate DNS record is needed.
