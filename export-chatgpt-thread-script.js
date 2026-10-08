/**
 * ChatGPT Thread Exporter
 * ------------------------------------------------------------------
 * Extracts the full text of a ChatGPT conversation and downloads it
 * as a .txt (or .md) file, working around the virtualized / lazy-
 * loaded DOM that breaks Ctrl+A, Ctrl+C, and Ctrl+P on long threads.
 *
 * Handles:
 *   - Plain text messages
 *   - Inline writing blocks / documents (expanded OR collapsed)
 *   - Code blocks (with optional language fences)
 *   - Inline and block LaTeX (with optional $...$ / $$...$$ wrapping)
 *
 * HOW TO USE
 *   1. Open the ChatGPT conversation you want to export.
 *   2. Scroll to the very top. Wait for older messages to load.
 *   3. Open DevTools (F12 / Cmd+Opt+I), go to Console.
 *   4. If paste is blocked, type "allow pasting" and Enter.
 *   5. Paste this whole script and press Enter.
 *   6. Click "Start export" in the overlay.
 *   7. Wait. A .txt file downloads when finished.
 *
 * License: MIT. No affiliation with OpenAI.
 */
(() => {
  'use strict';

  const CONFIG = {
    format: 'txt',                 // 'txt' or 'md'
    preserveCodeLanguage: true,    // wrap code blocks in ```lang fences
    preserveLatex: true,           // wrap math in $...$ / $$...$$
    sweepStepRatio: 0.6,
    sweepWaitMs: 700,
    settleMs: 2500,
    maxIters: 800,
    filenamePrefix: 'chatgpt-thread',
    confirmBeforeStart: true,
  };

  // ─────────────────────────────────────────────────────────────
  // Container
  // ─────────────────────────────────────────────────────────────
  const container = document.querySelector('.thread-scroll-container');
  if (!container) {
    alert(
      'ChatGPT Thread Exporter: could not find the conversation container.\n\n' +
      'Make sure you are on a specific conversation page (URL like chatgpt.com/c/...).'
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
      <h3>ChatGPT Thread Exporter</h3>
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

  function findWrapper(h4) {
    let p = h4.parentElement;
    for (let i = 0; i < 12 && p && p !== container; i++) {
      if (p.classList && p.classList.contains('group')) return p;
      p = p.parentElement;
    }
    return h4.parentElement;
  }

  // Replace <pre><code class="language-x">…</code></pre> with a fenced text node.
  function applyCodeFences(root) {
    root.querySelectorAll('pre').forEach(pre => {
      if (!pre.parentNode) return;
      const code = pre.querySelector('code') || pre;
      const cls = (code.className || '').toString();
      const m = cls.match(/language-([a-z0-9+#._-]+)/i);
      const lang = m ? m[1] : '';
      let body = (code.textContent || '').replace(/\n+$/, '');
      if (/^\s*```/.test(body)) return; // already fenced
      const fenced = '```' + lang + '\n' + body + '\n```';
      const repl = document.createTextNode('\n' + fenced + '\n');
      pre.parentNode.replaceChild(repl, pre);
    });
  }

  // Replace KaTeX-rendered math with $…$ / $$…$$ using its TeX annotation.
  function applyLatex(root) {
    root.querySelectorAll('.katex, .katex-display').forEach(k => {
      if (!k.parentNode) return;
      const ann = k.querySelector('annotation[encoding="application/x-tex"]');
      if (!ann) return;
      const tex = (ann.textContent || '').trim();
      if (!tex) return;
      const isBlock = k.classList.contains('katex-display') ||
                      k.closest('.katex-display');
      const wrapped = isBlock ? `\n$$${tex}$$\n` : `$${tex}$`;
      k.parentNode.replaceChild(document.createTextNode(wrapped), k);
    });
  }

  function extractOne(h4) {
    const wrapper = findWrapper(h4);
    if (!wrapper) return null;

    let role = 'unknown';
    if (h4.dataset.conversationRole) role = h4.dataset.conversationRole;
    else if (/You said:/.test(h4.textContent)) role = 'user';
    else if (/ChatGPT said:/.test(h4.textContent)) role = 'assistant';

    // Fast path: ChatGPT stores clean plain text on many rich blocks.
    // Use it when present — it already excludes UI chrome.
    const mdAttr = wrapper.querySelector('[data-markdown-copy-text]');
    if (mdAttr) {
      const md = mdAttr.getAttribute('data-markdown-copy-text');
      if (md && md.trim()) return { role, text: md.trim() };
    }

    const clone = wrapper.cloneNode(true);

    clone.querySelectorAll('h4').forEach(el => el.remove());
    clone.querySelectorAll('button,[role="button"]').forEach(el => el.remove());

    // Strip small aria-hidden nodes (icons, deco labels).
    // Preserve large ones — collapsed writing blocks use aria-hidden="true"
    // on their content wrapper, and we must not eat them.
    clone.querySelectorAll('[aria-hidden="true"]').forEach(el => {
      const t = (el.innerText || el.textContent || '').trim();
      if (t.length < 50) el.remove();
    });

    // Strip writing-block chrome: header ("Writing" / doc title) and the
    // Show more / Show less button. Content itself lives under .ProseMirror.
    clone.querySelectorAll('[data-oai-writing-block-surface] header').forEach(el => el.remove());
    clone.querySelectorAll('[data-oai-writing-block-surface] > button').forEach(el => el.remove());

    if (CONFIG.preserveCodeLanguage) applyCodeFences(clone);
    if (CONFIG.preserveLatex) applyLatex(clone);

    sandbox.innerHTML = '';
    sandbox.appendChild(clone);
    let text = clone.innerText || clone.textContent || '';
    text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return text ? { role, text } : null;
  }

  function snapshot() {
    const h4s = [...container.querySelectorAll('h4')].filter(h =>
      /^(You said:|ChatGPT said:)\s*$/.test(h.textContent.trim())
    );
    const out = [];
    for (const h4 of h4s) {
      const m = extractOne(h4);
      if (m) out.push(m);
    }
    return out;
  }

  // ─────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────
  const seen = new Map();
  const order = [];
  let cancelled = false;

  function addAll(list) {
    for (const m of list) {
      const key = m.role + '::' + m.text.slice(0, 200);
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, m);
        order.push(key);
      } else if (m.text.length > existing.text.length) {
        // Keep the longer version if a message remounts with more content.
        existing.text = m.text;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Output
  // ─────────────────────────────────────────────────────────────
  function formatOutput(messages) {
    const lines = [];
    if (CONFIG.format === 'md') {
      lines.push('# ChatGPT Conversation Export\n');
      lines.push(`- Exported: ${new Date().toISOString()}`);
      lines.push(`- URL: ${location.href}`);
      lines.push(`- Messages: ${messages.length}\n`);
      lines.push('---\n');
      messages.forEach((m, i) => {
        const label = m.role === 'assistant' ? 'ChatGPT'
                    : m.role === 'user' ? 'User' : m.role;
        lines.push(`## #${i + 1} — ${label}\n`);
        lines.push(m.text);
        lines.push('\n---\n');
      });
    } else {
      lines.push('ChatGPT Conversation Export');
      lines.push(`Exported: ${new Date().toISOString()}`);
      lines.push(`URL: ${location.href}`);
      lines.push(`Messages: ${messages.length}`);
      lines.push('');
      lines.push('='.repeat(60));
      lines.push('');
      messages.forEach((m, i) => {
        const label = m.role === 'assistant' ? 'ChatGPT'
                    : m.role === 'user' ? 'User' : m.role;
        lines.push(`===== ${label.toUpperCase()} #${i + 1} =====`);
        lines.push(m.text);
        lines.push('');
      });
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
    setStat('0 messages');

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
      setStat(`${order.length} messages · ${Math.round(pct)}%`);
    }

    if (!cancelled) {
      container.scrollTop = bottomPos;
      await sleep(1500);
      addAll(snapshot());
    }

    sandbox.remove();

    const messages = order.map(k => seen.get(k));
    const out = formatOutput(messages);

    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const ext = CONFIG.format === 'md' ? 'md' : 'txt';
    const filename = `${CONFIG.filenamePrefix}-${stamp}.${ext}`;

    setProgress(100);
    setStat(`${messages.length} messages · ${(out.length / 1024).toFixed(1)} KB`);

    if (cancelled) {
      body.innerHTML = '<div class="row warn">Cancelled before completion.</div>';
      clearActions();
      addButton('Download partial', () => download(out, filename));
      addButton('Close', () => host.remove(), true);
      return;
    }

    const firstRole = messages[0]?.role;
    const warning = firstRole && firstRole !== 'user'
      ? '<div class="row warn">⚠ First message is not from the user. ' +
        'You may not have scrolled fully to the top before starting.</div>'
      : '';

    body.innerHTML = `
      <div class="row ok">Done — file downloaded.</div>
      ${warning}
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
