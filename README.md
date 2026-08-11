# Daily AI Intelligence

Daily AI Intelligence is a static, source-aware AI news dashboard designed to explain what changed, why it matters, and where the evidence comes from. It publishes one Hong Kong-dated report per day and keeps the complete archive searchable.

## The short version

```text
03:30 Hong Kong
      ↓
GitHub Actions researches feeds and papers
      ↓
GitHub Models writes the report using prompts/daily-report.md
      ↓
Validation rejects broken or suspicious output
      ↓
Markdown report is committed
      ↓
GitHub Pages rebuilds the static dashboard
```

There is no VPS, database, always-running server, manual copy/paste step, or required paid API key.

## Default cost model

The production configuration is intentionally zero-cost-first:

- GitHub Pages: free within GitHub's applicable limits.
- GitHub Actions: subject to the account's GitHub plan and usage limits.
- GitHub Models: uses the currently available free, rate-limited allowance through `GITHUB_TOKEN`.
- OpenAI API: **not required by default**.
- VPS: **not required**.

The default environment is:

```text
AI_PROVIDER=github-models
AI_MODEL=auto
FREE_ONLY=true
```

`AI_MODEL=auto` reads the GitHub Models catalog and selects an eligible text model using capability and output-length heuristics. The actual selected model is stored in ignored build metadata. If free inference is unavailable or rate-limited, the workflow fails safely; it does not switch to a paid endpoint and does not overwrite yesterday's report.

Free allowances, catalogs, endpoints, and model availability can change. The code treats those as runtime conditions instead of assuming unlimited quota.

## Local commands

Requires Node 20+ and Python 3.11+; the default workflow uses Python 3.12 and Node 20.

```bash
npm run report:dry   # no network, no model call, no production report
npm run build        # build dist/ for GitHub Pages
python -m pytest     # run deterministic tests
```

To run the real generator locally, set `GITHUB_TOKEN` in the environment and use the same safe defaults as the workflow:

```bash
AI_PROVIDER=github-models AI_MODEL=auto FREE_ONLY=true python scripts/report_pipeline.py
```

Never paste a token into the repository or into Codex chat.

## Project map

```text
prompts/daily-report.md              canonical writing prompt
config/research_sources.json         official feeds, discovery feeds, global/China watchlist
scripts/report_pipeline.py           research → continuity → synthesis → validation → Markdown
scripts/providers.py                  GitHub Models default; OpenAI explicitly opt-in only
scripts/build-site.mjs                static HTML, archive, latest, search index, Markdown renderer
src/styles/site.css                   responsive dashboard and long-form reading styles
src/client.js                         theme switcher, date picker, static search
reports/YYYY/MM/YYYY-MM-DD.md         production reports
data/demo/                            sample-only data, never placed in production archive
.github/workflows/daily-report.yml   03:30 HKT generation workflow
.github/workflows/deploy.yml         GitHub Pages artifact and deployment
.github/workflows/ci.yml             tests, dry run, and build checks
```

## Changing the writing style

Edit only:

`prompts/daily-report.md`

The generator loads this file at runtime. You do not need to edit Python, JavaScript, or workflow code to change tone, teaching style, sections, humor, China coverage, or preferred report length.

## Research and safety

The research pass checks official feeds/pages first, research feeds, repositories, and discovery sources. It looks back approximately 36 hours, combines duplicate coverage, preserves source provenance, and performs a Chinese/global watchlist check on every run.

Fetched text is treated as untrusted data. It is wrapped inside structured research data and explicitly cannot change the application's instructions, request secrets, or execute commands. The final report is rejected if it is empty, missing a date or SOURCES section, contains obvious provider errors, contains template placeholders, or would overwrite an existing report.

## GitHub Models details

The provider uses the official catalog endpoint and inference endpoint:

```text
GET  https://models.github.ai/catalog/models
POST https://models.github.ai/inference/chat/completions
```

The Actions job requests only:

```yaml
permissions:
  contents: write
  models: read
```

The optional `OpenAIProvider` exists for a future advanced configuration, but it requires an explicit `AI_PROVIDER=openai`, `FREE_ONLY=false`, and `OPENAI_API_KEY`. It cannot activate automatically.

## GitHub Pages and domain

The Pages artifact is static and works on the repository Pages URL. The expected repository fallback is:

`https://malikabdullahsultan.github.io/ai_news/`

The requested `CNAME` file for `ai-malik.duckdns.org` is included as a prepared artifact. It is not proof that the domain is active. GitHub Pages custom domains need the Pages setting plus DNS controlled by the domain owner. A `*.duckdns.org` hostname is a DuckDNS-managed dynamic-DNS name, not an independently owned DNS zone where the account can create the CNAME GitHub Pages requires. Until that is verified, use the native `github.io` URL.

If a separately owned domain is used later, set its subdomain CNAME directly to the repository's Pages hostname, configure the custom domain in **Settings → Pages**, wait for DNS/HTTPS provisioning, and then build with `PUBLIC_BASE_PATH=/`.

## Troubleshooting

- **No report generated:** open the failed Actions run. A missing/denied GitHub Models allowance, all research feeds failing, or validation failure stops publication intentionally.
- **Pages looks old:** check the Deploy workflow and confirm Pages is set to **GitHub Actions**.
- **Links include the wrong path:** project Pages uses `PUBLIC_BASE_PATH=/ai_news/`; a custom root domain uses `PUBLIC_BASE_PATH=/`.
- **A duplicate date fails:** that is intentional. The generator never silently overwrites an existing report.
- **The site has demo content:** the production `reports/` folder is empty. Run the workflow successfully; demo files live under `data/demo/` and are not archive entries.
