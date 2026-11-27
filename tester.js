(() => {
  const out = document.getElementById('terminal-output');
  const termForm = document.getElementById('terminal-form');
  const termInput = document.getElementById('terminal-input');
  const statusBadge = document.getElementById('shield-status');
  const hookIndicator = document.getElementById('hook-indicator');

  const history = [];
  let histIdx = -1;

  const INTERNAL_KEYS = new Set(['__PRE_SHIELD_KEYS', 'ShieldTester']);

  function timestamp() {
    return new Date().toLocaleTimeString('en-US', { hour12: false });
  }

  function print(msg, cls = 'log-info') {
    const line = document.createElement('div');
    line.className = cls;
    line.textContent = `[${timestamp()}] ${msg}`;
    out.appendChild(line);
    out.scrollTop = out.scrollHeight;
  }

  // Mirror browser console + uncaught errors into the on-page terminal
  ['log', 'warn', 'error'].forEach((level) => {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      orig(...args);
      const cls = level === 'error' ? 'log-err' : level === 'warn' ? 'log-warn' : 'log-info';
      const text = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
      print(`[console.${level}] ${text}`, cls);
    };
  });

  window.addEventListener('error', (e) => {
    print(`[window.onerror] ${e.message} (${e.filename}:${e.lineno})`, 'log-err');
  });

  window.addEventListener('unhandledrejection', (e) => {
    print(`[unhandledrejection] ${e.reason}`, 'log-err');
  });

  function getShieldScripts() {
    return Array.from(document.querySelectorAll('script')).filter(
      (s) => s.src && s.src.toLowerCase().includes('gatecheck')
    );
  }

  function getAddedGlobals() {
    const pre = window.__PRE_SHIELD_KEYS || new Set();
    return Object.keys(window).filter((k) => !pre.has(k) && !INTERNAL_KEYS.has(k));
  }

  function isNative(fn) {
    try {
      return typeof fn === 'function' && Function.prototype.toString.call(fn).includes('[native code]');
    } catch {
      return false;
    }
  }

  function refreshBadges() {
    const scripts = getShieldScripts();
    if (scripts.length > 0) {
      statusBadge.textContent = `Shield Tag: Active (${scripts.length})`;
      statusBadge.classList.remove('removed');
    } else {
      statusBadge.textContent = 'Shield Tag: REMOVED';
      statusBadge.classList.add('removed');
    }

    const fetchNative = isNative(window.fetch);
    const xhrNative = isNative(XMLHttpRequest.prototype.send);
    hookIndicator.textContent = `fetch: ${fetchNative ? 'native' : 'HOOKED'} | XHR: ${xhrNative ? 'native' : 'HOOKED'}`;
  }

  // Watch DOM changes so we catch if Gatecheck injects elements or re-inserts its script
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (out.contains(m.target) || m.target === statusBadge || m.target === hookIndicator) continue;
      m.addedNodes.forEach((n) => {
        if (n.nodeType === 1) {
          print(`[DOM+] <${n.tagName.toLowerCase()}> ${n.src || n.id || n.name || ''}`, 'log-warn');
        }
      });
      m.removedNodes.forEach((n) => {
        if (n.nodeType === 1 && n.tagName === 'SCRIPT') {
          print(`[DOM-] <script> removed: ${n.src || '(inline)'}`, 'log-warn');
        }
      });
    }
    refreshBadges();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Intercept page forms to log fields (including any hidden tokens) + fire a test POST
  document.querySelectorAll('form[data-endpoint]').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const endpoint = form.dataset.endpoint;
      const data = Object.fromEntries(new FormData(form).entries());
      print(`Form "${form.id}" submitted -> ${endpoint}`, 'log-ok');
      print(`Payload (check for injected tokens): ${JSON.stringify(data)}`, 'log-info');

      // Also save fake signup/login locally so you can verify basic app flow works
      if (form.id === 'signup-form') {
        const users = JSON.parse(localStorage.getItem('demo_users') || '[]');
        users.push({ username: data.username, email: data.email });
        localStorage.setItem('demo_users', JSON.stringify(users));
        print(`Saved mock user locally (${users.length} total).`, 'log-ok');
      } else if (form.id === 'login-form') {
        localStorage.setItem('demo_session', data.email || 'unknown');
        print(`Set mock session for ${data.email}.`, 'log-ok');
      }

      // Trigger a real fetch POST so you can inspect Gatecheck's network interception
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        print(`POST ${endpoint} -> HTTP ${res.status}`, res.ok ? 'log-ok' : 'log-warn');
      } catch (err) {
        print(`POST ${endpoint} BLOCKED/FAILED: ${err.message}`, 'log-err');
      }
    });
  });

  // Terminal commands
  const commands = {
    help() {
      print(
        [
          'Commands:',
          '  status         - Check script tag, fetch/XHR hooks, added globals, cookies, hidden inputs',
          '  remove-script  - Remove Gatecheck <script> tag(s) from the DOM',
          '  strip-dom      - Remove injected iframes, hidden inputs, or Gatecheck DOM nodes',
          '  nuke-globals   - Delete global window properties added after page start',
          '  restore-fetch  - Replace window.fetch & XHR with clean copies from a blank iframe',
          '  clear-storage  - Wipe localStorage, sessionStorage, and JS-accessible cookies',
          '  test-fetch     - Send a single GET fetch request to current URL',
          '  burst [n]      - Send n rapid fetch requests (default 5)',
          '  bot-submit     - Programmatically fill and submit the page form with 0 human input',
          '  eval <js>      - Execute arbitrary JavaScript and print the result',
          '  clear          - Clear terminal output',
        ].join('\n'),
        'log-info'
      );
    },

    status() {
      refreshBadges();
      const scripts = getShieldScripts();
      const globals = getAddedGlobals();
      const hiddenInputs = Array.from(document.querySelectorAll('input[type="hidden"]')).map(
        (el) => `${el.name || el.id}=${el.value}`
      );
      print(`Script tags found: ${scripts.length}`, scripts.length ? 'log-ok' : 'log-err');
      print(`window.fetch native: ${isNative(window.fetch)}`, isNative(window.fetch) ? 'log-ok' : 'log-warn');
      print(`XHR.send native: ${isNative(XMLHttpRequest.prototype.send)}`, isNative(XMLHttpRequest.prototype.send) ? 'log-ok' : 'log-warn');
      print(`Added globals (${globals.length}): ${globals.join(', ') || '(none)'}`, 'log-info');
      print(`Hidden form inputs: ${hiddenInputs.join(', ') || '(none)'}`, 'log-info');
      print(`Cookies: ${document.cookie || '(none)'}`, 'log-info');
      print(`localStorage keys: ${Object.keys(localStorage).join(', ') || '(none)'}`, 'log-info');
    },

    'remove-script'() {
      const scripts = getShieldScripts();
      if (!scripts.length) {
        print('No Gatecheck <script> tag currently in DOM.', 'log-warn');
        return;
      }
      scripts.forEach((s) => s.remove());
      refreshBadges();
      print(`Removed ${scripts.length} Gatecheck <script> tag(s) from DOM.`, 'log-ok');
      print('Note: JS already executed in memory stays active unless hooks/globals are also stripped. Run "status" to inspect.', 'log-warn');
    },

    'strip-dom'() {
      let count = 0;
      document.querySelectorAll('iframe, input[type="hidden"], [id*="gatecheck" i], [class*="gatecheck" i]').forEach((el) => {
        el.remove();
        count++;
      });
      print(`Stripped ${count} hidden/iframe/gatecheck DOM element(s).`, count ? 'log-ok' : 'log-warn');
    },

    'nuke-globals'() {
      const globals = getAddedGlobals();
      if (!globals.length) {
        print('No extra window globals detected.', 'log-warn');
        return;
      }
      globals.forEach((key) => {
        try {
          const deleted = delete window[key];
          if (!deleted) window[key] = undefined;
          print(`Cleared window.${key} (deleted=${deleted})`, 'log-ok');
        } catch (err) {
          print(`Could not clear window.${key}: ${err.message}`, 'log-err');
        }
      });
    },

    'restore-fetch'() {
      try {
        const frame = document.createElement('iframe');
        frame.style.display = 'none';
        document.body.appendChild(frame);
        const cleanFetch = frame.contentWindow.fetch.bind(window);
        const cleanXHR = frame.contentWindow.XMLHttpRequest;
        window.fetch = cleanFetch;
        window.XMLHttpRequest = cleanXHR;
        frame.remove();
        refreshBadges();
        print('Replaced window.fetch and XMLHttpRequest with fresh iframe instances.', 'log-ok');
      } catch (err) {
        print(`Failed to unhook fetch/XHR: ${err.message}`, 'log-err');
      }
    },

    'clear-storage'() {
      localStorage.clear();
      sessionStorage.clear();
      document.cookie.split(';').forEach((c) => {
        const name = c.split('=')[0].trim();
        if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
      });
      print('Cleared localStorage, sessionStorage, and JS-accessible cookies.', 'log-ok');
    },

    async 'test-fetch'() {
      try {
        const t0 = performance.now();
        const res = await fetch(window.location.href, {
          method: 'GET',
          headers: { 'X-Shield-Test': 'manual' },
        });
        const ms = (performance.now() - t0).toFixed(1);
        print(`GET ${window.location.pathname} -> HTTP ${res.status} (${ms}ms)`, 'log-ok');
      } catch (err) {
        print(`GET failed/blocked: ${err.message}`, 'log-err');
      }
    },

    async burst(arg) {
      const n = Math.min(Math.max(parseInt(arg, 10) || 5, 1), 25);
      print(`Firing burst of ${n} rapid requests...`, 'log-warn');
      const results = await Promise.allSettled(
        Array.from({ length: n }, (_, i) =>
          fetch(`${window.location.pathname}?burst=${i}&t=${Date.now()}`).then((r) => r.status)
        )
      );
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') print(`  #${i + 1} -> HTTP ${r.value}`, 'log-ok');
        else print(`  #${i + 1} -> FAILED (${r.reason})`, 'log-err');
      });
    },

    'bot-submit'() {
      const form = document.querySelector('form[data-endpoint]');
      if (!form) {
        print('No testable form found on this page.', 'log-err');
        return;
      }
      form.querySelectorAll('input').forEach((inp) => {
        if (inp.type === 'email') inp.value = `bot_${Date.now()}@test.local`;
        else if (inp.type === 'password') inp.value = 'BotPass123!';
        else if (inp.type === 'text') inp.value = `bot_payload_${Date.now()}`;
      });
      print(`Filled "${form.id}" programmatically (0 mouse/key events) and submitting...`, 'log-warn');
      form.requestSubmit();
    },

    eval(code) {
      if (!code) {
        print('Usage: eval <javascript>', 'log-warn');
        return;
      }
      try {
        const res = (0, eval)(code);
        print(`=> ${typeof res === 'object' ? JSON.stringify(res) : String(res)}`, 'log-ok');
      } catch (err) {
        print(`eval error: ${err.message}`, 'log-err');
      }
    },

    clear() {
      out.innerHTML = '';
    },
  };

  function runCommand(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    history.unshift(trimmed);
    histIdx = -1;
    print(`$ ${trimmed}`, 'log-cmd');

    const spaceIdx = trimmed.indexOf(' ');
    const cmd = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
    const arg = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);

    if (commands[cmd]) {
      commands[cmd](arg);
    } else {
      print(`Unknown command "${cmd}". Type "help" for a list of commands.`, 'log-err');
    }
  }

  // Wire up quick-action buttons
  document.querySelectorAll('button[data-cmd]').forEach((btn) => {
    btn.addEventListener('click', () => runCommand(btn.dataset.cmd));
  });

  // Wire up terminal input + Up/Down history
  termForm.addEventListener('submit', (e) => {
    e.preventDefault();
    runCommand(termInput.value);
    termInput.value = '';
  });

  termInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault();
      histIdx = Math.min(histIdx + 1, history.length - 1);
      termInput.value = history[histIdx];
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      histIdx = Math.max(histIdx - 1, -1);
      termInput.value = histIdx === -1 ? '' : history[histIdx];
    }
  });

  window.addEventListener('load', () => {
    refreshBadges();
    print('Page loaded. Run "status" to inspect Gatecheck hooks or click any tamper button.', 'log-ok');
  });

  window.ShieldTester = { runCommand };
})();
