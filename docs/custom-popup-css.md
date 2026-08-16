# Customizing the popup with CSS

Custom CSS lets you change the popup without editing the plugin. You can make
text larger, change fonts and colors, add space, reshape controls, or hide
parts you do not use.

This guide uses small recipes that you can paste into iinatan. The easiest way
to follow along is to keep the popup preview open beside this guide. Try each
recipe there, change the marked values, and copy the result into IINA when it
looks right.

## Start in the popup preview

The repository includes a browser test page that loads the popup's real HTML,
CSS, and renderer. It works without IINA and updates as soon as you enter CSS.

1. [Download the repository as a ZIP](https://github.com/afn478/iinatan/archive/refs/heads/main.zip).
2. Open the downloaded ZIP in Finder to unpack it.
3. Open the `iinatan-main` folder, then open `dev`.
4. Double-click `popup-preview.html`. Safari, Chrome, or Firefox can open it.
5. Choose a dictionary sample from the sidebar. The Jitendex CSS sample has
   examples, forms, and an attribution link.
6. Paste a recipe into **Temporary CSS overrides**.
7. Change the values named below the recipe and watch the popup update.
8. Switch samples, themes, widths, and result counts to check the rule in
   different situations.
9. Copy the finished CSS into iinatan's **Custom popup CSS** setting.

The preview saves temporary CSS in that browser, so a reload keeps your work.
The **Reset** button clears it. The temporary box affects only the preview.

If you already use Git, you can download the same files with:

```sh
git clone https://github.com/afn478/iinatan.git
```

Then open `iinatan/dev/popup-preview.html`.

### Use the preview as you read

For each recipe in this guide:

1. Paste the recipe into the preview.
2. Change one value to something obvious, such as `font-size: 30px`.
3. Confirm that the expected part changes.
4. Set the value you really want.
5. Try both light and dark themes.
6. Try a short entry and a long entry.

If a rule has no visible effect, check braces, colons, and semicolons. Also
check the dictionary name when using `data-dictionary`. Browsers ignore an
invalid rule and continue applying the rest.

## Add CSS to iinatan

1. Open **Plugins > iinatan > Settings...** in IINA.
2. Select the **Popup** tab.
3. Find **Custom CSS** near the bottom.
4. Paste the CSS you finished in the browser preview into **Custom popup CSS**.
5. Click outside the text box so the setting is saved.
6. Pause a video and open a popup to check the result.

Custom CSS is stored in the active profile. This makes it possible to keep a
different look for each language or viewing setup.

To return to the standard appearance, remove everything from the Custom popup
CSS box.

## A useful first recipe

This makes the popup wider, increases definition text, adds more breathing
room, and uses a squarer corner shape.

```css
#popup.lookup-popup {
  min-width: 320px;
  max-width: 540px;
  border-radius: 10px;
}

#popup .head {
  padding: 16px 20px 6px;
}

#popup .body {
  padding: 6px 20px 18px;
  font-size: 17px;
  line-height: 1.55;
}
```

Change `540px` to set the maximum width. Good values are usually between
`360px` and `650px`. Change `17px` to set the definition size. The three
numbers in `padding: 6px 20px 18px` mean top, both sides, and bottom.

The built-in **Popup size**, **Popup maximum width**, and **Popup maximum
height** settings are still the easiest way to make broad size changes. CSS is
useful when you want more control over individual parts.

## How a rule works

A CSS rule has two parts:

```css
#popup .body {
  font-size: 17px;
}
```

`#popup .body` chooses the definition area. `font-size: 17px` describes the
change. Edit the value after the colon and keep the semicolon.

These units cover most popup changes:

- `px` is a fixed size. Try `12px`, `16px`, or `24px`.
- `em` follows the current text size. `1.2em` means 20 percent larger.
- `vh` follows the IINA window height. `50vh` means half of that height.
- `rgba(20, 20, 24, 0.94)` is a color with transparency. The last number runs
  from `0` for clear to `1` for solid.

For `margin` and `padding`, two values mean vertical then horizontal:

```css
#popup .example-card {
  margin: 8px 0;
  padding: 8px 12px;
}
```

Here, the card gets `8px` above and below, no outside space at its sides,
`8px` of room inside the top and bottom, and `12px` inside the left and right.

## Popup map

The popup is arranged like this:

```text
#popup                         whole popup window
├── .head                      top heading
│   ├── .term                  main headword
│   ├── .reading or rt         reading or furigana
│   ├── .primary-pitch         main pitch display
│   └── .head-actions          Anki and audio controls
└── .body                      all lookup results
    └── .entry                 one term and all its dictionary definitions
        ├── .dict-term         headword for a later result
        ├── .entry-meta-row    frequency and extra pitch information
        └── .dict-section      one definition from one dictionary
            ├── .dict-name     dictionary name
            └── definition content, tags, examples, forms, and sources
```

The following selectors cover the parts people change most often.

| Part | Selector |
| --- | --- |
| Whole popup window | `#popup.lookup-popup` |
| Heading area | `#popup .head` |
| First headword | `#popup .term` |
| Furigana above a headword | `#popup .term rt`, `#popup .dict-headword rt` |
| Separate reading line | `#popup .reading`, `#popup .dict-reading` |
| Definition area | `#popup .body` |
| One result for a term | `#popup .entry` |
| Later result headword | `#popup .dict-term` |
| One dictionary definition | `#popup .dict-section` |
| Dictionary name | `#popup .dict-name` |
| Plain definition paragraph | `#popup .gloss` |
| Structured definition block | `#popup .structured-block` |
| Definition and part-of-speech tags | `#popup .tag-chip`, `#popup .pos-pill` |
| Frequency tags | `#popup .freq-chip` |
| Pitch accent | `#popup .pitch-patterns` |
| Example box | `#popup .example-card` |
| Note box | `#popup .note-card` |
| Cross-reference box | `#popup .xref-card` |
| Forms table | `#popup .forms-table` |
| Grammar or etymology section | `#popup .dict-details` |
| Source and attribution links | `#popup .source-row`, `#popup .attribution-row` |
| Audio and Anki buttons | `#popup .audio-button`, `#popup .anki-button` |

Rules that start with `#popup` also apply to child popups opened from a
definition. iinatan expands that selector for you. To affect only the first
popup, use `#popup[data-popup-depth="0"]`. To affect only child popups, use
`.nested-popup`.

## Window, colors, and borders

### Change the popup surface

```css
#popup.lookup-popup {
  background: rgba(18, 20, 26, 0.96);
  border: 2px solid rgba(130, 170, 255, 0.35);
  border-radius: 12px;
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.45);
}
```

Change `0.96` for more or less transparency. Change `12px` for rounder or
squarer corners. Set `box-shadow: none` if you prefer a flat edge.

### Change the main color set

The popup uses named color variables. A short set of overrides can recolor
many parts at once.

```css
#popup {
  --popup-bg: rgba(24, 27, 34, 0.96);
  --popup-text: #e8eaf0;
  --popup-heading: #ffffff;
  --popup-muted: #aab0bf;
  --popup-reading: #8cb8ff;
  --popup-link: #8cb8ff;
  --popup-divider: rgba(170, 180, 205, 0.28);
  --popup-chip-bg: rgba(140, 170, 230, 0.14);
  --popup-card-bg: rgba(255, 255, 255, 0.06);
}
```

Change one line at a time. `--popup-reading` controls readings and several
small accents. `--popup-muted` controls dictionary names and quiet metadata.

You can give light and dark mode separate values:

```css
:root.theme-dark #popup {
  --popup-bg: rgba(20, 22, 28, 0.96);
  --popup-text: #edf0f7;
}

:root.theme-light #popup {
  --popup-bg: rgba(255, 252, 246, 0.97);
  --popup-text: #25221f;
}
```

## Fonts and text

### Change the font for the whole popup

```css
#popup {
  font-family: "Hiragino Sans", "Yu Gothic", sans-serif;
}

#popup button {
  font-family: inherit;
}
```

Fonts are tried from left to right. If the first family is unavailable, the
next one is used. Keep `sans-serif` or `serif` at the end as a fallback.

To find fonts on your Mac, open **Font Book** from the Applications folder and
choose **All Fonts**. Use the family name shown in the list. Put quotation
marks around names that contain spaces. Apple's [Font Book guide](https://support.apple.com/guide/font-book/view-and-print-fonts-fntbk1001/mac)
shows the list, previews, styles, and font information panel.

After installing or enabling a font, reopen IINA if it does not appear at
once. A local installed font is more reliable than a font loaded from a web
address.

### Style all visible headwords

```css
#popup .term,
#popup .dict-term {
  font-family: "Hiragino Mincho ProN", "Yu Mincho", serif;
  font-size: 34px;
  font-weight: 700;
  font-style: normal;
  letter-spacing: 0.02em;
}
```

Change `34px` for size. Use `font-weight: 500` for a lighter face. Use
`font-style: italic` for italics.

### Change readings and furigana

```css
#popup .reading,
#popup .dict-reading {
  font-size: 18px;
  color: #9bc4ff;
}

#popup .term rt,
#popup .dict-headword rt {
  font-size: 0.62em;
  color: #9bc4ff;
}
```

`0.62em` is relative to its headword. Try values from `0.45em` to `0.75em`.

### Change definition text only

```css
#popup .body {
  font-size: 16px;
  line-height: 1.6;
}

#popup .dict-name {
  font-size: 12px;
  font-style: italic;
}
```

## Spacing and grouping

### Give each result its own card

An `.entry` holds one result headword, its metadata, and every dictionary
definition that belongs to it.

```css
#popup .entry {
  margin: 8px 0;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
}

#popup .entry + .entry {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
}
```

The second rule keeps later results consistent with the first card.

### Change the space between dictionaries

```css
#popup .dict-section + .dict-section {
  margin-top: 16px;
  padding-top: 8px;
  border-top: 1px dotted var(--popup-divider);
}
```

Change `16px` for the space between definitions. Replace `dotted` with `solid`
for a continuous line. Use `border-top: 0` to remove the line.

### Change the definition indent

```css
#popup .dict-section {
  padding-inline-start: 12px;
}

#popup .dict-section > .dict-header,
#popup .dict-section .dictionary-head-block {
  margin-inline-start: -12px;
}

#popup .dict-section .dictionary-head-block .dictionary-head-block {
  margin-inline-start: 0;
}
```

Change all three `12px` values together. The negative value keeps dictionary
names and internal headwords aligned with the left edge.

## Choose one dictionary

Each definition carries the dictionary name shown in the popup. Use that name
inside a `data-dictionary` selector.

```css
#popup .dict-section[data-dictionary="Jitendex"] {
  font-size: 16px;
  background: rgba(80, 140, 255, 0.06);
}
```

The name must match exactly. For titles that include a date or edition, match
the beginning of the name with `^=`:

```css
#popup .dict-section[data-dictionary^="Jitendex"] {
  font-size: 16px;
}
```

`data-dictionary-type` can select a family of sources. The available values
are `jitendex`, `wiktionary`, `kaikki`, `wiktionary-style`, and `generic`.

```css
#popup .dict-section[data-dictionary-type="wiktionary"],
#popup .dict-section[data-dictionary-type="kaikki"],
#popup .dict-section[data-dictionary-type="wiktionary-style"] {
  line-height: 1.55;
}
```

You can style only the dictionary label while leaving its definition alone:

```css
#popup .dict-section[data-dictionary="Jitendex"] .dict-name {
  color: #79b8ff;
  font-weight: 700;
}
```

## Tags, frequency, and pitch

### Make metadata larger and rounder

```css
#popup .tag-chip,
#popup .pos-pill,
#popup .freq-chip,
#popup .pitch-source-chip {
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 12px;
  text-transform: none;
}
```

`999px` makes pill-shaped ends. Use `4px` or `6px` for small rounded corners.

### Put more room around frequency and pitch information

```css
#popup .entry-meta-row {
  gap: 8px;
  margin: 4px 0 12px;
}

#popup .pitch-patterns {
  gap: 6px 12px;
  font-size: 17px;
}
```

### Make pitch lines thicker

```css
#popup .pitch-mora.pitch-high {
  border-top-width: 3px;
}

#popup .pitch-mora.pitch-drop {
  border-right-width: 3px;
}
```

These borders draw the pitch shape. Change both numbers together.

## Examples, notes, links, and tables

### Restyle the three information boxes

```css
#popup .example-card,
#popup .note-card,
#popup .xref-card {
  margin: 10px 0;
  padding: 9px 12px;
  border-radius: 6px;
}

#popup .example-ja {
  font-size: 21px;
}

#popup .example-en {
  margin-top: 4px;
  font-size: 13px;
}
```

### Make forms tables more spacious

```css
#popup .forms-table {
  font-size: 16px;
}

#popup .forms-table th,
#popup .forms-table td {
  padding: 6px 10px;
}
```

### Emphasize source links

```css
#popup .source-row,
#popup .attribution-row {
  margin-top: 10px;
  font-size: 13px;
}

#popup .external-source-link {
  color: #80b7ff;
  text-decoration-thickness: 2px;
}
```

### Open sections with a clearer edge

```css
#popup .dict-details {
  padding-left: 12px;
  border-left: 4px solid var(--popup-reading);
}

#popup .details-body {
  margin-top: 8px;
}
```

CSS can change how a collapsed section looks. The **Entry Sections** settings
control whether etymology starts open or closed.

## Buttons, icons, and small shapes

The audio and Anki drawings are vector icons. Their `color`, `width`, and
`height` can change without making them blurry. The button rule controls the
shape around each drawing.

```css
#popup .audio-button,
#popup .anki-button {
  width: 34px;
  height: 34px;
  border: 1px solid rgba(150, 180, 230, 0.28);
  border-radius: 9px;
  color: #9bc4ff;
  background: rgba(120, 160, 220, 0.12);
}

#popup .audio-icon,
#popup .anki-icon {
  width: 19px;
  height: 19px;
}
```

Use `border-radius: 999px` for circles. Use `0` for square corners.

The forms symbols can use the same treatment:

```css
#popup .form-marker {
  width: 26px;
  height: 26px;
  border-radius: 7px;
}
```

The small frequency control is made from two borders. This recipe makes its
arrow larger:

```css
#popup .freq-toggle-icon {
  width: 9px;
  height: 9px;
  border-top-width: 3px;
  border-right-width: 3px;
}
```

## Hide parts you do not use

`display: none` removes a selected part from the layout.

```css
/* Hide lookup source text such as "looked up from". */
#popup .lookup-source {
  display: none;
}

/* Hide all frequency metadata. */
#popup .freq-chip,
#popup .freq-toggle {
  display: none;
}

/* Hide source and attribution rows. */
#popup .source-row,
#popup .attribution-row {
  display: none;
}
```

Keep only the rules for parts you want to hide.

## Jitendex recipes

Jitendex publishes several useful custom-style examples for Yomitan. iinatan
turns Jitendex structured content into compact popup classes, so the selectors
below are iinatan versions of three common Jitendex recipes. Each one is scoped
to dictionaries whose type is `jitendex`.

### Hide example sentences and translations

```css
#popup .dict-section[data-dictionary-type="jitendex"] .example-card {
  display: none;
}
```

### Hide database attribution links

```css
#popup .dict-section[data-dictionary-type="jitendex"] .attribution-row {
  display: none;
}
```

### Hide lists of written forms

```css
#popup .dict-section[data-dictionary-type="jitendex"] .forms-block:has(.glossary-list) {
  display: none;
}
```

These ideas come from Jitendex's [Custom Styles in Yomitan](https://github.com/Jitendex/Jitendex/wiki/Custom-Styles-in-Yomitan)
page. That page uses Yomitan selectors. Use the iinatan versions above in this
plugin.

Here is one extra recipe for a denser Jitendex entry:

```css
#popup .dict-section[data-dictionary-type="jitendex"] .example-card {
  margin-top: 6px;
  padding: 7px 9px;
}

#popup .dict-section[data-dictionary-type="jitendex"] .example-ja {
  font-size: 19px;
}

#popup .dict-section[data-dictionary-type="jitendex"] .glossary-line + .glossary-line::before {
  content: " · ";
}
```

## More CSS resources

- [MDN: Getting started with CSS](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Styling_basics/Getting_started)
  explains selectors, properties, values, spacing, and comments with small
  examples.
- [MDN: `font-family`](https://developer.mozilla.org/en-US/docs/Web/CSS/font-family)
  explains font lists and fallbacks.
- [Yomitan themes and custom CSS](https://yomitan.wiki/tools-resources/#themes)
  collects complete popup themes and shows how Yomitan users apply them.
- [Jitendex custom styles](https://github.com/Jitendex/Jitendex/wiki/Custom-Styles-in-Yomitan)
  contains the source ideas for the Jitendex recipes above.

Yomitan themes are useful inspiration for colors, spacing, and density. Their
selectors describe Yomitan's own popup, so translate each idea to a selector
from the iinatan popup map before pasting it here.
