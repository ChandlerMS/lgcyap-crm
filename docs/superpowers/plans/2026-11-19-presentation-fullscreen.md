# Presentation and full-screen workspace plan

User wants QR Code Sign-in renamed QR Code Presentation, first in the Recruits flyout, opening https://comp.lgcyagent.com/#1. embedded in a large iframe. Also provide small gold up/down controls on every CRM workspace page that hide the sidebar and title/top bar and restore them.

- Add fixed presentation destination and route, convert its flyout entry to an internal link, put it before Sign-In and the recruiting pages. Keep the external Sign-In link.
- Give the presentation a full-width viewport-sized frame with no forced desktop min-height or cropping; allow the service's own scrolling and fullscreen capability.
- Add shared CSS-based workspace full-screen view, with controls outside hidden/inert chrome, closing mobile menus/flyouts on entry, retaining mounted iframes and other page state, and restoring measured title-bar offsets. Keep the control accessible and visible across hash routes. Do not change browser/OS fullscreen.
- Verify menu order/route/iframe rendering and full-screen interactions, keyboard restoration, iframe preservation, mobile menu state and layout offsets. Run relevant checks, build, independent review, integrate main and publish via Git integration.

Implementation uses the existing Next/React shell and iframe infrastructure. The user supplied the final URL and precise interaction, so no additional design choice is needed. The third-party site controls whether it permits framing; check that where available without bypassing its policy.

Verification: all 930 tests passed after integrating the presentation and shared view controls. TypeScript, focused ESLint, production Next build/bundle checks, and independent review passed. Interaction checks cover retained iframe/form state, mobile menu cleanup, sidebar preference restoration, title-bar remeasurement, hash navigation and Escape behavior. The external presentation's live framing was not verified because browser control was unavailable and its host could not be fetched from the execution environment; no third-party security policy was bypassed.
