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
    const PAD = 48;

    // Single root board — transparent with padding around content
    const rootBoard = penpot.createBoard();
    rootBoard.name = 'HTML Import';
    rootBoard.resize(totalW + PAD * 2, totalH + PAD * 2);
    rootBoard.x = center.x - (totalW + PAD * 2) / 2;
    rootBoard.y = center.y - (totalH + PAD * 2) / 2;
    rootBoard.fills = [];

    let totalCreated = 0;
    for (const node of nodes) {
      buildNode(node, rootBoard, rootBoard.x + PAD, rootBoard.y + PAD, minX, minY);
      totalCreated++;
    }

    penpot.ui.sendMessage({ type: 'DONE', count: totalCreated, needsMarginFix: true });
  }

});

/**
 * Recursively build a Penpot shape for a node.
 */
function buildNode(node, parentBoard, canvasBaseX, canvasBaseY, htmlBaseX, htmlBaseY) {
  try {
    const relX = node.bounds.x - htmlBaseX;
    const relY = node.bounds.y - htmlBaseY;
    const absX = canvasBaseX + relX;
    const absY = canvasBaseY + relY;
    const w    = Math.max(1, node.bounds.width);
    const h    = Math.max(1, node.bounds.height);

    // ── Text node → createText
    if (node.kind === 'text' && node.text && node.text.trim()) {
      const txt = penpot.createText(node.text.trim());
      if (txt) {
        txt.name       = node.name;
        txt.x          = absX;
        txt.y          = absY;
        txt.growType   = 'auto-height';
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

    // ── Leaf node → createRectangle
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

    // ── Container → createBoard with FlexLayout
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

    // All containers get FlexLayout — only way to apply padding in Penpot
    try {
      board.horizontalSizing = 'fix';
      board.verticalSizing   = 'fix';
      const flex = board.addFlexLayout();

      // Direction: CSS flex uses flexDirection, block elements flow as column
      const isCssFlex = node.styles.display === 'flex' || node.styles.display === 'inline-flex';
      if (isCssFlex) {
        const cssDir = node.styles.flexDirection || '';
        flex.dir = cssDir.includes('column') ? 'column' : 'row';
      } else {
        flex.dir = 'column'; // block elements stack vertically
      }

      // wrap: children stay inside boundaries
      flex.wrap = 'wrap';

      // alignItems — map CSS → Penpot
      const ai = node.styles.alignItems || '';
      flex.alignItems = ai === 'center'               ? 'center'
                      : (ai === 'flex-end' || ai === 'end') ? 'end'
                      : ai === 'stretch'              ? 'stretch'
                      : 'start';

      // justifyContent — map CSS → Penpot
      const jc = node.styles.justifyContent || '';
      flex.justifyContent = jc === 'center'           ? 'center'
                          : jc === 'flex-end'         ? 'end'
                          : jc === 'space-between'    ? 'space-between'
                          : jc === 'space-around'     ? 'space-around'
                          : jc === 'space-evenly'     ? 'space-evenly'
                          : 'start';

      // Padding
      flex.topPadding    = parseFloat(node.styles.paddingTop)    || 0;
      flex.rightPadding  = parseFloat(node.styles.paddingRight)  || 0;
      flex.bottomPadding = parseFloat(node.styles.paddingBottom) || 0;
      flex.leftPadding   = parseFloat(node.styles.paddingLeft)   || 0;

      // Gap
      flex.rowGap    = parseFloat(node.styles.rowGap)    || parseFloat(node.styles.gap) || 0;
      flex.columnGap = parseFloat(node.styles.columnGap) || parseFloat(node.styles.gap) || 0;

    } catch (e) { /* skip if layout fails */ }

    // Append to parent BEFORE adding children
    parentBoard.appendChild(board);

    // Direct text inside container — add as child of board (layout handles positioning)
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

    // Recurse into children
    (node.children || []).forEach(child => {
      buildNode(child, board, absX, absY, node.bounds.x, node.bounds.y);
    });

    // After children are appended, apply their layoutChild margins
    // We need to iterate board.children which are already appended shapes
    try {
      const childNodes = node.children || [];
      childNodes.forEach(cn => {
        // Find matching shape by name
        const shape = (board.children || []).find(s => s.name === cn.name);
        if (!shape || !shape.layoutChild) return;
        const mt = parseFloat(cn.styles.marginTop)    || 0;
        const mb = parseFloat(cn.styles.marginBottom) || 0;
        const ml = parseFloat(cn.styles.marginLeft)   || 0;
        const mr = parseFloat(cn.styles.marginRight)  || 0;
        // First set uniform values to initialize, then override with individual
        shape.layoutChild.verticalMargin   = 0;
        shape.layoutChild.horizontalMargin = 0;
        // Individual values — this switches Penpot to "expanded" mode
        shape.layoutChild.topMargin    = mt;
        shape.layoutChild.rightMargin  = mr;
        shape.layoutChild.bottomMargin = mb;
        shape.layoutChild.leftMargin   = ml;
      });
    } catch (e) {
      console.warn('[margin] error:', e.message);
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
  if (!bs) return;
  // Chrome format: "rgba(0, 0, 0, 0.1) 0px 2px 12px 0px" — color comes first
  const colorFirst = bs.match(/^(rgba?\([^)]+\)|#[0-9a-f]+)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?/i);
  const colorLast  = bs.match(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?\s+(rgba?\([^)]+\)|#[0-9a-f]+)/i);

  let offsetX, offsetY, blur, spread, colorStr;
  if (colorFirst) {
    [, colorStr, offsetX, offsetY, blur, spread] = colorFirst;
  } else if (colorLast) {
    [, offsetX, offsetY, blur, spread, colorStr] = colorLast;
  } else return;

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
    return { fillColor: rgbToHex(parseInt(m[1]), parseInt(m[2]), parseInt(m[3])), fillOpacity: Math.round(a * 100) / 100 };
  }
  if (str.startsWith('#')) return { fillColor: str, fillOpacity: 1 };
  return null;
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

function safeWeight(w) {
  const valid = ['100','200','300','400','500','600','700','800','900'];
  const n = String(Math.round((parseFloat(w) || 400) / 100) * 100);
  return valid.includes(n) ? n : '400';
}
