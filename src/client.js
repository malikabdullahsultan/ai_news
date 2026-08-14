(() => {
  const root = document.documentElement;
  const storedTheme = localStorage.getItem('daily-ai-theme');
  if (storedTheme) root.dataset.theme = storedTheme;

  const SOUND_KEY = 'daily-ai-sound';
  const soundButtons = [...document.querySelectorAll('[data-sound-toggle]')];
  const musicButtons = [...document.querySelectorAll('[data-focus-music]')];
  let soundsEnabled = localStorage.getItem(SOUND_KEY) !== 'off';
  let audioContext;
  let focusMusicPlaying = false;
  let focusMusicStarting = false;
  let focusMaster;
  let focusFilter;
  let focusTimer;
  let focusNextTime = 0;
  let focusBarIndex = 0;

  const FOCUS_BAR_SECONDS = 4;
  const focusProgression = [
    [130.81, 164.81, 196.00, 246.94],
    [110.00, 130.81, 164.81, 220.00],
    [87.31, 130.81, 164.81, 196.00],
    [98.00, 146.83, 196.00, 246.94],
  ];

  const updateSoundControls = () => {
    root.dataset.sound = soundsEnabled ? 'on' : 'off';
    soundButtons.forEach(button => {
      button.classList.toggle('is-muted', !soundsEnabled);
      button.setAttribute('aria-pressed', String(soundsEnabled));
      button.setAttribute('aria-label', soundsEnabled ? 'Turn interface sounds off' : 'Turn interface sounds on');
      button.title = `Button sounds: ${soundsEnabled ? 'on' : 'off'}`;
      const icon = button.querySelector('[data-sound-icon]');
      if (icon) icon.textContent = soundsEnabled ? '▦' : '×';
    });
  };

  const updateFocusControls = () => {
    root.dataset.focusMusic = focusMusicPlaying ? 'playing' : 'off';
    musicButtons.forEach(button => {
      button.classList.toggle('is-playing', focusMusicPlaying);
      button.setAttribute('aria-pressed', String(focusMusicPlaying));
      button.setAttribute('aria-label', focusMusicPlaying ? 'Stop focus music' : 'Start focus music');
      button.title = `Focus music: ${focusMusicPlaying ? 'playing' : 'off'}`;
    });
  };

  const audioEngine = () => {
    if (audioContext) return audioContext;
    const AudioEngine = window.AudioContext || window.webkitAudioContext;
    if (!AudioEngine) return null;
    audioContext = new AudioEngine();
    return audioContext;
  };

  const scheduleFocusBar = (context, output, start, frequencies, barIndex) => {
    frequencies.slice(0, 3).forEach((frequency, index) => {
      const tone = context.createOscillator();
      const gain = context.createGain();
      tone.type = index === 0 ? 'triangle' : 'sine';
      tone.frequency.setValueAtTime(frequency, start);
      tone.detune.setValueAtTime(index % 2 ? 3 : -3, start);
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(index === 0 ? .026 : .018, start + .7);
      gain.gain.setValueAtTime(index === 0 ? .022 : .014, start + 3.55);
      gain.gain.exponentialRampToValueAtTime(.0001, start + 4.35);
      tone.connect(gain).connect(output);
      tone.start(start);
      tone.stop(start + 4.4);
    });

    const pattern = barIndex % 2
      ? [0, 2, 1, 3, 2, 1, 3, 2]
      : [0, 1, 2, 3, 2, 1, 2, 3];
    pattern.forEach((noteIndex, step) => {
      const noteStart = start + step * .5;
      const bell = context.createOscillator();
      const bellGain = context.createGain();
      bell.type = 'sine';
      bell.frequency.setValueAtTime(frequencies[noteIndex] * 2, noteStart);
      bell.frequency.exponentialRampToValueAtTime(frequencies[noteIndex] * 1.995, noteStart + .42);
      bellGain.gain.setValueAtTime(.0001, noteStart);
      bellGain.gain.exponentialRampToValueAtTime(step % 4 === 0 ? .019 : .012, noteStart + .035);
      bellGain.gain.exponentialRampToValueAtTime(.0001, noteStart + .44);
      bell.connect(bellGain).connect(output);
      bell.start(noteStart);
      bell.stop(noteStart + .46);
    });
  };

  const scheduleFocusMusic = () => {
    const context = audioContext;
    if (!focusMusicPlaying || !context || !focusMaster) return;
    while (focusNextTime < context.currentTime + 8) {
      const chord = focusProgression[focusBarIndex % focusProgression.length];
      scheduleFocusBar(context, focusMaster, focusNextTime, chord, focusBarIndex);
      focusNextTime += FOCUS_BAR_SECONDS;
      focusBarIndex += 1;
    }
  };

  const startFocusMusic = async () => {
    if (focusMusicPlaying || focusMusicStarting) return;
    focusMusicStarting = true;
    const context = audioEngine();
    if (!context) {
      focusMusicStarting = false;
      return;
    }
    if (context.state === 'suspended') {
      try { await context.resume(); } catch {
        focusMusicStarting = false;
        return;
      }
    }
    focusMaster = context.createGain();
    focusFilter = context.createBiquadFilter();
    focusFilter.type = 'lowpass';
    focusFilter.frequency.setValueAtTime(1850, context.currentTime);
    focusFilter.Q.setValueAtTime(.55, context.currentTime);
    focusMaster.gain.setValueAtTime(.0001, context.currentTime);
    focusMaster.gain.exponentialRampToValueAtTime(.42, context.currentTime + 1.1);
    focusMaster.connect(focusFilter).connect(context.destination);
    focusMusicPlaying = true;
    focusNextTime = context.currentTime + .06;
    focusBarIndex = 0;
    scheduleFocusMusic();
    focusTimer = window.setInterval(scheduleFocusMusic, 1500);
    focusMusicStarting = false;
    updateFocusControls();
  };

  const stopFocusMusic = () => {
    focusMusicPlaying = false;
    if (focusTimer) window.clearInterval(focusTimer);
    focusTimer = undefined;
    const master = focusMaster;
    const filter = focusFilter;
    focusMaster = undefined;
    focusFilter = undefined;
    if (master && audioContext) {
      const now = audioContext.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(Math.max(.0001, master.gain.value), now);
      master.gain.exponentialRampToValueAtTime(.0001, now + .55);
      window.setTimeout(() => {
        try { master.disconnect(); } catch {}
        try { filter?.disconnect(); } catch {}
      }, 650);
    }
    updateFocusControls();
  };

  const playBlockStrike = (context, output, start, frequency, volume) => {
    const body = context.createOscillator();
    const knock = context.createOscillator();
    const bodyGain = context.createGain();
    const knockGain = context.createGain();
    const tone = context.createBiquadFilter();

    body.type = 'triangle';
    body.frequency.setValueAtTime(frequency, start);
    body.frequency.exponentialRampToValueAtTime(frequency * .72, start + .065);
    knock.type = 'sine';
    knock.frequency.setValueAtTime(frequency * 1.86, start);
    knock.frequency.exponentialRampToValueAtTime(frequency * 1.35, start + .026);
    tone.type = 'lowpass';
    tone.frequency.setValueAtTime(2300, start);
    tone.Q.setValueAtTime(1.2, start);

    bodyGain.gain.setValueAtTime(.0001, start);
    bodyGain.gain.exponentialRampToValueAtTime(volume, start + .002);
    bodyGain.gain.exponentialRampToValueAtTime(.0001, start + .07);
    knockGain.gain.setValueAtTime(.0001, start);
    knockGain.gain.exponentialRampToValueAtTime(volume * .48, start + .001);
    knockGain.gain.exponentialRampToValueAtTime(.0001, start + .028);

    body.connect(bodyGain).connect(tone);
    knock.connect(knockGain).connect(tone);
    tone.connect(output);
    body.start(start);
    knock.start(start);
    body.stop(start + .075);
    knock.stop(start + .035);

    const noiseLength = Math.max(1, Math.floor(context.sampleRate * .012));
    const noiseBuffer = context.createBuffer(1, noiseLength, context.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let index = 0; index < noiseLength; index += 1) {
      noiseData[index] = (Math.random() * 2 - 1) * (1 - index / noiseLength);
    }
    const noise = context.createBufferSource();
    const noiseFilter = context.createBiquadFilter();
    const noiseGain = context.createGain();
    noise.buffer = noiseBuffer;
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(1450, start);
    noiseFilter.Q.setValueAtTime(.85, start);
    noiseGain.gain.setValueAtTime(volume * .7, start);
    noiseGain.gain.exponentialRampToValueAtTime(.0001, start + .014);
    noise.connect(noiseFilter).connect(noiseGain).connect(output);
    noise.start(start);
    noise.stop(start + .016);
  };

  const playClickClack = (soft = false) => {
    if (!soundsEnabled) return;
    const context = audioEngine();
    if (!context) return;
    if (context.state === 'suspended') context.resume().catch(() => {});
    const now = context.currentTime + .004;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-12, now);
    compressor.knee.setValueAtTime(8, now);
    compressor.ratio.setValueAtTime(7, now);
    compressor.attack.setValueAtTime(.002, now);
    compressor.release.setValueAtTime(.08, now);
    compressor.connect(context.destination);
    const scale = soft ? .72 : 1;
    playBlockStrike(context, compressor, now, soft ? 520 : 610, .075 * scale);
    playBlockStrike(context, compressor, now + .068, soft ? 330 : 380, .095 * scale);
  };

  updateSoundControls();
  updateFocusControls();
  musicButtons.forEach(button => {
    button.addEventListener('click', () => {
      if (focusMusicPlaying) stopFocusMusic();
      else startFocusMusic();
    });
  });
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
