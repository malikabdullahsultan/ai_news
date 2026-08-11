(() => {
  const root = document.documentElement;
  const storedTheme = localStorage.getItem('daily-ai-theme');
  if (storedTheme) root.dataset.theme = storedTheme;

  const themes = ['system', 'dark', 'light'];
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.addEventListener('click', () => {
      const current = root.dataset.theme || 'system';
      const next = themes[(themes.indexOf(current) + 1) % themes.length];
      root.dataset.theme = next;
      localStorage.setItem('daily-ai-theme', next);
      button.title = `Theme: ${next}`;
    });
  });

  const dateInput = document.querySelector('[data-report-date]');
  const dateButton = document.querySelector('[data-date-go]');
  const feedback = document.querySelector('[data-date-feedback]');
  if (dateInput && dateButton) {
    const available = new Set(JSON.parse(document.querySelector('[data-report-dates]')?.dataset.reportDates || '[]'));
    dateButton.addEventListener('click', () => {
      const date = dateInput.value;
      if (!date) { feedback.textContent = 'Choose a date first.'; return; }
      if (!available.has(date)) { feedback.textContent = 'No report is published for that date yet.'; return; }
      window.location.href = `${window.DAILY_AI_BASE}reports/${date}/`;
    });
    dateInput.addEventListener('change', () => { feedback.textContent = ''; });
  }

  const searchInput = document.querySelector('[data-search-input]');
  const searchResults = document.querySelector('[data-search-results]');
  const status = document.querySelector('[data-search-status]');
  if (searchInput && searchResults) {
    let index = [];
    const render = () => {
      const query = searchInput.value.trim().toLowerCase();
      const matches = query ? index.filter(item => `${item.title} ${item.subtitle} ${item.excerpt}`.toLowerCase().includes(query)) : index.slice(0, 8);
      if (status) status.textContent = query ? `${matches.length} result${matches.length === 1 ? '' : 's'} for “${query}”` : `${index.length} reports indexed · showing the newest first`;
      searchResults.innerHTML = matches.length ? matches.map(item => {
        const text = query ? highlight(item.excerpt, query) : escapeHtml(item.excerpt);
        return `<a class="search-result" href="${item.url}"><div class="search-result-meta"><span>${escapeHtml(item.date)}</span><span>·</span><span>${item.words ? `${item.words} words` : 'report'}</span></div><h2>${highlight(item.subtitle || item.title, query)}</h2><p>${text}</p></a>`;
      }).join('') : '<div class="empty-state"><span class="empty-icon">⌁</span><h3>No matching signal.</h3><p>Try a company, model, or concept from the daily reports.</p></div>';
    };
    fetch(`${window.DAILY_AI_BASE}index.json`).then(response => response.json()).then(data => { index = data; render(); }).catch(() => { if (status) status.textContent = 'The archive index could not be loaded.'; });
    searchInput.addEventListener('input', render);
  }

  function escapeHtml(value = '') { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
  function highlight(value, query) {
    const safe = escapeHtml(value);
    if (!query) return safe;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safe.replace(new RegExp(`(${escaped})`, 'ig'), '<mark>$1</mark>');
  }
})();
