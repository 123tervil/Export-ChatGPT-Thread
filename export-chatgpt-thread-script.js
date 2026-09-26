(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const c = document.querySelector('.thread-scroll-container');
  if (!c) return console.error('no container');

  const isReverse = getComputedStyle(c).flexDirection.includes('reverse');
  const max = c.scrollHeight - c.clientHeight;
  const top = isReverse ? -max : 0;
  const bottom = isReverse ? 0 : max;

  console.log('container:', { scrollHeight: c.scrollHeight, clientHeight: c.clientHeight, isReverse });

  const sandbox = document.createElement('div');
  sandbox.style.cssText = 'position:absolute;left:-99999px;top:0;width:800px;';
  document.body.appendChild(sandbox);

  function findWrapper(h4) {
    let p = h4.parentElement;
    for (let i = 0; i < 12 && p && p !== c; i++) {
      if (p.classList && p.classList.contains('group')) return p;
      p = p.parentElement;
    }
    return h4.parentElement;
  }

  function topTurnKey() {
    const el = c.querySelector('[data-content-search-unit-key]');
    return el ? el.getAttribute('data-content-search-unit-key') : null;
  }
  function allTurnKeys() {
    return [...c.querySelectorAll('[data-content-search-unit-key]')]
      .map(el => el.getAttribute('data-content-search-unit-key'));
  }

  function extractOne(h4) {
    const wrapper = findWrapper(h4);
    if (!wrapper) return null;
    let role = 'unknown';
    if (h4.dataset.conversationRole) role = h4.dataset.conversationRole;
    else if (/You said:/.test(h4.textContent)) role = 'user';
    else if (/ChatGPT said:/.test(h4.textContent)) role = 'assistant';

    const clone = wrapper.cloneNode(true);
    clone.querySelectorAll('h4').forEach(el => el.remove());
    clone.querySelectorAll('button,[role="button"]').forEach(el => el.remove());
    clone.querySelectorAll('[aria-hidden="true"]').forEach(el => el.remove());

    sandbox.innerHTML = '';
    sandbox.appendChild(clone);
    let text = clone.innerText || clone.textContent || '';
    text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return text ? { role, text } : null;
  }

  function snapshot() {
    const h4s = [...c.querySelectorAll('h4')].filter(h =>
      /^(You said:|ChatGPT said:)\s*$/.test(h.textContent.trim())
    );
    const out = [];
    for (const h4 of h4s) {
      const m = extractOne(h4);
      if (m) out.push(m);
    }
    return out;
  }

  // Loader for older messages: send wheel events targeted at the container
  async function tryLoadOlder(seconds) {
    const end = Date.now() + seconds * 1000;
    const rect = c.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Ensure we're at the top edge where the loader triggers
    c.scrollTop = top;

    while (Date.now() < end) {
      // Fire wheel up events with negative deltaY
      const ev = new WheelEvent('wheel', {
        deltaY: -120,
        deltaMode: 0,
        bubbles: true,
        cancelable: true,
        clientX: cx,
        clientY: cy
      });
      c.dispatchEvent(ev);
      // Some implementations listen on window/document
      window.dispatchEvent(ev);
      document.dispatchEvent(ev);

      // Also nudge scrollTop up past top to try to force the loader
      c.scrollTop = top - 5;
      await sleep(120);
      c.scrollTop = top;
      await sleep(120);
    }
  }

  const seen = new Map();
  const order = [];
  function addAll(list) {
    for (const m of list) {
      const key = m.role + '::' + m.text.slice(0, 200);
      if (!seen.has(key)) {
        seen.set(key, m);
        order.push(key);
      }
    }
  }

  // -------- Phase 1: aggressively load older content by wheel+scrollTop --------
  console.log('Phase 1: forcing top load...');
  addAll(snapshot());

  let lastTopKey = null;
  let stableRounds = 0;

  for (let round = 1; round <= 40; round++) {
    const beforeKey = topTurnKey();
    const beforeHeight = c.scrollHeight;
    console.log(`round ${round}: top=${beforeKey} height=${beforeHeight} msgs=${order.length}`);

    await tryLoadOlder(12);

    addAll(snapshot());

    const afterKey = topTurnKey();
    const afterHeight = c.scrollHeight;
    console.log(`  -> after: top=${afterKey} height=${afterHeight} msgs=${order.length}`);

    if (afterKey === beforeKey && afterHeight === beforeHeight) {
      stableRounds++;
      if (stableRounds >= 3) {
        console.log('top appears fully loaded (3 stable rounds)');
        break;
      }
      await sleep(4000);
    } else {
      stableRounds = 0;
    }
  }

  // -------- Phase 2: sweep back down through everything --------
  console.log('Phase 2: sweep downward...');
  const step = Math.floor(c.clientHeight * 0.6);
  const wait = 700;
  let iter = 0, stuck = 0;

  // Start from wherever we ended up in phase 1 (should be near top)
  while (iter++ < 500) {
    const before = c.scrollTop;
    c.scrollTop = before + (isReverse ? step : -step);
    await sleep(wait);

    if (Math.abs(c.scrollTop - before) < 5) {
      stuck++;
      if (stuck > 15) { console.log('stuck at', c.scrollTop, 'iter', iter); break; }
      await sleep(2000);
    } else { stuck = 0; }

    addAll(snapshot());

    if (iter % 20 === 0) console.log(`iter=${iter} pos=${Math.round(c.scrollTop)} msgs=${order.length}`);

    if (isReverse && c.scrollTop >= bottom - 5) break;
    if (!isReverse && c.scrollTop <= bottom + 5) break;
  }

  // Final pass at bottom
  c.scrollTop = bottom;
  await sleep(2000);
  addAll(snapshot());

  sandbox.remove();

  console.log('total unique messages:', order.length);

  // We walked top->bottom, so order is oldest->newest already
  const messages = order.map(k => seen.get(k));

  const out = messages.map((m, i) =>
    `===== ${m.role.toUpperCase()} #${i + 1} =====\n${m.text}\n`
  ).join('\n\n');

  console.log('final chars:', out.length);
  console.log('first msg role/len:', messages[0]?.role, messages[0]?.text.length);
  console.log('first msg preview:', messages[0]?.text.slice(0, 120));
  console.log('last msg role/len:', messages[messages.length-1]?.role, messages[messages.length-1]?.text.length);

  const blob = new Blob([out], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chatgpt-full-${Date.now()}.txt`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  console.log('downloaded');
})();
