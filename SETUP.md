# Setup checklist

## ✅ DONE BY CODEX

- Built the static Daily AI Intelligence dashboard.
- Added the canonical prompt loader at `prompts/daily-report.md`.
- Added source research, duplicate clustering, continuity, validation, and safe persistence.
- Added SambaNova's no-payment-method Free Tier as the default provider with `FREE_ONLY=true`.
- Added the 03:30 Asia/Hong_Kong workflow and GitHub Pages deployment workflow.
- Added responsive reading, archive, date picker, search, dark/light/system themes, tests, and demo mode.
- Added the requested `CNAME` file and documented why DuckDNS activation still needs verification.

## YOU NEED TO CLICK THESE

1. Create a SambaCloud account at `https://cloud.sambanova.ai/`, leave the account **without a payment method** so SambaNova applies its Free Tier, then follow `https://docs.sambanova.ai/docs/en/get-started/api-keys-urls` to create an API key and copy it once.
2. In GitHub, open **Settings → Secrets and variables → Actions → New repository secret**. Name it `SAMBANOVA_API_KEY`, then paste the SambaNova key there. Never paste it into the repository or Codex chat.
3. In **Settings → Actions → General**, under **Workflow permissions**, allow workflows to read and write repository contents. Save.
4. In **Settings → Pages**, choose **GitHub Actions** as the build/deployment source.
5. Open **Actions → Daily AI Intelligence → Run workflow** once. The workflow uses `FREE_ONLY=true` and will fail safely if the free quota is unavailable.
6. Open **Actions → Deploy Daily AI Intelligence** and confirm the Pages deployment succeeds.
7. Visit the Pages URL shown in **Settings → Pages**. The initial site may show the clearly labeled demo until the first real report is generated.

## Optional domain step

`ai-malik.duckdns.org` cannot be declared active from this repository. GitHub Pages needs a supported DNS record pointing at the Pages hostname, and a DuckDNS subdomain is managed by DuckDNS rather than being a DNS zone you can edit for that purpose. Keep using the native `github.io` URL unless you own a separate domain or have independently verified a supported DNS arrangement. Do not turn on **Enforce HTTPS** until GitHub reports that the certificate is ready.
