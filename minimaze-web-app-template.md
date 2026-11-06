# Minimaze Light — structure and design reference

A framework-neutral reference for adapting this Framer template to a web app.

## Scope

This document describes the existing template’s design rules, routes, shared parts and gallery homepage. The web-app architecture suggestions are recommendations, not features already implemented. This is a specification, not an export of source code, images, font files or working 3D scenes. Confirm the relevant template, font and media licences before reuse.

## 1. Creative direction

A white architectural gallery: pale surfaces, near-black lettering, precise rules, framed work, cords, skylights and restrained light effects. Content is the exhibit; interface chrome stays quiet.

- One type family: Inter Display, SemiBold (600).
- Sentence case; no italics.
- White is dominant. Linen denotes paper and sheets; chalk denotes gallery walls; stone denotes floors.
- Red marks an important detail. Never use it as a large background or text colour.
- Use real supplied work and imagery, not invented clients, metrics, awards or testimonials.
- Unknown content stays in [square brackets].

## 2. Route map

| Route | Purpose | Structure |
| --- | --- | --- |
| / | Immersive gallery home | Entrance doors, room, featured work, destination doors |
| /work | Work index | Work section with category controls and work grid |
| /work/[slug] | Work detail | Standalone project sheet |
| /about | Studio information | Hero, Expertise, Approach, Testimonials, Brands, History, Team, Awards, FAQs |
| /journal | Story index | Journal list |
| /journal/[slug] | Story detail | Story sheet |
| /contact | Contact | Contact section and form |
| /404 | Not found | Wrong Door experience |
| /design-system | Live reference | Colours, type and component samples |
| /home-sideways | Alternative homepage | Horizontal gallery wall |
| /home-hall | Alternative homepage | Corridor walk |

Dynamic routes above use readable [slug] notation rather than the editor’s internal collection references.

## 3. Shared page shell

Most routes use the Main layout:

1. Fixed Navigation.
2. Page content in one main landmark.
3. Optional shared Footer.
4. Smooth-scroll behaviour.

Work detail pages deliberately do not use this shell: their linen sheet covers the viewport and closes with its own cross. Journal detail pages retain the shared shell, with their sheet below the navigation.

The footer is disabled on the immersive home, alternative homes and 404 page.

### Content hierarchy

- Page shell
  - Navigation
  - Main
    - Section — descriptive name
      - Container
        - Wrapper / Row / Grid
          - Card / content / component
  - Footer, where enabled

Navigation and footer belong to the shell, not duplicated inside individual pages.

## 4. Responsive layout

| Setting | Desktop | Tablet | Phone |
| --- | --- | --- | --- |
| Reference canvas width | 1200 px | 810 px | 390 px |
| Viewport range | 1200 px and above | 810–1199 px | Below 810 px |
| Horizontal page padding | 44 px | 32 px | 16 px |

Structural sections, containers, rows and grids remain full width. Do not impose a conventional 1080 px content cap. Only prose blocks may have a readable maximum measure.

- Left-align text.
- Keep major headlines to roughly two or three lines.
- Add a 1 px black-at-6% top rule to sections after the first.
- Use normal document flow for content; reserve absolute positioning for deliberate overlays.
- Stack footer bands and multi-cell reference rows on narrower screens.
- Mobile menu contact details flow beneath the links; do not pin them against the bottom browser toolbar.

## 5. Colour tokens

Values read from the project. Text and surface tokens may share a value but have different semantic roles.

| Semantic token | Value | Use |
| --- | --- | --- |
| White / White | rgb(252, 252, 252) | Page ground, navigation, doors, light |
| White / Chalk | rgb(238, 237, 233) | Gallery walls and room background |
| White / Linen | rgb(243, 239, 239) | Menu and content sheets, paper |
| Grey / Mist | rgb(231, 230, 226) | Gallery ceiling |
| Grey / Stone | rgb(226, 222, 214) | Floor and niche wall |
| Grey / Charcoal | rgb(23, 22, 23) | Dark surfaces where required |
| Black / Black | rgb(8, 8, 8) | Fittings, frames, lettering |
| Text / Black | rgb(8, 8, 8) | Text on light surfaces |
| Text / White | rgb(252, 252, 252) | Text on black surfaces only |
| Brand / Red | rgb(254, 30, 52) | Indicator dot, travelling button light, featured edge |

### Transparency steps

- Black 60%: shade and cast shadows.
- Black 30%: wires, rulers and dashes.
- Black 12%: form grids, navigation edges, row dividers.
- Black 6%: faint fills and section rules.
- White 85%, 70%, 30%, 20%, 12%, 5%: details on black surfaces.

For quieter text, retain the text colour and reduce opacity to 0.5–0.7. Do not introduce unrelated grey text colours.

The existing site is light, not a completed light/dark theme system.

## 6. Typography

All five styles use Inter Display, weight 600, normal style.

| Style | Desktop / Tablet / Phone | Line height | Letter spacing | Role |
| --- | --- | --- | --- | --- |
| Heading 1 | 70 / 70 / 50 px | 0.92 | -0.045em | Largest page words, hero, menu, footer |
| Heading 2 | 24 / 24 / 24 px | 1.3 | -0.01em | Story headings, journal titles, send action |
| Heading 3 | 20 / 20 / 18 px | 1.2 desktop; 1.3 smaller | -0.02em desktop; -0.01em smaller | Section labels, intros, quotes and item headings |
| Text | 14 / 14 / 14 px | 1.3 | -0.01em | Body interface copy, labels, captions, buttons |
| Paragraph | 12 / 14 / 14 px | 1.3 | -0.01em | Rich-text story and project prose |

### Text rules

- One h1 per page; h2 for sections; h3 for subordinate item headings.
- Apply balanced wrapping to multiline text, not compact labels.
- Reuse styles rather than inventing isolated font sizes.
- Heading 1 and Heading 3 currently retain white in their source presets. On light surfaces explicitly use Text / Black. A port can normalize this through semantic colour assignments.
- Paragraph is for editorial rich text, not the default UI body style.

## 7. Navigation

An opaque white fixed bar, with a faint black 12% edge, dark logo and two-strip menu control. No frosted-glass blur.

Opening the menu lowers a linen sheet across the viewport. Its lower hem sags slightly; menu words rise into view as the hem passes. Closing reverses this sequence.

### State model

- Desktop: closed, open, closing.
- Phone: closed, open, closing.
- Closing returns to closed after approximately 1.3 seconds.

Menu content includes destination words, studio address, email, social links and a call-to-action button. On phones, hide the studio/address corner and hours line; place email and socials in the content flow beneath the words.

Links that navigate also close the menu. Hovering a menu word shows a red dot and dims its siblings.

## 8. Buttons and links

### Primary button

- Approximately 38 px high.
- 4 px corner radius.
- Thin rim around an inset face.
- Text label and right-arrow icon.
- Dark face with light text for the default appearance.
- On Light appearance: linen face, dark text and a faint dark rim.

A travelling light circles the rim every 3.6 seconds. On hover, a gate grows from the horizontal centreline and reveals an inverted label and icon. Keep dimensions stable across states.

Expose label and destination as reusable inputs. Keep repeated actions consistently named.

### Other reusable elements

- Nav Link: hover underline; light and dark-surface appearances.
- Menu Word: animated menu entry with hover marker.
- Chip: compact category or label.
- Action Link, Social Link, Light Slot, Story Fold, Copy Email.
- Work Card and Next Work.
- Journal Row and Pull Quote.
- Hung Word, Principle, Team Print, Award Line, Question Row.
- Form Chip and Send Button.

Keep section-specific components in their intended context rather than using every effect everywhere.

## 9. Homepage: entrance and gallery room

### Entrance

Two white door leaves each clip half of one headline. Their meeting edges have a 1 px black-at-12% line. A stone floor strip carries a small studio line and an “Enter the gallery” light slot.

Entering swings the doors open on hinges and moves the visitor through the centre of the front wall. The entrance is remembered within the session.

### Room

A pale three-wall gallery beneath long skylights, with a matt stone slab floor, thin dark frames, hanging cords, picture rails and soft shadows. The room occupies the viewport; the reference room section uses a minimum height of 640 px.

The visitor moves along the left wall, across the back, along the right wall, then reaches two destination doorways. Scroll, drag, swipe and arrow keys drive the walk.

Each selected work:
- Settles in front of the visitor.
- Reveals its title and service caption.
- Plays its thumbnail video over the cover.
- Opens its detail page when activated.
- Restores the gallery position when the visitor returns.

### Niches

Two corner niches hold recessed works with concealed warm light. Works follow collection order, with corner positions assigned within the walk. Fewer than five works disables niches.

Default hanging distance is 6 metres on desktop and tablet, 2 metres on phone. Zero places works against the wall.

### Artwork formats

Support large and small 4:3, portrait 4:5, traditional 3:4, reel 9:16, square 1:1, widescreen 16:9 and ultrawide 21:9.

Large landscape works use roughly 70% of viewport height, capped around 56% of viewport width. On phones, use viewport width minus approximately 20 px per side. Portrait formats reserve space beneath for captions.

### Destination doors

Two pale double doors lead to All work and About us. Approaching draws in the sign underline and opens the doors slightly; hovering opens them further; activating completes the transition.

This immersive room requires dedicated runtime graphics and interaction work in a web app. The Markdown file does not recreate that implementation.

## 10. Supporting page patterns

### Work index
A full-width work section with category controls and a reusable work-card grid. Preserve cover format, caption hierarchy and category relationships.

### Work detail
A linen project sheet with its own close action. Use project imagery, story, credits, media and a next-work destination where appropriate.

### About
Maintain the observed sequence: Hero → Expertise → Approach → Testimonials → Brands → History → Team → Awards → FAQs. Include only sections supported by genuine content.

### Journal
Use reusable journal rows for the index and a linen story sheet for individual articles. Rich text maps h2 to Heading 2 and p to Paragraph.

### Contact
A dedicated contact section with form controls, chips and a reusable submit button. Configure actual delivery and validation before launch.

### 404
Repeat the entrance-door motif: closed white leaves, a light seam, a small red lock lamp and a linked light slot. Light flickers between dim and lit states; hovering the slot opens the seam slightly.

## 11. Shared footer

Three bands:

1. Head: oversized closing line, contact actions and page links.
2. Spacer: interactive Lit Name.
3. Foot: base information, credit and social links.

The Lit Name displays the studio name beneath a fitting per letter. Pointer movement or touch lights individual letters, with beams and floor reflections that fade. It can also illuminate letters on entering view.

Footer bands stack on tablet and phone.

## 12. Content model

The existing template uses Work, Categories and Journal collections.

A practical equivalent schema for a web-app port:

### Work
- Slug and title.
- Cover image and descriptive alternative text.
- Thumbnail video, optional.
- Main film/media, optional.
- Services and category relationships.
- Poster/aspect format.
- Featured flag and display order.
- Rich-text story.
- Credits and gallery media.

### Category
- Name and slug.

### Journal story
- Slug and title.
- Cover media and alternative text.
- Rich-text body.
- Publication metadata as required by the application.

These lists are a porting model, not a complete field-by-field database export. About-page people, services, awards, questions and quotes are component content or configured lists in the original rather than separate CMS collections.

## 13. Suggested web-app adaptation

This section is a recommendation, not an existing app feature set.

- Keep the gallery language for public or showcase screens.
- Use a quiet full-width shell for functional screens.
- Reuse the same colour and text tokens for forms, settings, lists and detail views.
- Use linen sheets for focused detail or editing tasks.
- Use black 12% rules for field and table structure, black 6% for section boundaries.
- Keep red as a small status or selection mark; define a separate accessible semantic system if the app needs errors, warnings and success.
- Do not force long workflows into the immersive gallery.
- Avoid inventing dashboards, charts, account features or billing flows until requirements are known.

### Suggested reusable layers

- Theme: colour tokens, type styles, breakpoint rules.
- Shell: navigation, main content and optional footer.
- Primitives: button, link, chip, divider, field, sheet.
- Content: work card, journal row, quote, FAQ row.
- Experiences: entrance, gallery room, lit name.
- Data: work, category and story adapters.

## 14. Accessibility and performance requirements for the port

These are acceptance criteria to implement and test, not a claim that the current template has passed an audit.

- Provide a conventional list/grid alternative to the 3D gallery.
- Respect reduced-motion preferences; replace camera walks, door swings and flicker with simpler transitions.
- Preserve keyboard navigation, visible focus and meaningful link labels.
- Manage focus and restore it when menus or sheets close.
- Expose menu expanded state and prevent hidden content from receiving focus.
- Keep one accessible reading of decorative duplicated headlines and button labels.
- Provide alternative text, sufficient contrast and labelled form errors.
- Reserve media dimensions to prevent layout shifts.
- Lazy-load off-screen imagery and avoid eagerly downloading every video.
- Test touch input, viewport resizing and browser navigation.

## 15. Porting checklist

- [ ] Replace demo studio identity, contact information and promotional content intentionally.
- [ ] Establish shared colour and type tokens.
- [ ] Build the shell and responsive navigation.
- [ ] Build reusable buttons, links, fields and sheets.
- [ ] Create routes and content schemas.
- [ ] Connect real work, imagery and story content.
- [ ] Decide whether the immersive gallery is necessary.
- [ ] Implement reduced-motion and non-3D fallbacks.
- [ ] Configure contact delivery and actual destinations.
- [ ] Check desktop, tablet and phone independently.
- [ ] Review headings, focus, contrast and media alternative text.
- [ ] Verify licences, metadata and production performance.

---
Prepared from the current project’s route map, live colour and text values, section hierarchy and template documentation. No canvas content was changed.
