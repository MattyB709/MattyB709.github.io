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
