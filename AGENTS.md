# Minimalist Blog – Agent Plan and Log

## Plan
- Goal: Minimal static blog (Bear-like), pure HTML/CSS/JS, deployable to GitHub Pages.
- Content: Markdown posts for Blog and Projects, plus simple Markdown Pages.
- Rendering: Use Marked (Markdown) + DOMPurify (sanitize) + KaTeX (LaTeX), all via CDN.
- Structure: JSON manifests for blog/projects lists; individual posts/pages fetched by slug.
- Theme: Base styles + overridable theme variables for consistent typography and spacing.

## Architecture
- Pages: `index.html`, `blog.html`, `projects.html`, `post.html`, `page.html`, `404.html`.
- Content:
  - Blog posts: `content/blog/*.md` with frontmatter
  - Projects posts: `content/projects/*.md` with frontmatter
  - Pages: `content/pages/*.md` with frontmatter
- Manifests: `content/blog/index.json`, `content/projects/index.json`
- Assets:
  - CSS: `assets/css/base.css`, `assets/css/theme.css`
  - JS: `assets/js/site.js`, `assets/js/render.js`

## Frontmatter Spec (YAML-like)
```
---
slug: hello-world   # required (for content files)
title: Hello World  # required
subtitle: A short description  # optional
date: 2025-08-01    # required for blog/projects lists (ISO yyyy-mm-dd)
---

Markdown content here...
```

## Math Delimiters
- Inline: `$ ... $`
- Block: `$$ ... $$`

## How to add a blog post
1. Create `content/blog/my-post.md` with frontmatter + content.
2. Update `content/blog/index.json` to include the new entry `{ slug, title, subtitle, date }`.
3. The list appears at `/blog.html`; view full post at `/post.html?type=blog&slug=my-post`.

## How to add a project post
- Same as blog, but under `content/projects` and `index.json` there.

## How to add a page (e.g., About)
1. Create `content/pages/about.md` with frontmatter (slug: about).
2. Link to `/page.html?slug=about`.

## Deployment (GitHub Pages)
- Commit and push to repository.
- Enable GitHub Pages (Settings → Pages → Deploy from branch → `main` → root).
- All assets use relative paths; CDN hosts Marked/DOMPurify/KaTeX.

## Work Log
- Scaffolded directory structure and base assets.
- Implemented list pages for blog/projects using JSON manifests.
- Implemented Markdown + LaTeX rendering pipeline with custom delimiters.
- Added sample content (blog, project, and about page) and example manifests.
- Wrote usage instructions and frontmatter spec in this file.
- Added figure-aware image rendering with caption support, sanitizer allowances, and theme styles.

### 2025-12-16 — External Video Embeds (YouTube/Vimeo)
- JS: Enabled safe external video embeds via `iframe`.
  - Updated `assets/js/render.js` `sanitize()` to allow `iframe` and required attributes (`src`, `title`, `width`, `height`, `allow`, `allowfullscreen`, `referrerpolicy`, `sandbox`, `loading`).
  - Added a one-time DOMPurify configuration (`configureSanitizerForEmbeds`) with hooks to:
    - Allow only trusted hosts: `youtube.com`, `youtube-nocookie.com`, and `player.vimeo.com`.
    - Require YouTube embed paths (`/embed/...`).
    - Enforce safe defaults: `loading="lazy"`, `referrerpolicy="strict-origin-when-cross-origin"`, `allowfullscreen`, and a sensible `allow` list.
- CSS: Made embeds responsive and consistent with theme.
  - Updated `assets/css/base.css` to style `.post-content iframe, .post-content video` with full-width, border radius, spacing, and `aspect-ratio: 16 / 9` for iframes.

## Video Embeds — How To
- Supported providers: YouTube (including `youtube-nocookie`) and Vimeo.
- Author in Markdown using raw HTML anywhere in the post body. Wrap in a `figure` to get a matching caption style.

Example — YouTube (privacy-enhanced):

```html
<figure class="post-figure">
  <iframe
    src="https://www.youtube-nocookie.com/embed/VIDEO_ID"
    title="My demo video"
    loading="lazy"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowfullscreen
    referrerpolicy="strict-origin-when-cross-origin">
  </iframe>
  <figcaption>Quick demo of the feature</figcaption>
  </figure>
```

Example — Vimeo:

```html
<figure class="post-figure">
  <iframe
    src="https://player.vimeo.com/video/VIDEO_ID"
    title="My Vimeo demo"
    loading="lazy"
    allow="autoplay; fullscreen; picture-in-picture"
    allowfullscreen
    referrerpolicy="strict-origin-when-cross-origin">
  </iframe>
  <figcaption>Launch trailer</figcaption>
</figure>
```

Notes
- Only `https://www.youtube.com/embed/...`, `https://www.youtube-nocookie.com/embed/...`, and `https://player.vimeo.com/video/...` are allowed. Plain watch URLs (e.g. `watch?v=`) are blocked—use the embed form.
- You can omit `loading`, `allow`, `referrerpolicy`, and `allowfullscreen`; safe defaults are applied during sanitization.
- The embed scales responsively to the post width with a 16:9 aspect ratio by default.

### 2025-12-16 — Video Shortcodes
- JS: Added simple, author-friendly shortcodes expanded before Markdown rendering.
  - Implemented in `assets/js/render.js`: `applyShortcodes()`, `toYouTubeEmbed()`, `toVimeoEmbed()`, and `buildEmbedFigure()`.
  - Supported forms:
    - `{{ youtube: ID_OR_URL "Optional caption" }}` → embeds YouTube via `youtube-nocookie.com`.
    - `{{ vimeo: ID_OR_URL "Optional caption" }}` → embeds Vimeo via `player.vimeo.com`.
  - You can provide either a plain video ID or a full video URL; the parser normalizes to the proper embed URL.

Usage examples in Markdown:

```
Here is a quick demo:

{{ youtube: dQw4w9WgXcQ "Launch trailer" }}

And a Vimeo sample:

{{ vimeo: 76979871 "The New Vimeo Player" }}
```

Notes
- Shortcodes are expanded into `<figure>` + `<iframe>` blocks before Marked runs and are still sanitized by DOMPurify with the same origin checks.
- Captions are optional; omit the quoted caption to skip `<figcaption>`.

## Image Support
- Place image files anywhere in the repo (e.g. `assets/images/` or alongside related content) and reference them with a relative path from the site root.
- Use standard Markdown image syntax; the optional title field becomes the figure caption:
  ```
  ![Alt text describing the image](assets/images/my-photo.jpg "Figure 1: My latest build")
  ```
- Output renders as a centered figure with the image, a faint border radius, and a caption beneath it—matching the existing typography.
- Captions and attributes are escaped and sanitized via DOMPurify (`figure`/`figcaption` retained with added allowances).
- Images load lazily (`loading="lazy"`) to avoid regressing performance on existing pages.
