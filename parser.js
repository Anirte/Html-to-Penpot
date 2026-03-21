// ══════════════════════════════════════════ TABS
function switchTab(name, btn) {
  ['html','css','opts'].forEach(t => {
    document.getElementById('tab-' + t).style.display = t === name ? '' : 'none';
  });
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b === btn));
}

function toggleCheck(el) {
  el.classList.toggle('on');
}

// ══════════════════════════════════════════ HELPERS
function toast(msg, color) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = color || '#22d4a0';
  t.style.color = color ? '#fff' : '#041a10';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

function log(msg) {
  const el = document.getElementById('log');
  el.classList.add('show');
  el.textContent += msg + '\n';
  el.scrollTop = el.scrollHeight;
}

function clearLog() {
  const el = document.getElementById('log');
  el.textContent = '';
  el.classList.remove('show');
}

function showStats(nodes, skipped) {
  const el = document.getElementById('stats');
  el.textContent = `✓ Parsed ${nodes} elements (skipped ${skipped} invisible/tiny)`;
  el.classList.add('show');
}

function clearAll() {
  document.getElementById('htmlIn').value = '';
  document.getElementById('cssIn').value  = '';
  document.getElementById('stats').classList.remove('show');
  clearLog();
}

// ══════════════════════════════════════════ FILE UPLOAD
function loadFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('htmlIn').value = e.target.result;
    toast('HTML loaded: ' + file.name);
  };
  reader.readAsText(file);
  event.target.value = '';
}

function loadCssFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('cssIn').value = e.target.result;
    // Switch to CSS tab so user sees it loaded
    document.querySelectorAll('.tab').forEach((b, i) => b.classList.toggle('on', i === 1));
    ['html','css','opts'].forEach((t, i) => {
      document.getElementById('tab-' + t).style.display = i === 1 ? '' : 'none';
    });
    toast('CSS loaded: ' + file.name);
  };
  reader.readAsText(file);
  event.target.value = '';
}

// ══════════════════════════════════════════ SAMPLE HTML
function loadSample() {
  document.getElementById('htmlIn').value = `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: system-ui, sans-serif; background: #f5f5f7; margin: 0; padding: 24px; }
  .card { background: #fff; border-radius: 12px; padding: 20px; max-width: 320px; box-shadow: 0 2px 12px rgba(0,0,0,.1); }
  .card-title { font-size: 18px; font-weight: 700; color: #111; margin-bottom: 8px; }
  .card-text  { font-size: 14px; color: #666; line-height: 1.5; margin-bottom: 16px; }
  .btn        { display: inline-block; background: #5b6af5; color: #fff; font-size: 14px; font-weight: 600; padding: 8px 18px; border-radius: 7px; border: none; cursor: pointer; }
  .badge      { display: inline-block; background: #e8ebff; color: #5b6af5; font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 20px; margin-bottom: 12px; }
</style>
</head>
<body>
  <div class="card">
    <span class="badge">New</span>
    <div class="card-title">Hello Penpot</div>
    <div class="card-text">This card was generated automatically from HTML code.</div>
    <button class="btn">Get started</button>
  </div>
</body>
</html>`;
  toast('Sample loaded!');
}

// ══════════════════════════════════════════ PARSE ENGINE

// Tags we completely ignore
const SKIP_TAGS = new Set([
  'SCRIPT','STYLE','META','LINK','HEAD','NOSCRIPT',
  'SVG','PATH','DEFS','SYMBOL','USE','G',
  'BR','HR','WBR',
]);

// CSS properties we collect from computedStyle
const STYLE_PROPS = [
  'backgroundColor','color',
  'fontSize','fontFamily','fontWeight','lineHeight',
  'borderRadius',
  'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
  'borderTopColor','borderStyle',
  'opacity','display','visibility',
  'paddingTop','paddingRight','paddingBottom','paddingLeft',
  'boxShadow',
];

function getOptions() {
  return {
    width:    parseInt(document.getElementById('optWidth').value)    || 1440,
    height:   parseInt(document.getElementById('optHeight').value)   || 900,
    minSize:  parseInt(document.getElementById('optMinSize').value)  || 4,
    maxDepth: parseInt(document.getElementById('optMaxDepth').value) || 8,
    incText:   document.getElementById('chkText').classList.contains('on'),
    incBg:     document.getElementById('chkBg').classList.contains('on'),
    incBorder: document.getElementById('chkBorder').classList.contains('on'),
    incHidden: document.getElementById('chkHidden').classList.contains('on'),
  };
}

// Build the full HTML string to inject into iframe
function buildHtml() {
  let html  = document.getElementById('htmlIn').value.trim();
  const css = document.getElementById('cssIn').value.trim();

  if (!html) return null;

  // Wrap snippet if no <html> tag
  if (!html.toLowerCase().includes('<html')) {
    html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${html}</body></html>`;
  }

  // Inject external CSS before </head>
  if (css) {
    const styleTag = `<style>\n${css}\n</style>`;
    html = html.includes('</head>')
      ? html.replace('</head>', styleTag + '</head>')
      : html.replace('<body', styleTag + '<body');
  }

  return html;
}

// ── Main parse — renders HTML in hidden iframe, walks DOM
function parseIframe(opts) {
  return new Promise((resolve, reject) => {
    const html = buildHtml();
    if (!html) return reject(new Error('No HTML to parse'));

    const iframe = document.getElementById('renderer');
    iframe.style.width  = opts.width  + 'px';
    iframe.style.height = opts.height + 'px';

    iframe.srcdoc = html;

    iframe.onload = () => {
      setTimeout(() => {
        try {
          const doc = iframe.contentDocument;
          const win = iframe.contentWindow;
          if (!doc || !win) return reject(new Error('Cannot access iframe document'));

          let nodeCount = 0;
          let skipCount = 0;

          function walkNode(el, depth) {
            if (depth > opts.maxDepth) return null;

            const tag = el.tagName;
            if (!tag || SKIP_TAGS.has(tag)) return null;

            const rect     = el.getBoundingClientRect();
            const computed = win.getComputedStyle(el);

            // Relative position = this rect minus direct parent rect
            const parentEl    = el.parentElement;
            const parentBCR   = parentEl ? parentEl.getBoundingClientRect() : { x: 0, y: 0 };
            const relX = rect.x - parentBCR.x;
            const relY = rect.y - parentBCR.y;

            // Skip invisible
            if (!opts.incHidden) {
              if (computed.display === 'none')          { skipCount++; return null; }
              if (computed.visibility === 'hidden')     { skipCount++; return null; }
              if (parseFloat(computed.opacity) < 0.02) { skipCount++; return null; }
            }

            // Skip too small or off-screen
            if (rect.width < opts.minSize || rect.height < opts.minSize) { skipCount++; return null; }
            if (rect.right < 0 || rect.bottom < 0)                       { skipCount++; return null; }

            // Collect styles
            const styles = {};
            STYLE_PROPS.forEach(p => {
              const v = computed[p];
              if (v && v !== '' && v !== 'none' && v !== 'normal' && v !== 'auto') {
                styles[p] = v;
              }
            });

            // Direct text content only (not from children)
            let text = '';
            if (opts.incText) {
              el.childNodes.forEach(n => {
                if (n.nodeType === Node.TEXT_NODE) {
                  const t = n.textContent.trim();
                  if (t) text += (text ? ' ' : '') + t;
                }
              });
            }

            // Layer name: prefer #id, then .className, then tag
            const name = el.id
              ? '#' + el.id
              : (el.className && typeof el.className === 'string')
                ? '.' + el.className.trim().split(/\s+/)[0]
                : tag.toLowerCase();

            nodeCount++;

            // Recurse into children
            const children = [];
            Array.from(el.children).forEach(child => {
              const childNode = walkNode(child, depth + 1);
              if (childNode) children.push(childNode);
            });

            return {
              id: nodeCount,
              tag,
              name,
              text,
              rect: {
                x:      Math.round(rect.x),
                y:      Math.round(rect.y),
                width:  Math.round(rect.width),
                height: Math.round(rect.height),
                // Relative to direct parent — used by plugin.js for positioning
                relX:   Math.round(relX),
                relY:   Math.round(relY),
              },
              styles,
              children,
            };
          }

          const body = doc.body;
          if (!body) return reject(new Error('No <body> found in HTML'));

          const roots = [];
          Array.from(body.children).forEach(child => {
            const node = walkNode(child, 0);
            if (node) roots.push(node);
          });

          resolve({ roots, nodeCount, skipCount, viewport: { width: opts.width, height: opts.height } });

        } catch (e) {
          reject(e);
        }
      }, 600);
    };

    iframe.onerror = () => reject(new Error('iframe failed to load'));
  });
}

// ══════════════════════════════════════════ PREVIEW
async function previewParse() {
  clearLog();
  document.getElementById('stats').classList.remove('show');
  const opts = getOptions();
  log('Parsing HTML…');
  try {
    const { roots, nodeCount, skipCount } = await parseIframe(opts);
    showStats(nodeCount, skipCount);
    log('Top-level elements: ' + roots.length);
    roots.forEach(r => {
      log(`  ${r.name}  ${r.rect.width}×${r.rect.height}  (${r.children.length} children)`);
    });
    log('Ready to generate!');
  } catch (e) {
    log('✗ Error: ' + e.message);
    toast('Parse error: ' + e.message, '#e86060');
  }
}

// ══════════════════════════════════════════ GENERATE
async function generate() {
  clearLog();
  document.getElementById('stats').classList.remove('show');

  const opts   = getOptions();
  const genBtn = document.getElementById('genBtn');

  if (!document.getElementById('htmlIn').value.trim()) {
    return toast('Paste some HTML first', '#e86060');
  }

  genBtn.disabled    = true;
  genBtn.textContent = 'Parsing…';
  log('Parsing HTML…');

  try {
    const { roots, nodeCount, skipCount, viewport } = await parseIframe(opts);
    showStats(nodeCount, skipCount);
    log(`Sending ${nodeCount} elements to Penpot…`);
    genBtn.textContent = 'Generating…';
    parent.postMessage({ type: 'CREATE_FRAMES', nodes: roots, viewport }, '*');
  } catch (e) {
    genBtn.disabled    = false;
    genBtn.textContent = 'Generate in Penpot';
    log('✗ Error: ' + e.message);
    toast('Error: ' + e.message, '#e86060');
  }
}

// ── Response from plugin.js
window.addEventListener('message', event => {
  const btn = document.getElementById('genBtn');
  if (event.data.type === 'DONE') {
    btn.disabled    = false;
    btn.textContent = 'Generate in Penpot';
    log(`✓ Created ${event.data.count} frames in Penpot!`);
    toast(`✓ ${event.data.count} frames created!`);
  }
  if (event.data.type === 'ERROR') {
    btn.disabled    = false;
    btn.textContent = 'Generate in Penpot';
    log('✗ Penpot error: ' + event.data.message);
    toast('Penpot error', '#e86060');
  }
});

// ── Init: read theme from URL
(function init() {
  const theme = new URLSearchParams(location.search).get('theme') || 'system';
  document.body.setAttribute('data-theme', theme);
})();
