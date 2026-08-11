# Daily AI Intelligence — Implementation Plan

## Architecture

Daily AI Intelligence will be a static GitHub Pages site backed by a scheduled GitHub Actions workflow. The workspace starts without an existing framework or package lock, so the implementation uses a small dependency-free Node site builder and Python's standard library for research, generation, validation, and tests. This keeps local dry runs reproducible and avoids requiring a server, database, or paid API key.

```text
GitHub Actions (03:30 Asia/Hong_Kong)
        |
        +--> Python research pipeline
        |      - official feeds/pages first
        |      - 30–36 hour window
        |      - source clustering + structured JSON
        |      - Chinese/global watchlist
        |
        +--> SambaNovaProvider (default)
        |      - SAMBANOVA_API_KEY only
        |      - verified Free Tier model allowlist
        |      - catalog-based active-model check
        |      - FREE_ONLY=true fail-safe
        |
        +--> validation + Markdown report
        |      - no overwrite of existing report
        |      - Hong Kong date
        |      - private build metadata
        |
        +--> commit generated report
               |
               +--> Pages deployment workflow
                      - static HTML/CSS/JS
                      - archive/latest/calendar/search
```

## Site structure

- `reports/YYYY/MM/YYYY-MM-DD.md` — production report content and frontmatter.
- `scripts/build-site.mjs` — static site builder, Markdown renderer, archive/index/search generation.
- `src/styles/site.css` and `src/client.js` — responsive reader experience, theme switcher, client-side search, archive calendar.
- `data/demo/` — sample-only content used when the production report archive is empty; it is never copied into the production archive.
- `dist/` — generated Pages artifact and intentionally ignored build output.

## Generation structure

- `scripts/report_pipeline.py` — date handling, feed fetching, source normalization, clustering, continuity, provider calls, validation, and report persistence.
- `scripts/providers.py` — provider abstraction with SambaNova's Free Tier as the default and an explicitly opt-in OpenAI Responses API provider for future advanced use.
- `config/research_sources.json` — editable source/watchlist configuration.
- `data/research/` — structured research artifacts.
- `data/report-meta/` — build metadata such as the model actually selected; no credentials.
- `prompts/daily-report.md` — canonical user-authored report prompt loaded at runtime.

## Safety and cost rules

- The default is `AI_PROVIDER=sambanova`, `AI_MODEL=auto`, and `FREE_ONLY=true`.
- The workflow passes `SAMBANOVA_API_KEY` only to the generator and uses `contents: write` for the report commit.
- No OpenAI key is required. Paid OpenAI support cannot activate unless explicitly configured with `AI_PROVIDER=openai` and `FREE_ONLY=false`.
- If SambaNova's Free Tier is unavailable or the free allowance is exhausted, the workflow fails without touching the existing report or site.
- Fetched material is treated as untrusted data and is fenced before model synthesis.
- Existing report paths are never silently overwritten.

## Verification plan

The project will test Hong Kong date conversion, Markdown/frontmatter parsing, report ordering, latest selection, search indexing, validation, duplicate prevention, safe no-key behavior, dry runs, research clustering, and the production site build. The final checks will run `python -m pytest`, `python scripts/report_pipeline.py --dry-run`, and `npm run build`.

## Domain decision

The site will include the requested `CNAME` file, but documentation will distinguish a GitHub Pages custom-domain setting from DNS ownership. GitHub Pages requires the custom domain to resolve with a supported DNS record to the Pages hostname; DuckDNS can point an owned domain at a DuckDNS name, but it does not itself turn a `*.duckdns.org` hostname into an independently configurable DNS zone. Native `github.io` Pages hosting remains the safe fallback until the custom-domain/DNS setup is actually verified.
