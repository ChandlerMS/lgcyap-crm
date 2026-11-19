# Knowledge base theme

The public HubSpot knowledge base at https://50894788.hs-sites.com/legacy-partners-knowledge uses the CRM's look (dark canvas, gold accents, left sidebar). Its only source is [`legacy-crm-theme.css`](legacy-crm-theme.css).

HubSpot does not allow custom, cloned or child themes for knowledge bases, so the theme is a stylesheet added through the knowledge base's header HTML. It only restyles: URLs, search, the support form, the customer portal, article feedback, related articles, chat and tracking all stay HubSpot's own.

## Where it lives in HubSpot

Settings > Content > Knowledge Base > **Template** tab > Custom HTML > **Knowledge base pages header HTML** (the first of six code fields; the other five stay empty).

That field holds one minified `<style id="legacy-crm-theme">…</style>`. It applies to the home, category, article, support form and search results pages of this knowledge base only. Other HubSpot pages on the domain, including the customer portal at `/tickets-view`, are unaffected, and every rule is also scoped to `.kb-body-wrapper`, which only knowledge base templates render.

**To undo it:** clear that field and click Save. The knowledge base returns to its HubSpot theme settings, which were not changed.

## Changing the look

1. Edit `legacy-crm-theme.css`. Keep it ASCII: write `\00B7` instead of `·` in `content` strings.
2. Run `node --test tests/hubspot-kb-theme.test.mjs`.
3. Build the snippet:

   ```bash
   node scripts/hubspot-kb-theme.mjs --out kb-theme-snippet.html
   ```

   It prints the length and SHA-256. Don't commit the output file.
4. In HubSpot, replace the whole field with the file's contents and click Save. HubSpot's Save bar says "You've changed 1 knowledge base setting" and warns that saving publishes immediately.
5. Wait about a minute, then check the live site (below).

Pasting into HubSpot's code field from an automated browser did not use the system clipboard in testing. Calling `setValue()` on the field's CodeMirror instance did work, and HubSpot then showed its Save bar.

## Checking the live site

- Each page type has `<style id="legacy-crm-theme">` in `<head>`: home, a category, an article, `/kb-tickets/new` and `/kb-search-results`.
- Links and the support form ID (`fc565d4c-080b-4166-b758-7115c436fc1a`) are unchanged.
- Typing in search shows suggestions, and submitting a term returns results.
- On a long category, Carrier Resources for example, "See more" shows every article.
- On the support form, an invalid email shows the error message without submitting.
- At phone width the header menu opens, and the related articles and feedback widgets render under the article.

## Things that bite

- HubSpot's support form, feedback widget and header CSS use ID selectors (`#hs_form_target_kb_support_form`, `#ka-feedback-…`, `#hs_cos_wrapper_knowledgebase_header`). Overrides for them must include the same IDs or they lose.
- The category "See more" button keeps a `-hidden` class while it is visible. Never hide `.hs-kb-category-article-list__toggle.-hidden`; the test guards this.
- The logo image has a black background. `mix-blend-mode: lighten` lets the sidebar color show through it.
- HubSpot's chat button sits in the bottom-left corner, so the desktop sidebar keeps space below the language switcher.
