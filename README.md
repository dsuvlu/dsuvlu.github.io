# Dylan Suvlu — personal website

The source for [dsuvlu.github.io](https://dsuvlu.github.io), built with [Quarto](https://quarto.org/).

## Local preview

```sh
quarto preview
```

## Build

```sh
quarto render
```

The generated site is written to `_site/`. Main pages live at the repository root; research projects and notes have their own folders.

`cv.qmd` renders both the CV page and the PDF at `/cv.pdf` (via Typst, bundled with Quarto; styling in `_cv/`). The publication list is `_publications-list.qmd`, shared by the publications page and the PDF, so edit it there. `_scripts/post-render.py` keeps the old `/files/cv.pdf` URL working and aligns the sitemap with the canonical URLs.

## Publishing

Pushes to `main` trigger the Quarto publishing workflow, which renders the site and updates the `gh-pages` branch. The generated `_site/` output and `.quarto/` cache remain local and should not be committed on `main`.
