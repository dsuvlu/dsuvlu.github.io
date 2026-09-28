// PDF layout for cv.qmd. The palette and type mirror assets/styles.css so the
// PDF reads as the same document as the web page.

#let ink = rgb("#10233f")
#let ink-soft = rgb("#415169")
#let blue = rgb("#2457d6")
#let vermilion = rgb("#dc5b3e")
#let rule = ink.transparentize(84%)

#let serif = "Gelasio"
#let sans = "Mulish"

// Date column + body, the .cv-entry grid on the web page.
#let cv-entry(when, body) = block(breakable: false, above: 1.05em, below: 1.05em, grid(
  columns: (7.2em, 1fr),
  column-gutter: 1.2em,
  text(size: 0.88em, weight: 700, fill: ink-soft, tracking: 0.03em, when),
  body,
))

#let award(title, detail) = block(breakable: false, above: 0.7em, below: 0.7em)[
  #text(weight: 700, title) \
  #text(fill: ink-soft, detail)
]

#let skill(label, items) = block(above: 0.6em, below: 0.6em, grid(
  columns: (18em, 1fr),
  column-gutter: 1.2em,
  text(size: 0.8em, weight: 800, tracking: 0.08em, fill: blue, upper(label)),
  text(fill: ink-soft, items),
))

#let lede(body) = block(above: 0.9em, below: 0.4em,
  text(font: serif, size: 1.12em, fill: ink-soft, body))

// One entry of _publications-list.qmd: year column, linked title, byline.
#let pub(year, title, body) = block(breakable: false, above: 0.85em, below: 0.85em, grid(
  columns: (7.2em, 1fr),
  column-gutter: 1.2em,
  text(size: 0.88em, weight: 700, fill: ink-soft, tracking: 0.03em, year),
  {
    show link: set text(fill: ink)
    block(below: 0.4em, text(font: serif, size: 1.08em, weight: 500, title))
    set text(fill: ink-soft)
    set par(spacing: 0.4em)
    body
  },
))

#let note(body) = block(above: 1em, text(size: 0.88em, fill: ink-soft, body))

#let cv(name: none, contacts: (), fontsize: 9.5pt, doc) = {
  set document(title: [#name — CV], author: "Dylan Suvlu")
  set page(
    paper: "us-letter",
    margin: (x: 0.75in, top: 0.65in, bottom: 0.7in),
    footer: context {
      let total = counter(page).final().first()
      if total > 1 {
        set text(size: 0.8em, fill: ink-soft)
        [#name #h(1fr) #counter(page).display() / #total]
      }
    },
  )
  set text(font: sans, size: fontsize, fill: ink, lang: "en")
  set par(leading: 0.58em, spacing: 0.75em, justify: false)
  set list(indent: 0.2em, body-indent: 0.55em, spacing: 0.5em, marker: text(fill: ink-soft)[•])
  show link: set text(fill: blue)

  show heading: set text(fill: ink)
  // Quarto shifts headings up one level for Typst: the page's ## sections
  // arrive as level 1 and the ### entry titles as level 2.
  show heading.where(level: 1): it => block(above: 1.5em, below: 0.75em, sticky: true)[
    #set text(font: sans, size: 0.8em, weight: 800, tracking: 0.1em, fill: blue)
    #grid(
      columns: (auto, 1fr),
      column-gutter: 0.8em,
      align: horizon,
      upper(it.body),
      line(length: 100%, stroke: 0.5pt + rule),
    )
  ]
  show heading.where(level: 2): it => block(above: 0em, below: 0.35em,
    text(font: serif, size: 1.18em, weight: 600, it.body))

  // Masthead
  block(below: 0.85em)[
    #text(font: serif, size: 25pt, weight: 500, tracking: -0.02em, name)
    #box(circle(radius: 2.2pt, fill: vermilion))
  ]
  block(below: 1.2em, {
    set text(size: 0.92em, fill: ink-soft)
    contacts.map(((label, url)) => link(url, label)).join(h(0.55em) + text(fill: rule)[|] + h(0.55em))
  })

  doc
}
