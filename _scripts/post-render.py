"""Post-render fixes Quarto has no setting for. Runs after every render,
including partial ones under `quarto preview`, so each step is idempotent."""

import os
import re
import shutil
from pathlib import Path

out = Path(os.environ.get("QUARTO_PROJECT_OUTPUT_DIR", "_site"))

# The CV PDF is rendered from cv.qmd to /cv.pdf. /files/cv.pdf is where it
# lived from the site's first commit, so keep that URL working for old links.
pdf = out / "cv.pdf"
if pdf.exists():
    legacy = out / "files" / "cv.pdf"
    legacy.parent.mkdir(exist_ok=True)
    shutil.copy2(pdf, legacy)

# Quarto lists pages as /about/index.html, while seo.lua declares the
# directory form /about/ as canonical. Search engines treat a sitemap that
# disagrees with the canonical links as a mixed signal, so match the sitemap
# to the canonicals.
sitemap = out / "sitemap.xml"
if sitemap.exists():
    xml = sitemap.read_text(encoding="utf-8")
    fixed = re.sub(r"(<loc>[^<]*/)index\.html(</loc>)", r"\1\2", xml)
    if fixed != xml:
        sitemap.write_text(fixed, encoding="utf-8")
