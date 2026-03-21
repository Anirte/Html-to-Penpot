/**
 * plugin.js
 *
 * CRITICAL (from Penpot API):
 * shape.x / shape.y are ABSOLUTE canvas coordinates.
 * When appended to a board, they do NOT become relative to that board.
 * So every child must be placed at:
 *   shape.x = canvasBaseX + (node.bounds.x - htmlBaseX)
 *   shape.y = canvasBaseY + (node.bounds.y - htmlBaseY)
 * where canvasBaseX/Y is the absolute canvas position of the parent board.
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

    // Center on current viewport
    const center = penpot.viewport.center;

    // Calculate bounding box of all root nodes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.rect.x);
      minY = Math.min(minY, node.rect.y);
      maxX = Math.max(maxX, node.rect.x + node.rect.width);
      maxY = Math.max(maxY, node.rect.y + node.rect.height);
    }

    const totalW = Math.max(1, maxX - minX);
    const totalH = Math.max(1, maxY - minY);

    // One root board that wraps everything
    const rootBoard = penpot.createBoard();
    rootBoard.name = 'HTML Import';
    rootBoard.resize(totalW, totalH);
    rootBoard.x = center.x - totalW / 2;
    rootBoard.y = center.y - totalH / 2;
    rootBoard.fills = [{ fillColor: '#ffffff', fillOpacity: 1 }];

    let totalCreated = 0;

    // Build all root nodes inside the root board
    for (const node of nodes) {
      buildNode(
        node,
        rootBoard,
        rootBoard.x,  // absolute canvas X of parent board
        rootBoard.y,  // absolute canvas Y of parent board
        minX,         // HTML-space origin X
        minY,         // HTML-space origin Y
      );
      totalCreated++;
    }

    penpot.ui.sendMessage({ type: 'DONE', count: totalCreated });
  }

});

/**
 * Recursively create a board for a node and append to parent.
 *
 * @param node         The element node from parser
 * @param parentBoard  The Penpot board to append into
 * @param canvasBaseX  Absolute canvas X of the parent board
 * @param canvasBaseY  Absolute canvas Y of the parent board
 * @param htmlBaseX    HTML-space X origin (what 0 means at this level)
 * @param htmlBaseY    HTML-space Y origin
 */
function buildNode(node, parentBoard, canvasBaseX, canvasBaseY, htmlBaseX, htmlBaseY) {
  try {
    // Offset from parent origin in HTML space
    const relX = node.rect.x - htmlBaseX;
    const relY = node.rect.y - htmlBaseY;

    // Absolute canvas position for this shape
    const absX = canvasBaseX + relX;
    const absY = canvasBaseY + relY;

    const w = Math.max(1, node.rect.width);
    const h = Math.max(1, node.rect.height);

    const board = penpot.createBoard();
    board.name = node.name || node.tag || 'element';
    board.x = absX;
    board.y = absY;
    board.resize(w, h);

    // Background
    const bgFill = parseCssColor(node.styles.backgroundColor);
    board.fills = bgFill ? [bgFill] : [];

    // Border radius
    const br = parseFloat(node.styles.borderRadius);
    if (!isNaN(br) && br > 0) board.borderRadius = Math.round(br);

    // Border/stroke
    const bw = parseFloat(node.styles.borderTopWidth);
    const bc = parseCssColor(node.styles.borderTopColor);
    if (bc && bw > 0 && node.styles.borderStyle !== 'none') {
      board.strokes = [{
        strokeColor:     bc.fillColor,
        strokeOpacity:   bc.fillOpacity,
        strokeStyle:     'solid',
        strokeWidth:     Math.round(bw),
        strokeAlignment: 'center',
      }];
    }

    // Clip overflow
    board.clipContent = (node.styles.overflow === 'hidden');

    // Append to parent first
    parentBoard.appendChild(board);

    // Text layer
    if (node.text && node.text.trim()) {
      const txt = penpot.createText(node.text.trim());
      if (txt) {
        txt.name      = 'text';
        txt.x         = absX;
        txt.y         = absY;
        txt.growType  = 'auto-height';
        txt.fontFamily = 'Inter';
        txt.fontSize   = String(Math.round(parseFloat(node.styles.fontSize) || 14));
        txt.fontWeight = safeWeight(node.styles.fontWeight);
        const tc = parseCssColor(node.styles.color);
        if (tc) txt.fills = [tc];
        parentBoard.appendChild(txt);
      }
    }

    // Recurse — children use THIS board's canvas pos and THIS node's HTML pos as new origin
    (node.children || []).forEach(child => {
      buildNode(
        child,
        board,
        absX,          // this board's absolute canvas X
        absY,          // this board's absolute canvas Y
        node.rect.x,   // this node's HTML-space X as new origin
        node.rect.y,   // this node's HTML-space Y as new origin
      );
    });

  } catch (err) {
    console.warn('[html-to-penpot] Failed node:', node.name, err);
  }
}

// ── Helpers ────────────────────────────────────────────────────

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
