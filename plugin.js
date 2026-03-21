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
  width: 520,
  height: 700,
});

penpot.ui.onMessage(async (message) => {

  if (message.type === 'CREATE_FRAMES') {
    const { nodes } = message;
    if (!nodes || !nodes.length) {
      penpot.ui.sendMessage({ type: 'ERROR', message: 'No elements received' });
      return;
    }

    // Center on viewport
    const center = penpot.viewport.center;

    // Bounding box of all root nodes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.bounds.x);
      minY = Math.min(minY, node.bounds.y);
      maxX = Math.max(maxX, node.bounds.x + node.bounds.width);
      maxY = Math.max(maxY, node.bounds.y + node.bounds.height);
    }

    const totalW = Math.max(1, maxX - minX);
    const totalH = Math.max(1, maxY - minY);

    // Single root board wrapping everything
    const rootBoard = penpot.createBoard();
    rootBoard.name = 'HTML Import';
    rootBoard.resize(totalW, totalH);
    rootBoard.x = center.x - totalW / 2;
    rootBoard.y = center.y - totalH / 2;
    rootBoard.fills = [{ fillColor: '#ffffff', fillOpacity: 1 }];

    let totalCreated = 0;

    for (const node of nodes) {
      buildNode(node, rootBoard, rootBoard.x, rootBoard.y, minX, minY);
      totalCreated++;
    }

    penpot.ui.sendMessage({ type: 'DONE', count: totalCreated });
  }

});

/**
 * Recursively build a Penpot shape for a node.
 *
 * @param node         Parsed node from parser.js
 * @param parentBoard  Parent Penpot board
 * @param canvasBaseX  Absolute canvas X of the parent board
 * @param canvasBaseY  Absolute canvas Y of the parent board
 * @param htmlBaseX    HTML-space X origin at this level
 * @param htmlBaseY    HTML-space Y origin at this level
 */
function buildNode(node, parentBoard, canvasBaseX, canvasBaseY, htmlBaseX, htmlBaseY) {
  try {
    const relX = node.bounds.x - htmlBaseX;
    const relY = node.bounds.y - htmlBaseY;
    const absX = canvasBaseX + relX;
    const absY = canvasBaseY + relY;
    const w    = Math.max(1, node.bounds.width);
    const h    = Math.max(1, node.bounds.height);

    // ── Text node → createText (not a board)
    if (node.kind === 'text' && node.text && node.text.trim()) {
      const txt = penpot.createText(node.text.trim());
      if (txt) {
        txt.name       = node.name;
        txt.x          = absX;
        txt.y          = absY;
        txt.growType   = 'fixed';
        txt.resize(w, h);
        txt.fontFamily = 'Inter';
        txt.fontSize   = String(Math.round(parseFloat(node.styles.fontSize) || 14));
        txt.fontWeight = safeWeight(node.styles.fontWeight);
        const tc = parseCssColor(node.styles.color);
        if (tc) txt.fills = [tc];
        parentBoard.appendChild(txt);
      }
      return;
    }

    // ── Leaf node → createRectangle (simple colored box, no children)
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
      return;
    }

    // ── Container / image / default → createBoard
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

    board.clipContent = node.styles.overflow === 'hidden';

    // Apply flex layout if element has padding OR uses flexbox
    // This ensures text and children respect padding offsets
    const pt = parseFloat(node.styles.paddingTop)    || 0;
    const pr = parseFloat(node.styles.paddingRight)  || 0;
    const pb = parseFloat(node.styles.paddingBottom) || 0;
    const pl = parseFloat(node.styles.paddingLeft)   || 0;
    const isFlex = node.styles.display === 'flex' || node.styles.display === 'inline-flex';
    const hasPadding = pt > 0 || pr > 0 || pb > 0 || pl > 0;

    if (isFlex || hasPadding) {
      try {
        board.horizontalSizing = 'fix';
        board.verticalSizing   = 'fix';
        const flex = board.addFlexLayout();

        // Direction — column if flex-direction says so, otherwise row
        const dir = node.styles.flexDirection || 'row';
        flex.dir = dir.includes('column') ? 'column' : 'row';

        // wrap: only when CSS explicitly says wrap, otherwise keep nowrap
        const cssWrap = node.styles.flexWrap || '';
        flex.wrap = (cssWrap === 'wrap' || cssWrap === 'wrap-reverse') ? 'wrap' : 'nowrap';

        // alignContent — only relevant when wrap is on
        if (flex.wrap === 'wrap') {
          const ac = node.styles.alignContent || '';
          flex.alignContent = ac === 'center'        ? 'center'
                            : ac === 'flex-end'      ? 'end'
                            : ac === 'space-between' ? 'space-between'
                            : ac === 'space-around'  ? 'space-around'
                            : ac === 'space-evenly'  ? 'space-evenly'
                            : ac === 'stretch'       ? 'stretch'
                            : 'start';
        }

        // alignItems — for non-flex containers with padding, center the content
        const ai = node.styles.alignItems || '';
        const isFlex = node.styles.display === 'flex' || node.styles.display === 'inline-flex';
        flex.alignItems = ai === 'center'      ? 'center'
                        : ai === 'flex-end'    ? 'end'
                        : ai === 'stretch'     ? 'stretch'
                        : isFlex ? 'start'
                        : 'center'; // non-flex with padding → center content

        // justifyContent
        const jc = node.styles.justifyContent || '';
        flex.justifyContent = jc === 'center'        ? 'center'
                            : jc === 'flex-end'      ? 'end'
                            : jc === 'space-between' ? 'space-between'
                            : jc === 'space-around'  ? 'space-around'
                            : jc === 'space-evenly'  ? 'space-evenly'
                            : isFlex ? 'start'
                            : 'center'; // non-flex with padding → center content

        // Padding
        flex.topPadding    = pt;
        flex.rightPadding  = pr;
        flex.bottomPadding = pb;
        flex.leftPadding   = pl;

        // Gap
        flex.rowGap    = parseFloat(node.styles.rowGap)    || parseFloat(node.styles.gap) || 0;
        flex.columnGap = parseFloat(node.styles.columnGap) || parseFloat(node.styles.gap) || 0;

      } catch (e) { /* skip if layout fails */ }
    }

    // Append to parent BEFORE recursing into children
    parentBoard.appendChild(board);

    // Recurse — children use THIS board's canvas pos and THIS node's HTML pos
    (node.children || []).forEach(child => {
      buildNode(
        child,
        board,
        absX,          // this board's absolute canvas X
        absY,          // this board's absolute canvas Y
        node.bounds.x, // this node's HTML-space origin X
        node.bounds.y, // this node's HTML-space origin Y
      );
    });

    // If container also has direct text, add it with padding offset
    if (node.text && node.text.trim()) {
      const txt = penpot.createText(node.text.trim());
      if (txt) {
        txt.name       = node.name + ' text';
        txt.x          = absX;
        txt.y          = absY;
        txt.growType   = 'auto-width';
        txt.fontFamily = 'Inter';
        txt.fontSize   = String(Math.round(parseFloat(node.styles.fontSize) || 14));
        txt.fontWeight = safeWeight(node.styles.fontWeight);
        const tc = parseCssColor(node.styles.color);
        if (tc) txt.fills = [tc];
        board.appendChild(txt);
      }
    }

  } catch (err) {
    console.warn('[html-to-penpot] Failed:', node.name, err);
  }
}

// ── Style helpers ──────────────────────────────────────────────

function applyBorderRadius(shape, styles) {
  const br = parseFloat(styles.borderRadius);
  if (!isNaN(br) && br > 0) shape.borderRadius = Math.round(br);
}

function applyShadow(shape, styles) {
  const bs = styles.boxShadow;
  console.log('[shadow] boxShadow value:', bs);
  if (!bs || bs === 'none') return;
  // boxShadow format: "Xpx Ypx Blur Spread Color" or "Xpx Ypx Blur Color"
  // Color can be rgb/rgba and comes FIRST or LAST depending on browser
  // Chrome: "rgba(0, 0, 0, 0.1) 0px 2px 12px 0px"
  const colorFirst = bs.match(/^(rgba?\([^)]+\)|#[0-9a-f]+)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?/i);
  const colorLast  = bs.match(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?\s+(rgba?\([^)]+\)|#[0-9a-f]+)/i);

  let offsetX, offsetY, blur, spread, colorStr;

  if (colorFirst) {
    colorStr = colorFirst[1];
    offsetX  = parseFloat(colorFirst[2]);
    offsetY  = parseFloat(colorFirst[3]);
    blur     = parseFloat(colorFirst[4]);
    spread   = parseFloat(colorFirst[5] || '0');
  } else if (colorLast) {
    offsetX  = parseFloat(colorLast[1]);
    offsetY  = parseFloat(colorLast[2]);
    blur     = parseFloat(colorLast[3]);
    spread   = parseFloat(colorLast[4] || '0');
    colorStr = colorLast[5];
  } else {
    return;
  }

  const color = parseCssColor(colorStr);
  if (!color) return;

  shape.shadows = [{
    style:   'drop-shadow',
    offsetX,
    offsetY,
    blur,
    spread,
    color:   { color: color.fillColor, opacity: color.fillOpacity },
    hidden:  false,
  }];
}

function applyStroke(shape, styles) {
  const bw = parseFloat(styles.borderTopWidth);
  const bc = parseCssColor(styles.borderTopColor);
  if (bc && bw > 0 && styles.borderStyle !== 'none') {
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
  return '#' + [r, g, b]
    .map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
    .join('');
}

function safeWeight(w) {
  const valid = ['100','200','300','400','500','600','700','800','900'];
  const n = String(Math.round((parseFloat(w) || 400) / 100) * 100);
  return valid.includes(n) ? n : '400';
}
