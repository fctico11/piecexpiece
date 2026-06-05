(function () {
  'use strict';

  // ── Token names to track (mirrors tokens.json colors + shapes) ────────────
  const TOKEN_NAMES = [
    '--color-primary', '--color-primary-light', '--color-primary-dark',
    '--color-turquoise', '--color-turquoise-vibrant',
    '--color-amber', '--color-coral', '--color-emerald', '--color-sapphire',
    '--color-white', '--color-beige', '--color-grout',
    '--color-text', '--color-text-light',
    '--shape-1-tl', '--shape-1-br',
    '--shape-2-tr', '--shape-2-bl',
    '--shape-3-tl', '--shape-3-tr', '--shape-3-br', '--shape-3-bl',
  ];

  // ── Read current CSS variable values ───────────────────────────────────────
  const rootStyle = getComputedStyle(document.documentElement);
  const tokenValues = {};
  TOKEN_NAMES.forEach(name => {
    tokenValues[name] = rootStyle.getPropertyValue(name).trim();
  });

  // ── Normalize any color string → "rgb(r, g, b)" for comparison ─────────────
  const _colorEl = document.createElement('div');
  document.body.appendChild(_colorEl);
  function normalizeColor(val) {
    _colorEl.style.color = '';
    _colorEl.style.color = val;
    return getComputedStyle(_colorEl).color; // always rgb() or rgba()
  }

  // Build reverse map: "rgb(...)" → "--color-xxx"
  const reverseMap = {};
  TOKEN_NAMES.forEach(name => {
    const normalized = normalizeColor(tokenValues[name]);
    if (normalized && normalized !== 'rgba(0, 0, 0, 0)') {
      reverseMap[normalized] = name;
    }
  });

  // ── Highlight overlay ──────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed', 'pointer-events:none', 'z-index:2147483647',
    'border:2px solid #3da89e', 'background:rgba(61,168,158,0.08)',
    'box-sizing:border-box', 'transition:top .1s,left .1s,width .1s,height .1s',
    'display:none',
  ].join(';');

  const overlayLabel = document.createElement('div');
  overlayLabel.style.cssText = [
    'position:absolute', 'top:-26px', 'left:0',
    'background:#3da89e', 'color:#fff', 'font:600 11px/1 sans-serif',
    'padding:4px 8px', 'white-space:nowrap', 'border-radius:3px 3px 0 0',
  ].join(';');
  overlay.appendChild(overlayLabel);
  document.body.appendChild(overlay);

  function showOverlay(el, label) {
    const r = el.getBoundingClientRect();
    overlay.style.top    = r.top + 'px';
    overlay.style.left   = r.left + 'px';
    overlay.style.width  = r.width + 'px';
    overlay.style.height = r.height + 'px';
    overlayLabel.textContent = label || el.tagName.toLowerCase();
    overlay.style.display = 'block';
  }

  function hideOverlay() {
    overlay.style.display = 'none';
  }

  // ── Section class → token (for color-mix tinted sections) ───────────────
  const SECTION_TOKEN_MAP = {
    'mosaic-section--amber':    { token: '--color-amber',    label: 'Amber Section' },
    'mosaic-section--coral':    { token: '--color-coral',    label: 'Coral Section' },
    'mosaic-section--emerald':  { token: '--color-emerald',  label: 'Emerald Section' },
    'mosaic-section--sapphire': { token: '--color-sapphire', label: 'Sapphire Section' },
    'mosaic-section--light':    { token: '--color-beige',    label: 'Light Section' },
  };

  // Walk up DOM to find the nearest mosaic section ancestor and its token
  function findSectionToken(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      if (node.classList) {
        for (const [cls, meta] of Object.entries(SECTION_TOKEN_MAP)) {
          if (node.classList.contains(cls)) {
            return { sectionEl: node, token: meta.token, label: meta.label, value: tokenValues[meta.token] };
          }
        }
      }
      node = node.parentElement;
    }
    return null;
  }

  // ── Resolve which tokens an element uses ───────────────────────────────────
  function getTokensForElement(el) {
    const cs = getComputedStyle(el);
    const found = [];
    const seen = new Set();

    const checks = [
      { prop: 'backgroundColor', label: 'Background' },
      { prop: 'color',           label: 'Text' },
      { prop: 'borderTopColor',  label: 'Border' },
    ];

    for (const { prop, label } of checks) {
      const val = cs[prop];
      if (!val || val === 'rgba(0, 0, 0, 0)' || val === 'transparent') continue;
      const token = reverseMap[val];
      if (token && !seen.has(token)) {
        seen.add(token);
        found.push({ token, label, value: tokenValues[token] });
      }
    }

    // Walk up to catch inherited solid bg colours that didn't match
    if (found.length === 0 && el.parentElement && el.parentElement !== document.body) {
      return getTokensForElement(el.parentElement);
    }

    return found;
  }

  // ── Mouse events ──────────────────────────────────────────────────────────
  let lastHovered = null;

  document.addEventListener('mouseover', e => {
    if (e.target === overlay || e.target === overlayLabel) return;
    lastHovered = e.target;

    // Prefer highlighting the whole section when hovering inside one
    const section = findSectionToken(e.target);
    if (section) {
      showOverlay(section.sectionEl, section.label + ' — click to edit color');
    } else {
      const tokens = getTokensForElement(e.target);
      const label = tokens.length ? tokens.map(t => t.label).join(' · ') : e.target.tagName.toLowerCase();
      showOverlay(e.target, label);
    }
  }, true);

  document.addEventListener('mouseout', e => {
    if (e.relatedTarget && overlay.contains(e.relatedTarget)) return;
    hideOverlay();
  }, true);

  document.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();

    const el = e.target;

    // Section token takes priority — always surface it when clicking inside a section
    const section = findSectionToken(el);
    const sectionTokenEntry = section
      ? [{ token: section.token, label: section.label, value: section.value }]
      : [];

    // Also collect any direct color tokens from the clicked element itself
    const elementTokens = getTokensForElement(el).filter(t => !sectionTokenEntry.some(s => s.token === t.token));
    const tokens = [...sectionTokenEntry, ...elementTokens];

    const r = el.getBoundingClientRect();

    window.parent.postMessage({
      type: 'EDITOR_CLICK',
      tokens,
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      tag: el.tagName,
      cls: typeof el.className === 'string' ? el.className : '',
    }, '*');
  }, true);

  // ── Receive token updates from parent ─────────────────────────────────────
  window.addEventListener('message', e => {
    if (!e.data || e.data.type !== 'UPDATE_TOKEN') return;
    const { token, value } = e.data;
    document.documentElement.style.setProperty(token, value);
    tokenValues[token] = value;
    const normalized = normalizeColor(value);
    if (normalized) reverseMap[normalized] = token;
  });

  // ── Receive font updates from parent ──────────────────────────────────────
  window.addEventListener('message', e => {
    if (!e.data || e.data.type !== 'UPDATE_FONT') return;
    const { role, family } = e.data; // role: 'heading' | 'body'
    const prop = role === 'heading' ? '--font-heading' : '--font-body';
    const fallback = role === 'heading' ? 'Georgia, serif' : '-apple-system, sans-serif';
    document.documentElement.style.setProperty(prop, `'${family}', ${fallback}`);

    // Inject Google Fonts link for the new font
    const existing = document.getElementById(`editor-font-${role}`);
    if (existing) existing.remove();
    const link = document.createElement('link');
    link.id = `editor-font-${role}`;
    link.rel = 'stylesheet';
    const param = family.replace(/ /g, '+');
    const weights = role === 'heading' ? 'ital,wght@0,400;1,400' : 'wght@300;400;500;600';
    link.href = `https://fonts.googleapis.com/css2?family=${param}:${weights}&display=swap`;
    document.head.appendChild(link);
  });
})();
