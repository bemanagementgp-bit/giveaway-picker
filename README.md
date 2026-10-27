# Giveaway Picker – Free Instagram Giveaway Winner Picker

Pick random winners from the comments of an Instagram giveaway (or any list of participants). Paste, upload or import comments, apply the giveaway rules, draw winners with a Web Crypto seed and a SHA-256 verification hash, and export a winner certificate. Everything runs in the user's browser; nothing is uploaded.

**Live:** https://giveaway-tool.vercel.app/ (placeholder – replaced after deploy)

## Features

**Free**
- Participants: **Paste** (one comment per line: `@user comment`, `user: comment`, `user comment`, or the instagram.com desktop layout with the username on its own line; noise lines like "Reply" / "12 likes" / "3d" are dropped), **Upload** CSV/TXT/JSON (columns username/user/author/name + text/comment/message auto-detected, plain lists too), **Manual** chip input. "Load sample" with 63 realistic comments (mentions, duplicates, hashtags, comments without tags, 2 bots).
- Rules: one entry per user (or one entry per comment), mentions ≥ N, required hashtag/keyword, min. comment length, exclude list + account owner, bot blocklist (digits-only, "bot", "giveaway", "free"), bonus entry when a comment includes a keyword. Live "Eligible: X users / Y entries" with a removal breakdown.
- Draw: 1–3 winners, 0–5 alternates, Roulette / Countdown / Instant animation, optional WebAudio sound, confetti. Seed from `crypto.getRandomValues`; winners derived deterministically from the seed over the sorted eligible list; verification hash = SHA-256(sorted usernames + seed). "Repeat draw", "Exclude winners & draw again", "Replay a seed".
- Result: winner cards with comment, alternates, hash + seed, certificate canvas 1080×1080 / 1080×1920 (Story) with post URL, date, participant count, hash short; Download PNG (watermark on free), Copy image, Copy caption, Share.
- Free limit: 500 eligible participants (first 500 used + notice + Pro modal once).
- State persisted in `localStorage` (`giveaway_state_v1`).

**Pro (one-time, price from `config.js`)**
- Up to 20 winners, unlimited participants, no watermark.
- **Instagram import** through the official Graph API v21: post URL / media id + user access token (`instagram_basic`, `instagram_manage_comments`, `pages_read_engagement`). Chain: `/me/accounts` → `instagram_business_account` → `/{ig_user_id}/media?fields=id,shortcode,permalink` (paged) → `/{media_id}/comments?fields=username,text,timestamp,like_count&limit=50` (follows `paging.next`). Token kept in memory unless "remember on this device" is ticked.
- Draw history (last 20 draws, `giveaway_history_v1`) + "exclude previous winners".
- Custom certificate colors and logo upload.

Gates are enforced in `app.js` via `isPro()` / `Studio.gate()`; the UI listens to `pro:changed`.

## Files

```
index.html     tool page + SEO content + FAQ (JSON-LD WebApplication + FAQPage)
styles.css     _shared/base.css + app styles
app.js         parsing, rules, draw, certificate, Instagram import (vanilla JS, no build step)
studio.js      shared canvas / drop zone / export helpers (copy of _shared/studio.js)
monetize.js    shared theme / toast / analytics / AdSense / Pro license helpers
config.js      window.APP_CONFIG (site URL, AdSense, GA, price, LICENSE, NEWSLETTER, PAYMENTS)
privacy.html   privacy policy (required for AdSense)
terms.html     terms of use
robots.txt, sitemap.xml, vercel.json, favicon.svg, .gitignore
```

## Run locally

```bash
npx serve .
```

No build step. Open the printed URL.

## Deploy

Deploy the folder as a static site on Vercel (`vercel --prod`). After the first deploy, replace the placeholder everywhere:

```bash
sed -i 's/giveaway-tool.vercel.app/giveaway-tool.vercel.app/g' index.html privacy.html terms.html robots.txt sitemap.xml config.js README.md
```

Then run `node _shared/apply-brand.js giveaway-picker` from the repo root to inject the shared header, hero, footer and lead card. Add `giveaway` to `bm-payments/catalog.js` (APPS) if not already there.

## Monetization setup

1. **AdSense** – set `ADSENSE_CLIENT: "ca-pub-XXXXXXXXXXXXXXXX"` in `config.js`. Slots: `sidebar-1`, `below-tool`. `privacy.html` already discloses advertising cookies.
2. **Analytics** – set `GA_ID: "G-XXXXXXX"`. Events: `sample`, `upload`, `draw` (winners, alternates, participants, anim), `download`, `copy` (what), `share`, `instagram_import`, `pro_click`, `begin_checkout`, `license_activated`.
3. **Pro checkout + licenses** – `PAYMENTS.url` / `PAYMENTS.app: "giveaway"` use the bm-payments Mercado Pago service. Alternatively set `PRO_CHECKOUT_URL` and `LICENSE.store_id` / `product_id` for Lemon Squeezy. Until configured, only `LICENSE.test_keys` work locally.
4. **Newsletter** – set `NEWSLETTER.url` (Formspree / ConvertKit / Beehiiv) to show the lead card that `apply-brand.js` injects.

## Notes

- The draw is reproducible: same eligible list + same seed → same winners and hash. Rules changes alter the eligible list and therefore the hash.
- Graph API Explorer tokens expire after ~1 hour; comment replies are not fetched (top-level comments only).
- The only external requests are Google Fonts, optional GA/AdSense, the license/payment APIs when a key is entered, and `graph.facebook.com` when the Pro Instagram import is used.
