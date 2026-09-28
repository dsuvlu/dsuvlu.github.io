-- Emits a per-page <link rel="canonical"> and, on the home page, a JSON-LD
-- Person record tying this site to ORCID, Google Scholar, and GitHub.

local function meta_to_string(v)
  if v == nil then return nil end
  if type(v) == "string" then return v end
  return pandoc.utils.stringify(v)
end

local function relative_output_path()
  local input = quarto.doc.input_file
  local project = os.getenv("QUARTO_PROJECT_DIR")
  if input == nil or project == nil then return nil end

  -- normalise trailing slash on the project dir, then strip it off the input
  project = project:gsub("/+$", "")
  if input:sub(1, #project + 1) ~= project .. "/" then return nil end

  local rel = input:sub(#project + 2)
  return (rel:gsub("%.qmd$", ".html"):gsub("%.md$", ".html"))
end

function Pandoc(doc)
  -- Quarto does not pass website.site-url into document metadata, so the base
  -- URL is declared as `canonical-base` under format.html in _quarto.yml.
  local site_url = meta_to_string(doc.meta["canonical-base"])
  if site_url == nil then return nil end
  site_url = site_url:gsub("/+$", "")

  local rel = relative_output_path()
  if rel == nil then return nil end

  -- canonical points at the directory form: /about/ rather than /about/index.html
  local canonical = rel:gsub("index%.html$", "")
  canonical = site_url .. "/" .. canonical

  quarto.doc.include_text("in-header",
    '<link rel="canonical" href="' .. canonical .. '">')

  if rel == "index.html" then
    local person = [[
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Person",
  "name": "Dylan Suvlu",
  "url": "]] .. site_url .. [[/",
  "email": "mailto:dsuvlu@gmail.com",
  "jobTitle": "Computational Scientist",
  "alumniOf": [
    {
      "@type": "CollegeOrUniversity",
      "name": "Massachusetts Institute of Technology"
    },
    {
      "@type": "CollegeOrUniversity",
      "name": "University of Maine"
    }
  ],
  "knowsAbout": [
    "Computational chemistry",
    "Statistical physics",
    "Molecular dynamics simulation",
    "Interfacial electrochemistry",
    "Bayesian inference",
    "Machine learning"
  ],
  "identifier": {
    "@type": "PropertyValue",
    "propertyID": "ORCID",
    "value": "https://orcid.org/0000-0003-3216-1338"
  },
  "sameAs": [
    "https://orcid.org/0000-0003-3216-1338",
    "https://scholar.google.com/citations?user=aLT9gJ0AAAAJ&hl=en",
    "https://github.com/dsuvlu"
  ]
}
</script>]]
    quarto.doc.include_text("in-header", person)
  end

  return nil
end
