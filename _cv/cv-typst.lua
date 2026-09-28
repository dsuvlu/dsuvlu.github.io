-- Maps the layout divs cv.qmd uses on the web to the Typst functions in
-- _cv/typst-template.typ, so the page and the PDF share one source.

if not quarto.doc.is_format("typst") then return {} end

local function raw(s) return pandoc.RawBlock("typst", s) end

-- Typst function call whose arguments are content blocks: name([a], [b]).
-- Each argument is a list of pandoc blocks; the writer fills in the markup.
local function call(name, args)
  local out = pandoc.List{ raw("#" .. name .. "([") }
  for i, blocks in ipairs(args) do
    if i > 1 then out:insert(raw("], [")) end
    out:extend(blocks)
  end
  out:insert(raw("])"))
  return out
end

local function has(el, class) return el.classes:includes(class) end

local function child(div, class)
  for _, b in ipairs(div.content) do
    if b.t == "Div" and has(b, class) then return b end
  end
end

-- A card is "### Title" followed by a paragraph; the heading becomes a
-- plain argument so it doesn't land in the PDF outline.
local function card_parts(card)
  local title, rest = pandoc.List{}, pandoc.List{}
  for _, b in ipairs(card.content) do
    if b.t == "Header" and #title == 0 then
      title:insert(pandoc.Plain(b.content))
    else
      rest:insert(b)
    end
  end
  return title, rest
end

function Div(el)
  if has(el, "cv-entry") then
    local when, what = child(el, "cv-when"), child(el, "cv-what")
    if when and what then return call("cv-entry", { when.content, what.content }) end
  elseif has(el, "fact-card") then
    return call("award", { card_parts(el) })
  elseif has(el, "skill-group") then
    return call("skill", { card_parts(el) })
  elseif has(el, "pub-item") then
    local year = el.content[1]
    local body = child(el, "pub-body")
    if year and body then
      local title, rest = card_parts(body)
      return call("pub", { { pandoc.Plain(year.content) }, title, rest })
    end
  elseif has(el, "pub-footnote") then
    return call("note", { el.content })
  elseif has(el, "interior-lede") then
    return call("lede", { el.content })
  elseif has(el, "content-section") or has(el, "fact-grid") or has(el, "skill-grid")
      or has(el, "pub-list") then
    -- web-only grouping; unwrap instead of emitting #block[]
    return el.content
  end
end

-- the web page bolds the author's own name with CSS
function Span(el)
  if has(el, "pub-self") then return pandoc.Strong(el.content) end
end
