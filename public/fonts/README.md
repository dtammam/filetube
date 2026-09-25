# Bundled fonts

## Geist (`geist.woff2`) - the MODERN theme face (v1.107)

The `latin`-subset **variable** build of Geist (weight axis 100-900), self-hosted.
Geist is Vercel's product-UI typeface; the `[data-theme="2021"]` (Modern) theme
uses it across all elements (body, logo, headings). Roboto stays bundled as the
graceful fallback in Modern's stack; the retro eras (2005/2009/2014) are
untouched (their own Arial/Verdana stacks).

- Font: **Geist**, (c) Vercel
- License: **SIL Open Font License 1.1** - https://openfontlicense.org
- Source: Google Fonts (https://fonts.google.com/specimen/Geist); subsetted to
  latin, otherwise unmodified. The variable axis (100-900) is intact - OFL permits
  subsetting/bundling/redistribution.

## Roboto (`roboto.woff2`)

The `latin`-subset **variable** build of Roboto (weight axis 100-900), self-hosted.
Kept as the graceful fallback in Modern's font stack (Geist -> Roboto -> system).

- Font: **Roboto**, (c) Google
- License: **Apache License 2.0** - https://www.apache.org/licenses/LICENSE-2.0
- Source: Google Fonts (https://fonts.google.com/specimen/Roboto); subsetted to
  latin, otherwise unmodified. Apache-2.0 permits redistribution.

## Jersey 10 (`jersey10.woff2`) - the Click (Original) screen face (v1.335)

A chunky bitmap-style face for the Click (Original) music-player skin's monochrome
screen (the first iPod's look; Apple's own screen font cannot ship). Only that skin's
screen names it, so no other page or skin downloads it.

- Font: **Jersey 10**, (c) 2023 The Soft Type Project Authors (https://github.com/scfried/soft-type-jersey)
- License: **SIL Open Font License 1.1** - https://openfontlicense.org
- Source: Google Fonts (https://fonts.google.com/specimen/Jersey+10); subsetted to
  latin (fontTools pyftsubset, woff2), otherwise unmodified. OFL permits
  subsetting/bundling/redistribution.
