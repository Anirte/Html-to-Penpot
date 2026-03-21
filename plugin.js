penpot.ui.open('HTML to Penpot', `?theme=${penpot.theme}`, {
  width: 520,
  height: 700,
});

penpot.ui.onMessage(async (message) => {

  if (message.type === 'CREATE_FRAMES') {
    const { nodes } = message;

    const OFFSET_X = 100;
    const OFFSET_Y = 100;
    let totalCreated = 0;

    function createNode(node, parentBoard) {
      // Create a Board (= Frame in Penpot)
      const board = penpot.createBoard();

      // name — writable directly
      board.name = node.name || node.tag;

      // width/height — MUST use resize(), they are readonly properties
      board.resize(Math.max(1, node.rect.width), Math.max(1, node.rect.height));

      // x, y — writable directly
      if (!parentBoard) {
        // Root node: offset to canvas position
        board.x = OFFSET_X + node.rect.x;
        board.y = OFFSET_Y + node.rect.y;
      } else {
        // Child node: position relative to parent
        board.x = node.rect.x - node.parentRect.x;
        board.y = node.rect.y - node.parentRect.y;
      }

      // fills — writable directly as array
      const bgFill = parseCssColor(node.styles.backgroundColor);
      board.fills = bgFill ? [bgFill] : [];

      // borderRadius — writable directly
      const br = parseFloat(node.styles.borderRadius);
      if (!isNaN(br) && br > 0) {
        board.borderRadius = Math.round(br);
      }

      // strokes — writable directly as array
      const bw = parseFloat(node.styles.borderTopWidth);
      const bc = parseCssColor(node.styles.borderTopColor);
      if (bc && bw > 0 && node.styles.borderStyle !== 'none') {
        board.strokes = [{
          strokeColor:     bc.fillColor,
          strokeOpacity:   bc.fillOpacity,
          strokeStyle:     'solid',
          strokeWidth:     Math.round(bw),
          strokeAlignment: 'inner',
        }];
      }

      // clipContent — writable directly
      board.clipContent = true;

      // Attach to page or parent
      if (parentBoard) {
        parentBoard.appendChild(board);
      } else {
        // Page has no appendChild — use page.root which is the root shape
        penpot.currentPage.root.appendChild(board);
      }

      totalCreated++;

      // Text layer — only if element has direct text
      if (node.text && node.text.trim()) {
        // createText(text) takes text as argument, returns Text | null
        const txt = penpot.createText(node.text.trim());
        if (txt) {
          // growType, fontFamily, fontSize, fontWeight — all writable
          txt.growType   = 'auto-height';
          txt.fontFamily = cleanFont(node.styles.fontFamily) || 'Inter';
          txt.fontSize   = String(Math.round(parseFloat(node.styles.fontSize) || 14));
          txt.fontWeight = node.styles.fontWeight || '400';
          txt.x = 0;
          txt.y = 0;
          const tc = parseCssColor(node.styles.color);
          if (tc) txt.fills = [tc];
          board.appendChild(txt);
          totalCreated++;
        }
      }

      // Recurse into children
      (node.children || []).forEach(child => createNode(child, board));
    }

    // Create all root nodes on the current page
    nodes.forEach(node => createNode(node, null));

    penpot.ui.sendMessage({ type: 'DONE', count: totalCreated });
  }

});

// ── Parse "rgb(r,g,b)" / "rgba(r,g,b,a)" → Penpot Fill object
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

// "IBM Plex Sans", sans-serif → IBM Plex Sans
function cleanFont(str) {
  if (!str) return null;
  return str.split(',')[0].trim().replace(/['"]/g, '');
}
