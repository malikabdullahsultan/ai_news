(() => {
  const root = document.documentElement;
  const storedTheme = localStorage.getItem('daily-ai-theme');
  if (storedTheme) root.dataset.theme = storedTheme;

  const SOUND_KEY = 'daily-ai-sound';
  const soundButtons = [...document.querySelectorAll('[data-sound-toggle]')];
  let soundsEnabled = localStorage.getItem(SOUND_KEY) !== 'off';
  let audioContext;

  const updateSoundControls = () => {
    root.dataset.sound = soundsEnabled ? 'on' : 'off';
    soundButtons.forEach(button => {
      button.classList.toggle('is-muted', !soundsEnabled);
      button.setAttribute('aria-pressed', String(soundsEnabled));
      button.setAttribute('aria-label', soundsEnabled ? 'Turn interface sounds off' : 'Turn interface sounds on');
      button.title = `Interface sounds: ${soundsEnabled ? 'on' : 'off'}`;
      const icon = button.querySelector('[data-sound-icon]');
      if (icon) icon.textContent = soundsEnabled ? '♪' : '×';
    });
  };

  const audioEngine = () => {
    if (audioContext) return audioContext;
    const AudioEngine = window.AudioContext || window.webkitAudioContext;
    if (!AudioEngine) return null;
    audioContext = new AudioEngine();
    return audioContext;
  };

  const playTick = (context, start, frequency, duration, volume, type) => {
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(80, frequency * .58), start + duration);
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(frequency, start);
    filter.Q.setValueAtTime(2.5, start);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + .003);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(filter).connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + .01);
  };

  const playClickClack = (soft = false) => {
    if (!soundsEnabled) return;
    const context = audioEngine();
    if (!context) return;
    if (context.state === 'suspended') context.resume().catch(() => {});
    const now = context.currentTime + .004;
    const scale = soft ? .62 : 1;
    playTick(context, now, soft ? 720 : 940, .018, .028 * scale, 'square');
    playTick(context, now + .038, soft ? 310 : 390, .034, .036 * scale, 'triangle');
  };

  updateSoundControls();
  soundButtons.forEach(button => {
    button.addEventListener('click', () => {
      const wasEnabled = soundsEnabled;
      soundsEnabled = !soundsEnabled;
      localStorage.setItem(SOUND_KEY, soundsEnabled ? 'on' : 'off');
      updateSoundControls();
      if (!wasEnabled && soundsEnabled) playClickClack();
    });
  });

  const soundTargetSelector = 'button, .button, .nav-link, .github-link, .brand, .signal-row, .archive-card, .archive-row, .search-result, .back-link, .text-link';
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const target = event.target.closest(soundTargetSelector);
    if (!target || target.matches(':disabled, [aria-disabled="true"]')) return;
    target.classList.add('is-sfx-pressed');
    playClickClack(!target.matches('button, .button, .icon-button'));
  });
  document.addEventListener('pointerup', () => document.querySelectorAll('.is-sfx-pressed').forEach(target => target.classList.remove('is-sfx-pressed')));
  document.addEventListener('pointercancel', () => document.querySelectorAll('.is-sfx-pressed').forEach(target => target.classList.remove('is-sfx-pressed')));
  document.addEventListener('keydown', event => {
    if (event.repeat || !['Enter', ' '].includes(event.key)) return;
    const target = event.target.closest(soundTargetSelector);
    if (!target || target.matches(':disabled, [aria-disabled="true"]')) return;
    playClickClack(!target.matches('button, .button, .icon-button'));
  });

  const revealItems = [...document.querySelectorAll('[data-reveal]')];
  if (revealItems.length && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('reveal-ready');
    const revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });
    requestAnimationFrame(() => revealItems.forEach(item => revealObserver.observe(item)));
  }

  const themes = ['system', 'dark', 'light'];
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.addEventListener('click', () => {
      const current = root.dataset.theme || 'system';
      const next = themes[(themes.indexOf(current) + 1) % themes.length];
      root.dataset.theme = next;
      localStorage.setItem('daily-ai-theme', next);
      button.title = `Theme: ${next}`;
      button.setAttribute('aria-label', `Change color theme. Current theme: ${next}`);
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
    const initialQuery = new URLSearchParams(window.location.search).get('q');
    if (initialQuery) searchInput.value = initialQuery;
    const render = () => {
      const query = searchInput.value.trim().toLowerCase();
      const matches = query ? index.filter(item => `${item.title} ${item.subtitle} ${item.excerpt}`.toLowerCase().includes(query)) : index.slice(0, 8);
      if (status) status.textContent = query ? `${matches.length} result${matches.length === 1 ? '' : 's'} for “${query}”` : `${index.length} reports indexed · showing the newest first`;
      searchResults.innerHTML = matches.length ? matches.map(item => {
        const text = query ? highlight(item.excerpt, query) : escapeHtml(item.excerpt);
        const importance = Math.max(1, Math.min(5, Number(item.importance) || 3));
        return `<a class="search-result importance-${importance}" href="${item.url}"><div class="search-result-top"><div class="search-result-meta"><span>${escapeHtml(item.date)}</span><span>·</span><span>${item.words ? `${item.words} words` : 'report'}</span></div><span class="importance-badge importance-${importance} is-compact" aria-label="Importance ${importance} out of 5"><span class="importance-star" aria-hidden="true"><i></i></span><span class="importance-copy"><small>IMPORTANCE</small><strong>${importance}/5</strong></span></span></div><h2>${highlight(item.subtitle || item.title, query)}</h2><p>${text}</p></a>`;
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
