/**
 * plugin.js
 *
 * CRITICAL (Penpot API):
 * shape.x / shape.y are ABSOLUTE canvas coordinates always.
 * Even when appended to a board, coordinates stay absolute.
 *
 * Formula for each child:
 *   absX = canvasBaseX + (node.bounds.x - htmlBaseX)
 *   absY = canvasBaseY + (node.bounds.y - htmlBaseY)
 */

penpot.ui.open('HTML to Penpot', `?theme=${penpot.theme}`, {
  width: 510,
  height: 800,
});

penpot.ui.onMessage(async (message) => {

  if (message.type === 'CREATE_FRAMES') {
    const { nodes } = message;
    if (!nodes || !nodes.length) {
      penpot.ui.sendMessage({ type: 'ERROR', message: 'No elements received' });
      return;
    }

    const center = penpot.viewport.center;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.bounds.x);
      minY = Math.min(minY, node.bounds.y);
      maxX = Math.max(maxX, node.bounds.x + node.bounds.width);
      maxY = Math.max(maxY, node.bounds.y + node.bounds.height);
    }

    const totalW = Math.max(1, maxX - minX);
    const totalH = Math.max(1, maxY - minY);
    const PAD = 48;

    const rootBoard = penpot.createBoard();
    rootBoard.name = 'HTML Import';
    rootBoard.resize(totalW + PAD * 2, totalH + PAD * 2);
    rootBoard.x = center.x - (totalW + PAD * 2) / 2;
    rootBoard.y = center.y - (totalH + PAD * 2) / 2;
    rootBoard.fills = [];

    let totalCreated = 0;
    const shapesWithMargin = [];

    console.log('[START] Building', nodes.length, 'root nodes');

    for (const node of nodes) {
      console.log('[ROOT] >>>', node.name);
      await buildNode(node, rootBoard, rootBoard.x + PAD, rootBoard.y + PAD, minX, minY, shapesWithMargin, 0);
      totalCreated++;
      console.log('[ROOT] <<< done:', node.name);
    }

    console.log('[DONE] Total created:', totalCreated, 'margins:', shapesWithMargin.length);

    if (shapesWithMargin.length > 0) {
      try { penpot.selection = shapesWithMargin; } catch (e) {}
    }

    console.log('[SEND] Sending DONE message');

    penpot.ui.sendMessage({
      type: 'DONE',
      count: totalCreated,
      needsMarginFix: shapesWithMargin.length > 0,
      marginCount: shapesWithMargin.length
    });
  }

});

function shouldUseGrid(node) {
  return node.styles.display === 'grid' || node.styles.display === 'inline-grid';
}

async function buildNode(node, parentBoard, canvasBaseX, canvasBaseY, htmlBaseX, htmlBaseY, shapesWithMargin, depth) {
  if (!shapesWithMargin) shapesWithMargin = [];
  if (depth === undefined) depth = 0;
  try {
    const relX = node.bounds.x - htmlBaseX;
    const relY = node.bounds.y - htmlBaseY;
    const absX = canvasBaseX + relX;
    const absY = canvasBaseY + relY;
    const w    = Math.max(1, node.bounds.width);
    const h    = Math.max(1, node.bounds.height);

    // Text node
    if (node.kind === 'text' && node.text && node.text.trim()) {
      const txt = penpot.createText(node.text.trim());
      if (txt) {
        txt.name       = node.name;
        txt.x          = absX;
        txt.y          = absY;
        txt.growType   = 'auto-height';
        txt.resize(w, h);
        txt.fontFamily = resolveFont(node.styles.fontFamily);
        txt.fontSize   = String(Math.round(parseFloat(node.styles.fontSize) || 14));
        txt.fontWeight = safeWeight(node.styles.fontWeight);
        const lh = parseFloat(node.styles.lineHeight);
        if (!isNaN(lh) && lh > 0) txt.lineHeight = lh;
        const tc = parseCssColor(node.styles.color);
        if (tc) txt.fills = [tc];
        parentBoard.appendChild(txt);
        try { if (txt.layoutChild) txt.layoutChild.horizontalSizing = 'fill'; } catch (e) {}
      }
      return txt;
    }

    // Leaf node
    if (node.kind === 'leaf') {
      const rect = penpot.createRectangle();
      rect.name = node.name;
      rect.x    = absX;
      rect.y    = absY;
      rect.resize(w, Math.max(1, h));
      const bgFill = parseCssColor(node.styles.backgroundColor);
      rect.fills = bgFill ? [bgFill] : [];
      applyBorderRadius(rect, node.styles);
      applyStroke(rect, node.styles);
      parentBoard.appendChild(rect);
      if (node.tag === 'HR') {
        try { if (rect.layoutChild) rect.layoutChild.horizontalSizing = 'fill'; } catch(e) {}
      }
      return;
    }

    // Container
    const board = penpot.createBoard();
    board.name = node.name;
    board.x    = absX;
    board.y    = absY;
    board.resize(w, h);

    const bgFill = parseCssColor(node.styles.backgroundColor);
    board.fills = bgFill ? [bgFill] : [];
    applyBorderRadius(board, node.styles);
    applyStroke(board, node.styles);
    applyShadow(board, node.styles);
    board.clipContent      = node.styles.overflow === 'hidden';
    board.horizontalSizing = 'fix';
    board.verticalSizing   = 'fix';

    const childNodes = node.children || [];
    const useGrid    = shouldUseGrid(node);

    if (useGrid) {
      try {
        const grid = board.addGridLayout();
        grid.dir           = 'row';
        grid.topPadding    = parseFloat(node.styles.paddingTop)    || 0;
        grid.rightPadding  = parseFloat(node.styles.paddingRight)  || 0;
        grid.bottomPadding = parseFloat(node.styles.paddingBottom) || 0;
        grid.leftPadding   = parseFloat(node.styles.paddingLeft)   || 0;
        grid.columnGap     = parseFloat(node.styles.columnGap) || parseFloat(node.styles.gap) || 0;
        grid.rowGap        = parseFloat(node.styles.rowGap)    || parseFloat(node.styles.gap) || 0;

        grid.addRow('auto');
        childNodes.forEach(() => grid.addColumn('flex', 1));

        parentBoard.appendChild(board);

        if (node.text && node.text.trim()) addTextChild(node, board, absX, absY);

        const sortedChildren = [...childNodes].sort((a, b) => a.bounds.x - b.bounds.x);
        sortedChildren.forEach((child, idx) => {
          const shape = buildNodeReturnShape(child, board, absX, absY, node.bounds.x, node.bounds.y);
          if (shape) {
            try { grid.appendChild(shape, 0, idx); } catch (e) {}
          }
        });

      } catch (e) {
        console.warn('[grid] error:', e.message);
      }

    } else {
      // Flex config
      let flexConfig = null;
      try {
        const isCssFlex = node.styles.display === 'flex' || node.styles.display === 'inline-flex';
        const isButton  = node.tag === 'BUTTON' || node.tag === 'INPUT';

        const dir = isCssFlex
          ? ((node.styles.flexDirection || '').includes('column') ? 'column' : 'row')
          : (isButton ? 'row' : 'column');

        const isFlexRow = dir === 'row';
        const cssWrap = node.styles.flexWrap || '';

        const ai = node.styles.alignItems || '';
        const aiVal = ai === 'center'                     ? 'center'
                    : (ai === 'flex-end' || ai === 'end') ? 'end'
                    : ai === 'stretch'                    ? 'stretch'
                    : isButton                            ? 'center'
                    : 'start';

        const jc = node.styles.justifyContent || '';
        const jcVal = jc === 'center'        ? 'center'
                    : jc === 'flex-end'      ? 'end'
                    : jc === 'space-between' ? 'space-between'
                    : jc === 'space-around'  ? 'space-around'
                    : jc === 'space-evenly'  ? 'space-evenly'
                    : isButton               ? 'center'
                    : 'start';

        flexConfig = {
          dir,
          wrap: cssWrap === 'nowrap' ? 'nowrap' : cssWrap === 'wrap' ? 'wrap' : (isFlexRow ? 'nowrap' : 'wrap'),
          alignItems: aiVal,
          justifyContent: jcVal,
          topPadding:    parseFloat(node.styles.paddingTop)    || 0,
          rightPadding:  parseFloat(node.styles.paddingRight)  || 0,
          bottomPadding: parseFloat(node.styles.paddingBottom) || 0,
          leftPadding:   parseFloat(node.styles.paddingLeft)   || 0,
          rowGap:    parseFloat(node.styles.rowGap)    || parseFloat(node.styles.gap) || 0,
          columnGap: parseFloat(node.styles.columnGap) || parseFloat(node.styles.gap) || 0,
        };
      } catch (e) {}

      // Step 1: appendChild to parent
      parentBoard.appendChild(board);

      // Step 2: Apply flex
      if (flexConfig) {
        try {
          const flex = board.addFlexLayout();
          flex.dir            = flexConfig.dir;
          flex.wrap           = flexConfig.wrap;
          flex.alignItems     = flexConfig.alignItems;
          flex.justifyContent = flexConfig.justifyContent;
          flex.topPadding     = flexConfig.topPadding;
          flex.rightPadding   = flexConfig.rightPadding;
          flex.bottomPadding  = flexConfig.bottomPadding;
          flex.leftPadding    = flexConfig.leftPadding;
          flex.rowGap         = flexConfig.rowGap;
          flex.columnGap      = flexConfig.columnGap;
          console.log('[FLEX] d=' + depth, node.name, 'dir=' + flexConfig.dir);
        } catch (e) {
          console.warn('[FLEX-FAIL]', node.name, e.message);
        }
      }

      // Step 3: Build children
      const childShapes = [];
      for (const child of childNodes) {
        const shape = await buildNode(child, board, absX, absY, node.bounds.x, node.bounds.y, shapesWithMargin, depth + 1);
        childShapes.push({ node: child, shape });
      }

      // Step 4: Inline text after children
      if (node.text && node.text.trim()) addTextChild(node, board, absX, absY);

      // Step 5: Margins
      try {
        childShapes.forEach(({ node: cn, shape }) => {
          if (!shape || !shape.layoutChild) return;
          const mt = parseFloat(cn.styles.marginTop)    || 0;
          const mb = parseFloat(cn.styles.marginBottom) || 0;
          const ml = parseFloat(cn.styles.marginLeft)   || 0;
          const mr = parseFloat(cn.styles.marginRight)  || 0;
          shape.layoutChild.verticalMargin   = 0;
          shape.layoutChild.horizontalMargin = 0;
          shape.layoutChild.topMargin    = mt;
          shape.layoutChild.rightMargin  = mr;
          shape.layoutChild.bottomMargin = mb;
          shape.layoutChild.leftMargin   = ml;
          const fg = parseFloat(cn.styles.flexGrow) || 0;
          if (fg > 0) {
            const parentDir = node.styles.flexDirection || '';
            if (parentDir.includes('column')) {
              shape.layoutChild.verticalSizing = 'fill';
            } else {
              shape.layoutChild.horizontalSizing = 'fill';
            }
          }
          if (mt !== 0 || mb !== 0 || ml !== 0 || mr !== 0) {
            shapesWithMargin.push(shape);
          }
        });
      } catch (e) {
        console.warn('[margin] error:', e.message);
      }

      console.log('[BUILT] d=' + depth, node.name, 'children=' + childShapes.length);
    }

    return board;
  } catch (err) {
    console.warn('[html-to-penpot] Failed:', node.name, err);
    return null;
  }
}

// Build a node and return the shape — used by Grid Layout
function buildNodeReturnShape(node, parentBoard, canvasBaseX, canvasBaseY, htmlBaseX, htmlBaseY) {
  try {
    const relX = node.bounds.x - htmlBaseX;
    const relY = node.bounds.y - htmlBaseY;
    const absX = canvasBaseX + relX;
    const absY = canvasBaseY + relY;
    const w    = Math.max(1, node.bounds.width);
    const h    = Math.max(1, node.bounds.height);

    if (node.kind === 'text' && node.text && node.text.trim()) {
      const txt = penpot.createText(node.text.trim());
      if (!txt) return null;
      txt.name       = node.name;
      txt.x          = absX;
      txt.y          = absY;
      txt.growType   = 'auto-height';
      txt.resize(w, h);
      txt.fontFamily = resolveFont(node.styles.fontFamily);
      txt.fontSize   = String(Math.round(parseFloat(node.styles.fontSize) || 14));
      txt.fontWeight = safeWeight(node.styles.fontWeight);
      const tc = parseCssColor(node.styles.color);
      if (tc) txt.fills = [tc];
      parentBoard.appendChild(txt);
      return txt;
    }

    if (node.kind === 'leaf') {
      const rect = penpot.createRectangle();
      rect.name = node.name;
      rect.x    = absX;
      rect.y    = absY;
      rect.resize(w, h);
      const bgFill = parseCssColor(node.styles.backgroundColor);
      rect.fills = bgFill ? [bgFill] : [];
      applyBorderRadius(rect, node.styles);
      applyStroke(rect, node.styles);
      parentBoard.appendChild(rect);
      return rect;
    }

    // Container child inside grid
    const board = penpot.createBoard();
    board.name = node.name;
    board.x    = absX;
    board.y    = absY;
    board.resize(w, h);
    const bgFill = parseCssColor(node.styles.backgroundColor);
    board.fills = bgFill ? [bgFill] : [];
    applyBorderRadius(board, node.styles);
    applyStroke(board, node.styles);
    applyShadow(board, node.styles);
    board.clipContent      = node.styles.overflow === 'hidden';
    board.horizontalSizing = 'fix';
    board.verticalSizing   = 'fix';

    try {
      const flex = board.addFlexLayout();
      const isCssFlex = node.styles.display === 'flex' || node.styles.display === 'inline-flex';
      const isButton  = node.tag === 'BUTTON' || node.tag === 'INPUT';
      flex.dir = isCssFlex
        ? ((node.styles.flexDirection || '').includes('column') ? 'column' : 'row')
        : (isButton ? 'row' : 'column');
      flex.wrap = (node.styles.flexWrap === 'nowrap') ? 'nowrap' : 'wrap';
      const ai = node.styles.alignItems || '';
      flex.alignItems = ai === 'center' ? 'center'
        : (ai === 'flex-end' || ai === 'end') ? 'end'
        : ai === 'stretch' ? 'stretch'
        : isButton ? 'center' : 'start';
      const jc = node.styles.justifyContent || '';
      flex.justifyContent = jc === 'center' ? 'center'
        : jc === 'flex-end' ? 'end'
        : jc === 'space-between' ? 'space-between'
        : jc === 'space-around' ? 'space-around'
        : jc === 'space-evenly' ? 'space-evenly'
        : isButton ? 'center' : 'start';
      flex.topPadding    = parseFloat(node.styles.paddingTop)    || 0;
      flex.rightPadding  = parseFloat(node.styles.paddingRight)  || 0;
      flex.bottomPadding = parseFloat(node.styles.paddingBottom) || 0;
      flex.leftPadding   = parseFloat(node.styles.paddingLeft)   || 0;
      flex.rowGap    = parseFloat(node.styles.rowGap)    || parseFloat(node.styles.gap) || 0;
      flex.columnGap = parseFloat(node.styles.columnGap) || parseFloat(node.styles.gap) || 0;
    } catch (e) {}

    parentBoard.appendChild(board);

    if (node.text && node.text.trim()) addTextChild(node, board, absX, absY);

    (node.children || []).forEach(child => {
      buildNode(child, board, absX, absY, node.bounds.x, node.bounds.y);
    });

    return board;

  } catch (err) {
    console.warn('[buildNodeReturnShape] Failed:', node.name, err);
    return null;
  }
}

// Add inline text as a child of a container board.
function addTextChild(node, board, absX, absY) {
  const txt = penpot.createText(node.text.trim());
  if (!txt) return;
  txt.name       = node.name + ' text';
  txt.x          = absX;
  txt.y          = absY;
  txt.growType   = 'auto-height';
  txt.resize(Math.max(1, node.bounds.width), Math.max(1, node.bounds.height));
  txt.fontFamily = resolveFont(node.styles.fontFamily);
  txt.fontSize   = String(Math.round(parseFloat(node.styles.fontSize) || 14));
  txt.fontWeight = safeWeight(node.styles.fontWeight);
  const lh2 = parseFloat(node.styles.lineHeight);
  if (!isNaN(lh2) && lh2 > 0) txt.lineHeight = lh2;
  const tc = parseCssColor(node.styles.color);
  if (tc) txt.fills = [tc];
  board.appendChild(txt);
  try { if (txt.layoutChild) txt.layoutChild.horizontalSizing = 'fill'; } catch (e) {}
}

// ── Style helpers ──────────────────────────────────────────────

function applyBorderRadius(shape, styles) {
  const br = parseFloat(styles.borderRadius);
  if (!isNaN(br) && br > 0) shape.borderRadius = Math.round(br);
}

function applyShadow(shape, styles) {
  const bs = styles.boxShadow;
  if (!bs) return;
  const colorFirst = bs.match(/^(rgba?\([^)]+\)|#[0-9a-f]+)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?/i);
  const colorLast  = bs.match(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?\s+(rgba?\([^)]+\)|#[0-9a-f]+)/i);
  let offsetX, offsetY, blur, spread, colorStr;
  if (colorFirst) { [, colorStr, offsetX, offsetY, blur, spread] = colorFirst; }
  else if (colorLast) { [, offsetX, offsetY, blur, spread, colorStr] = colorLast; }
  else return;
  const color = parseCssColor(colorStr);
  if (!color) return;
  shape.shadows = [{
    style:   'drop-shadow',
    offsetX: parseFloat(offsetX),
    offsetY: parseFloat(offsetY),
    blur:    parseFloat(blur),
    spread:  parseFloat(spread || '0'),
    color:   { color: color.fillColor, opacity: color.fillOpacity },
    hidden:  false,
  }];
}

function applyStroke(shape, styles) {
  const bw = parseFloat(styles.borderTopWidth);
  const bc = parseCssColor(styles.borderTopColor);
  if (bc && bw > 0) {
    shape.strokes = [{
      strokeColor:     bc.fillColor,
      strokeOpacity:   bc.fillOpacity,
      strokeStyle:     'solid',
      strokeWidth:     Math.round(bw),
      strokeAlignment: 'center',
    }];
  }
}

function parseCssColor(str) {
  if (!str || str === 'transparent' || str === 'rgba(0, 0, 0, 0)') return null;
  const m = str.match(/rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)/);
  if (m) {
    const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
    if (a < 0.01) return null;
    return {
      fillColor:   rgbToHex(parseInt(m[1]), parseInt(m[2]), parseInt(m[3])),
      fillOpacity: Math.round(a * 100) / 100,
    };
  }
  if (str.startsWith('#')) return { fillColor: str, fillOpacity: 1 };
  return null;
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

const FONT_MAP = {
  'system-ui':          'Inter',
  '-apple-system':      'Inter',
  'blinkmacsystemfont': 'Inter',
  'segoe ui':           'Inter',
  'helvetica neue':     'Inter',
  'helvetica':          'Inter',
  'arial':              'Inter',
  'sans-serif':         'Inter',
  'georgia':            'Lora',
  'times new roman':    'Lora',
  'times':              'Lora',
  'serif':              'Lora',
  'courier new':        'Roboto Mono',
  'courier':            'Roboto Mono',
  'monospace':          'Roboto Mono',
  'consolas':           'Roboto Mono',
  'ibm plex sans':      'IBM Plex Sans',
  'ibm plex mono':      'IBM Plex Mono',
};

function resolveFont(cssFamily) {
  if (!cssFamily) return 'Inter';
  const parts = cssFamily.split(',').map(s => s.trim().replace(/['"]/g, '').toLowerCase());
  for (const part of parts) {
    const found = penpot.fonts.findByName(
      part.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    );
    if (found) return found.name;
    if (FONT_MAP[part]) return FONT_MAP[part];
  }
  return 'Inter';
}

function safeWeight(w) {
  const valid = ['100','200','300','400','500','600','700','800','900'];
  const n = String(Math.round((parseFloat(w) || 400) / 100) * 100);
  return valid.includes(n) ? n : '400';
}
