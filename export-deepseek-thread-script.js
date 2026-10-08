/**
 * DeepSeek Thread Exporter
 * ------------------------------------------------------------------
 * Extracts a full DeepSeek conversation — user messages, model
 * reasoning (if present), and model responses — into a plain-text
 * or Markdown file.
 *
 * Works around the virtualized list that breaks Ctrl+A / Ctrl+C /
 * Ctrl+P on long threads.
 *
 * HOW TO USE
 *   1. Open the DeepSeek conversation you want to export.
 *   2. Scroll to the very top. Wait for older messages to load.
 *   3. Open DevTools (F12 / Cmd+Opt+I), go to Console.
 *   4. If paste is blocked, type "allow pasting" and Enter.
 *   5. Paste this whole script and press Enter.
 *   6. Click "Start export" in the overlay.
 *   7. Wait. A .txt file downloads when finished.
 *
 * License: MIT. No affiliation with DeepSeek.
 */
(() => {
  'use strict';

  const CONFIG = {
    format: 'txt',              // 'txt' or 'md'
    includeReasoning: true,     // include model reasoning blocks
    sweepStepRatio: 0.6,
    sweepWaitMs: 700,
    settleMs: 2000,
    maxIters: 2000,
    filenamePrefix: 'deepseek-thread',
    confirmBeforeStart: true,
  };

  // ─────────────────────────────────────────────────────────────
  // Container
  // ─────────────────────────────────────────────────────────────
  const container =
    document.querySelector('.ds-virtual-list') ||
    document.querySelector('.ds-scroll-area');

  if (!container) {
    alert(
      'DeepSeek Thread Exporter: could not find the conversation container.\n\n' +
      'Make sure you are on a specific conversation page.'
    );
    return;
  }

  const isReverse = getComputedStyle(container).flexDirection.includes('reverse');
  const maxScroll = container.scrollHeight - container.clientHeight;
  const topPos = isReverse ? -maxScroll : 0;
  const bottomPos = isReverse ? 0 : maxScroll;

  // ─────────────────────────────────────────────────────────────
  // Overlay UI (shadow DOM)
  // ─────────────────────────────────────────────────────────────
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      .panel {
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        background:#101418; color:#e6edf3; padding:16px; border-radius:12px;
        box-shadow:0 12px 40px rgba(0,0,0,.5); width:340px; border:1px solid #2a3038;
      }
      h3 { margin:0 0 10px; font-size:14px; color:#fff; font-weight:600; }
      .row { margin:8px 0; }
      .muted { color:#8b949e; font-size:12px; }
      .warn { color:#ffb84d; }
      .ok { color:#2fbf71; }
      .stat { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
              font-size:12px; color:#7ee787; }
      button { background:#2a7fff; color:#fff; border:0; padding:8px 14px;
        border-radius:8px; cursor:pointer; font-size:13px; font-weight:500;
        margin-right:8px; }
      button:hover { background:#1e6ae0; }
      button.ghost { background:transparent; border:1px solid #30363d; color:#c9d1d9; }
      button.ghost:hover { background:#1a1f24; }
      .bar { height:6px; background:#1a1f24; border-radius:3px;
             overflow:hidden; margin-top:10px; }
      .bar > div { height:100%; width:0%;
        background:linear-gradient(90deg,#2a7fff,#7ee787);
        transition:width .3s; }
      ol { padding-left:18px; margin:8px 0; }
      li { margin:4px 0; font-size:12px; }
    </style>
    <div class="panel">
      <h3>DeepSeek Thread Exporter</h3>
      <div id="body"></div>
      <div class="bar"><div id="progress"></div></div>
      <div class="stat row" id="stat" style="display:none"></div>
      <div class="row" id="actions"></div>
    </div>
  `;

  const $ = id => shadow.getElementById(id);
  const body = $('body');
  const stat = $('stat');
  const progress = $('progress');
  const actions = $('actions');

  const setStat = t => { stat.style.display = 'block'; stat.textContent = t; };
  const setProgress = p => { progress.style.width = Math.min(100, Math.max(0, p)) + '%'; };
  const clearActions = () => { actions.innerHTML = ''; };
  const addButton = (label, onClick, ghost = false) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (ghost) b.classList.add('ghost');
    b.addEventListener('click', onClick);
    actions.appendChild(b);
    return b;
  };

  // ─────────────────────────────────────────────────────────────
  // Extraction
  // ─────────────────────────────────────────────────────────────
  const sandbox = document.createElement('div');
  sandbox.style.cssText = 'position:absolute;left:-99999px;top:0;width:800px;';
  document.body.appendChild(sandbox);

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function cleanText(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('button,[role="button"],[aria-hidden="true"]')
      .forEach(n => n.remove());
    sandbox.innerHTML = '';
    sandbox.appendChild(clone);
    return (clone.innerText || clone.textContent || '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function getParts(itemEl) {
    const keyStr = itemEl.getAttribute('data-virtual-list-item-key');
    if (keyStr === null) return [];
    const key = parseInt(keyStr, 10);
    if (!Number.isFinite(key)) return [];

    const msgEl = itemEl.querySelector('.ds-message') || itemEl;
    const parts = [];

    // 1) Reasoning block (assistant only, optional)
    const thinkEl = msgEl.querySelector('.ds-think-content');
    if (thinkEl && CONFIG.includeReasoning) {
      const md = thinkEl.querySelector('.ds-markdown') || thinkEl;
      const text = cleanText(md);
      if (text) parts.push({ key, kind: 'reasoning', text });
    }

    // 2) Assistant response
    const respEl = msgEl.querySelector('.ds-assistant-message-main-content');
    if (respEl) {
      const text = cleanText(respEl);
      if (text) parts.push({ key, kind: 'assistant', text });
    }

    // 3) User message (only if no assistant markers found)
    if (!thinkEl && !respEl) {
      const userEl =
        msgEl.querySelector('.fbb737a4') ||
        msgEl.querySelector('.ds-collapsible-text') ||
        msgEl;
      const text = cleanText(userEl);
      if (text) parts.push({ key, kind: 'user', text });
    }

    return parts;
  }

  function snapshot() {
    const items = container.querySelectorAll('[data-virtual-list-item-key]');
    const out = [];
    for (const item of items) {
      const parts = getParts(item);
      for (const p of parts) out.push(p);
    }
    return out;
  }

  // ─────────────────────────────────────────────────────────────
  // State + dedup
  // ─────────────────────────────────────────────────────────────
  const seen = new Map(); // "key::kind" -> { key, kind, text }
  let cancelled = false;

  function addAll(list) {
    for (const p of list) {
      const k = p.key + '::' + p.kind;
      const existing = seen.get(k);
      if (!existing || p.text.length > existing.text.length) {
        seen.set(k, p);
      }
    }
  }

  function sortedMessages() {
    return [...seen.values()].sort((a, b) => {
      if (a.key !== b.key) return a.key - b.key;
      // Within the same turn: reasoning before response
      const rank = { reasoning: 0, assistant: 1, user: 2 };
      return (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9);
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Output
  // ─────────────────────────────────────────────────────────────
  function labelFor(m) {
    if (m.kind === 'user') return 'USER';
    if (m.kind === 'reasoning') return 'DEEPSEEK REASONING';
    if (m.kind === 'assistant') return 'DEEPSEEK';
    return 'UNKNOWN';
  }

  function formatOutput(messages) {
    const lines = [];
    const reasoningCount = messages.filter(m => m.kind === 'reasoning').length;

    if (CONFIG.format === 'md') {
      lines.push('# DeepSeek Conversation Export\n');
      lines.push(`- Exported: ${new Date().toISOString()}`);
      lines.push(`- URL: ${location.href}`);
      lines.push(`- Blocks: ${messages.length}` +
        (reasoningCount ? ` (incl. ${reasoningCount} reasoning)` : ''));
      lines.push('\n---\n');
      for (const m of messages) {
        const label = m.kind === 'reasoning' ? 'DeepSeek Reasoning'
                    : m.kind === 'assistant' ? 'DeepSeek'
                    : m.kind === 'user' ? 'User' : 'Unknown';
        lines.push(`## #${m.key} — ${label}\n`);
        lines.push(m.text);
        lines.push('\n---\n');
      }
    } else {
      lines.push('DeepSeek Conversation Export');
      lines.push(`Exported: ${new Date().toISOString()}`);
      lines.push(`URL: ${location.href}`);
      lines.push(`Blocks: ${messages.length}` +
        (reasoningCount ? ` (incl. ${reasoningCount} reasoning)` : ''));
      lines.push('');
      lines.push('='.repeat(60));
      lines.push('');
      for (const m of messages) {
        lines.push(`===== ${labelFor(m)} #${m.key} =====`);
        lines.push(m.text);
        lines.push('');
      }
    }
    return lines.join('\n');
  }

  function download(text, filename) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ─────────────────────────────────────────────────────────────
  // Main
  // ─────────────────────────────────────────────────────────────
  async function run() {
    body.innerHTML = '<div class="row muted">Settling DOM…</div>';
    clearActions();
    setProgress(0);
    setStat('0 blocks');

    await sleep(CONFIG.settleMs);

    body.innerHTML = '<div class="row muted">Sweeping thread…</div>';
    addButton('Cancel', () => { cancelled = true; }, true);

    const step = Math.max(200, Math.floor(container.clientHeight * CONFIG.sweepStepRatio));
    const totalSpan = Math.abs(bottomPos - topPos);

    container.scrollTop = topPos;
    await sleep(800);
    addAll(snapshot());

    let iter = 0, stuck = 0, pos = topPos;

    while (iter++ < CONFIG.maxIters && !cancelled && pos < bottomPos - 5) {
      const before = container.scrollTop;
      pos = Math.min(bottomPos, pos + step);
      container.scrollTop = pos;
      await sleep(CONFIG.sweepWaitMs);

      if (Math.abs(container.scrollTop - before) < 5) {
        stuck++;
        if (stuck > 20) break;
        await sleep(1500);
      } else {
        stuck = 0;
      }

      addAll(snapshot());

      const pct = Math.min(99, ((pos - topPos) / totalSpan) * 100);
      setProgress(pct);
      setStat(`${seen.size} blocks · ${Math.round(pct)}%`);
    }

    if (!cancelled) {
      container.scrollTop = bottomPos;
      await sleep(1200);
      addAll(snapshot());
    }

    sandbox.remove();

    const messages = sortedMessages();
    const out = formatOutput(messages);

    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const ext = CONFIG.format === 'md' ? 'md' : 'txt';
    const filename = `${CONFIG.filenamePrefix}-${stamp}.${ext}`;

    setProgress(100);
    setStat(`${messages.length} blocks · ${(out.length / 1024).toFixed(1)} KB`);

    if (cancelled) {
      body.innerHTML = '<div class="row warn">Cancelled before completion.</div>';
      clearActions();
      addButton('Download partial', () => download(out, filename));
      addButton('Close', () => host.remove(), true);
      return;
    }

    const firstKey = messages[0]?.key ?? '(none)';
    const keyWarning = firstKey !== 0 && firstKey !== 1
      ? `<div class="row warn">⚠ First block key is #${firstKey}, not 0. ` +
        `You may not have scrolled fully to the top before starting.</div>`
      : '';

    body.innerHTML = `
      <div class="row ok">Done — file downloaded.</div>
      ${keyWarning}
      <div class="row muted">If the export looks incomplete, reload the page, scroll fully
      to the top (wait for older messages), then run again.</div>
    `;
    clearActions();
    addButton('Download again', () => download(out, filename));
    addButton('Close', () => host.remove(), true);

    download(out, filename);
  }

  // ─────────────────────────────────────────────────────────────
  // Entry
  // ─────────────────────────────────────────────────────────────
  if (CONFIG.confirmBeforeStart) {
    body.innerHTML = `
      <div class="row">Before starting, make sure you have:</div>
      <ol>
        <li>Scrolled to the <strong>very top</strong> of this conversation</li>
        <li>Waited for older messages to finish loading</li>
      </ol>
      <div class="row muted">If you skip this, the export will be missing early messages.</div>
    `;
    addButton('Start export', run);
    addButton('Cancel', () => host.remove(), true);
  } else {
    run();
  }
})();
