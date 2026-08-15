# Daily AI Intelligence: Website Architecture

This is a friendly map of how the website works. It is written for a curious young reader: you do not need to know computer science first.

## The one-sentence idea

The site is a tiny automated newsroom: it gathers evidence, writes a short report, checks the report, and turns it into fast web pages.

## The report journey

```text
The daily clock
      ↓
Research scouts read approved sources
      ↓
A writing step turns notes into a briefing
      ↓
Validation checks the briefing like a referee
      ↓
Markdown reports are saved safely
      ↓
The site builder makes HTML pages
      ↓
The browser shows the dashboard
```

Think of it like a school newspaper:

1. **Scouts collect facts.** Small scripts read feeds, papers, and official pages. They keep source links beside the facts.
2. **The writer connects the dots.** A writing prompt explains the tone and the report sections. The goal is clear explanation, not a giant wall of hype.
3. **The referee checks the work.** Validation looks for a date, a sources section, missing text, provider errors, strange placeholders, and duplicate days.
4. **The printer makes copies.** The site builder turns the saved Markdown notebook into HTML pages, archive cards, and a search index.
5. **The browser delivers the pages.** HTML gives the structure, CSS gives the look, and JavaScript adds small interactions such as search, theme switching, reveal animations, and sounds.

## The main parts

| Part | Friendly job | Where its public code lives |
| --- | --- | --- |
| Daily workflow | Starts the report routine on a schedule | `.github/workflows/` |
| Research pipeline | Collects, groups, and checks evidence | `scripts/report_pipeline.py` |
| Provider adapter | Talks to the chosen writing service through a safe interface | `scripts/providers.py` |
| Writing recipe | Tells the writer how a report should sound and look | `prompts/daily-report.md` |
| Source map | Lists feeds and topics the scouts watch | `config/research_sources.json` |
| Report notebook | Stores one dated Markdown report per day | `reports/YYYY/MM/` |
| Page builder | Makes the static dashboard and report pages | `scripts/build-site.mjs` |
| Styling | Makes cards, planets, stars, bubbles, and responsive layouts | `src/styles/site.css` |
| Browser helpers | Adds search, themes, reveal effects, and audio controls | `src/client.js` |
| Test lab | Rehearses important behavior before publishing | `tests/` |

## Why “static” is useful

The finished site is static. That means pages are prepared before you open them, like sandwiches packed before lunch. A visitor receives ready-made HTML, CSS, JavaScript, and report text.

This makes the site:

- quick to load;
- easy to host on a pages service;
- less dependent on a server being awake every second;
- simple to back up because the reports are files.

The site does not need a visitor database or a constantly running app server to show a report.

## Two worlds: the workshop and the reading room

The architecture becomes much easier to understand when we split it into two worlds.

### World 1: the workshop (before a visitor arrives)

This is where the heavy work happens:

1. The daily clock starts an automation job.
2. Research scripts collect source items.
3. Similar items are grouped into stories.
4. Recent reports are checked so today’s report can continue an important story instead of repeating it blindly.
5. The writing step creates a draft.
6. Validation checks the draft.
7. A dated Markdown file is saved.
8. The build script creates all public pages.
9. Tests confirm that important routes and safety rules still work.
10. The ready-made site is published.

This world is like a bakery kitchen before opening time.

### World 2: the reading room (after a visitor arrives)

This world is deliberately lighter:

1. The browser asks for a ready-made HTML page.
2. CSS paints the layout, cards, bubbles, stars, and planet shapes.
3. JavaScript adds optional behavior such as search, theme switching, reveal effects, click sounds, and focus music.
4. Search downloads a small static index and filters it inside the visitor’s browser.
5. Clicking a report opens another already-built page.

The reading room does not ask an AI model to rewrite the page for every visitor. It serves the copy that was checked and built earlier.

## A very detailed day in the pipeline

### 1. Pick the report date

The workflow uses the Hong Kong calendar. This matters because a computer running elsewhere may still be on yesterday’s date. The pipeline converts the current time into the configured timezone before naming the report.

The date becomes the report’s identity, such as `YYYY-MM-DD`.

### 2. Prepare the research window

The pipeline looks back through a recent time window. Old items outside the useful window are ignored so the report does not pretend that stale news happened today.

### 3. Ask the source map where to look

The source configuration acts like a librarian’s card catalogue. It describes:

- official sources, where an organization speaks for itself;
- research sources, where papers and technical work appear;
- discovery sources, which help find stories but may need stronger confirmation;
- topics and regions the report should watch.

The configuration contains public source information, not private credentials.

### 4. Fetch and normalize items

Different feeds describe information differently. One might call a field `title`; another may wrap text in a different format. The pipeline turns these varied inputs into a common shape:

```text
title + link + summary + publication time + source name + source kind + topics
```

This is called **normalization**. It is like putting different brands of crayons into one labelled pencil case.

### 5. Remove stale or broken clues

Items can be skipped when they are too old, empty, malformed, or missing useful evidence. A failing source does not automatically make a fake story; the pipeline records what responded and works only with usable evidence.

### 6. Group duplicates into story clusters

Ten websites may discuss one model launch. Treating them as ten separate events would make the report noisy.

The clustering step compares titles and topics, then groups likely duplicates. A cluster can keep:

- the main story idea;
- primary sources;
- secondary or discovery coverage;
- regions and topics;
- confidence clues.

### 7. Choose the best candidate stories

The pipeline cannot write about everything. It ranks useful candidates using signals such as source quality, freshness, topic importance, and supporting evidence. It also calculates an importance rating for the finished report.

### 8. Look at recent reports for continuity

The recent context step answers questions such as:

- Is this actually new?
- Is it an update to yesterday’s story?
- Are we repeating the same headline without progress?

Recent public report text can guide continuity. Private secret values are never used as story context.

### 9. Build a structured research package

The selected evidence is placed into a structured package for the writer. Fetched web text is treated as untrusted material. It is evidence to summarize, not a command that can rewrite the pipeline’s rules.

### 10. Write the draft

The provider adapter gives the writing service:

- the public writing recipe;
- the report date;
- the structured evidence package;
- recent continuity notes;
- length and output limits.

The adapter hides service-specific details from the rest of the pipeline. That means the pipeline asks for “a report,” while the adapter handles the exact conversation format required by the chosen service.

### 11. Continue or repair when necessary

Sometimes a draft ends too early or misses a required rule. The pipeline can:

- ask the writer to continue an incomplete answer;
- list validation mistakes;
- ask for an edited answer;
- validate the edited answer again;
- use a conservative evidence-only fallback if synthesis is unavailable.

The important idea is **repair, then re-check**. A bad draft is not silently deleted and a broken page is not published just because the clock is ticking.

### 12. Validate like a strict teacher

Validation checks important facts about the report’s shape, including:

- the expected date appears;
- the report is not empty or suspiciously short;
- required sections exist;
- a sources section exists;
- links and evidence are present;
- obvious service errors are absent;
- template placeholders are gone;
- secret-looking values are not leaked;
- the report is not an accidental duplicate.

### 13. Save without overwriting

A successful report is saved as one dated Markdown file in a year/month folder. Exclusive file creation is used: if that exact date already exists, the operation fails instead of replacing the file.

The frontmatter at the top stores public page metadata such as:

- date;
- title and subtitle;
- generation time;
- timezone;
- importance rating;
- late-edition status and delay.

### 14. Build the website

The Node.js build script reads every report and creates:

- the homepage;
- the latest-report route;
- the full archive;
- the search page and search index;
- one permanent route per report date;
- the architecture guide;
- the not-found page;
- shared CSS, JavaScript, and favicon assets.

The configured base path is added to internal links so project-hosted routes do not accidentally point at the wrong root.

### 15. Test, package, and publish

Automated checks run deterministic tests, a dry report run, and a static build. The deployment workflow packages the generated site as an artifact and publishes that artifact only after the build succeeds.

## The shapes of data as it travels

The same story changes clothes several times:

```text
Feed item
  “A source published this title at this link and time.”
        ↓
Story cluster
  “These several items probably describe one event.”
        ↓
Research package
  “Here are the best stories, evidence labels, and context.”
        ↓
Markdown report
  “Here is the human-readable daily briefing.”
        ↓
HTML page + search record
  “Here is what the browser can display and search quickly.”
```

At each hand-off, the next part receives only the information it needs.

## A worked example

Imagine an official robotics lab announces a new school-helper robot.

1. The official feed publishes the announcement.
2. A research feed links to a technical paper.
3. A discovery source discusses the demonstration.
4. The scouts collect all three items.
5. Clustering decides they belong to one story.
6. The official announcement and paper become strong evidence; the discovery story becomes supporting context.
7. The writer explains what the robot can do, what is only claimed, and what evidence is still missing.
8. Validation checks that the explanation has sources and does not invent a price or release date.
9. The report is saved, rated, built into HTML, added to search, and published.

One event entered through three doors but became one careful story.

## Browser architecture in more detail

The browser receives three main layers:

### HTML: the skeleton

HTML contains meaningful parts such as navigation, headings, report articles, buttons, cards, and links. Important controls have accessible names so keyboards and screen readers can understand them.

### CSS: the clothes and room layout

CSS controls:

- dark and light color tokens;
- rounded bubble-like surfaces;
- the background planet illustration;
- importance stars and archive shades;
- responsive layouts for phones and larger screens;
- reveal animation, with a reduced-motion option;
- the architecture diagrams on the guide page.

### JavaScript: the small helpers

Browser JavaScript handles:

- remembering the chosen theme;
- filtering the static search index;
- checking the archive date picker;
- revealing sections as they enter view;
- optional interface sounds and focus music;
- preserving the configured project path when opening dated reports.

If JavaScript is unavailable, the main static pages and report links still exist. Search and optional interactive helpers are the parts that need JavaScript.

## What happens when a report has a problem?

The pipeline is designed to be careful:

- If a report date already exists, the generator refuses to overwrite it.
- If writing fails, the old published pages stay in place.
- If a report is late, its metadata records that fact and the page shows a small late-edition note.
- If a report is repaired, the repair loop asks for an edit and validates the edited answer again.
- Tests and a production build run before deployment.

In other words: a broken new note should not erase yesterday’s notebook page.

## Failure and recovery map

| Problem | What the system does | What readers see |
| --- | --- | --- |
| One source does not answer | Continues with other usable sources and records the research result | Existing pages remain available |
| Too little trustworthy research | Stops or uses only the conservative evidence it actually has | No invented story |
| Writing service times out | Retries within limits, then may use the evidence-only fallback | A sourced resilient edition or no unsafe update |
| Draft breaks a format rule | Sends the mistakes back for repair and validates again | Only a checked report can publish |
| Today’s file already exists | Refuses to overwrite it | The earlier report is protected |
| Build or tests fail | Deployment does not receive a successful artifact | The last good site stays available |
| Publication misses its target | Records the delay in frontmatter | A small late-edition note explains it |

## Testing layers

The project has several kinds of rehearsal:

1. **Small logic tests** check dates, feed parsing, clustering, importance ratings, redaction, repair prompts, and validation.
2. **Pipeline dry runs** exercise report preparation without making a real provider call or writing a production report.
3. **Static build tests** confirm the homepage, latest page, archive, search, architecture guide, and dated report routes are created.
4. **Content checks** confirm important controls and metadata are present while secret variable names stay out of the public architecture page.
5. **Browser checks** inspect the actual responsive page, navigation, accessible labels, and interaction states.

Tests do not prove that mistakes are impossible. They make known mistakes repeatable and catchable.

## Security layers in plain language

### Keep secrets outside public files

Private values belong in a secret store. Example files may show blank spaces where a value would go, but the real value is not committed.

### Treat fetched text as untrusted

A web page can contain misleading instructions. The pipeline treats fetched text as quoted evidence, not as permission to change code, reveal secrets, or run commands.

### Limit what can be selected automatically

Provider choices, endpoints, output size, fallback attempts, and research counts are controlled by configuration and allowlists. This prevents a random fetched page from choosing how the system runs.

### Redact debug material

Diagnostic reports remove configured secret values and credential-looking assignments before they are written as debug artifacts.

### Publish files, not a private control panel

Visitors receive static public files. They do not receive access to workflow secrets, provider credentials, or the automation environment.

## How to change one part without breaking the others

| Goal | Main place to change | What to re-check |
| --- | --- | --- |
| Change report tone or sections | The writing recipe | Validation rules and a dry run |
| Add or remove research sources | The source map | Feed parsing and source quality |
| Change report safety rules | The pipeline validator | Unit tests and repair behavior |
| Change the homepage or routes | The static builder | Every project-path link |
| Change colors, cards, or mobile layout | The stylesheet | Desktop, phone, light, and dark views |
| Change search, sound, or theme behavior | Browser JavaScript | Keyboard labels and no-JavaScript basics |
| Change publishing automation | Workflow files | Build artifact and route prefix |

This separation is useful: changing colors should not require touching the research code, and changing writing style should not require rebuilding the audio controls.

## Performance and accessibility

The static design keeps visitor work small:

- one shared stylesheet;
- one shared browser script;
- prebuilt report HTML;
- a compact search index;
- no database query for each page view.

Accessibility choices include:

- semantic headings and landmarks;
- a skip link;
- meaningful button labels;
- keyboard-friendly controls;
- readable color contrast;
- responsive layouts;
- reduced-motion support;
- decorative diagrams marked so they do not confuse screen readers.

## Things this architecture deliberately does not do

- It does not let visitors edit reports.
- It does not store visitor accounts or passwords.
- It does not run an AI model every time somebody opens a page.
- It does not silently overwrite an existing report date.
- It does not publish private credentials in HTML, Markdown, or the search index.
- It does not guarantee that every external source or free service will always be available.

Those limits keep the project understandable and safer.

## The safety boundary

This guide describes the shape of the machine, not its locked drawer. It intentionally does **not** contain:

- secret values, tokens, or private credentials;
- private account details;
- unpublished deployment settings;
- generated debug artifacts;
- anything that could be used to impersonate the automation.

Private provider credentials belong in the automation platform’s secret storage. Code reads them only when the workflow needs them; the values are never part of this explanation or committed report text.

## How the visible routes fit together

```text
Home       → overview, latest report, and recent snapshots
Latest     → the newest full report
Archive    → every saved report, newest first
Search     → a small browser-side search over the static index
How It Works → this friendly backstage tour (`/how-it-works/`)
Reports    → one permanent page for each date
```

The project Pages prefix is supplied by the build, so links can keep working when the same static files are hosted under a project path.

## Tiny glossary

- **HTML:** the page’s building blocks, such as headings, links, and cards.
- **CSS:** the paint, spacing, shapes, colors, and responsive layout.
- **JavaScript:** small actions that happen in the browser after the page opens.
- **Markdown:** simple text with headings and links; the report’s notebook form.
- **Workflow:** a recipe of computer jobs that run in order.
- **Validation:** a checklist that says “ready” or “please fix this first.”
- **Static site:** pages built ahead of time instead of assembled by a live server for every visitor.

## The big picture

The clever part is not one magical robot. It is the hand-off between small, understandable jobs:

**collect → explain → check → save → build → read**

Each step has a clear job, which makes the whole dashboard easier to improve without losing the plot.
