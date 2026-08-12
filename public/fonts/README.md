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
