#show: doc => cv(
  name: [$cv-name$],
  contacts: (
$for(cv-contacts)$
    ([$it.text$], "$it.href$"),
$endfor$
  ),
$if(fontsize)$
  fontsize: $fontsize$,
$endif$
  doc,
)
