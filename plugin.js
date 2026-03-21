penpot.ui.open('HTML to Penpot', `?theme=${penpot.theme}`, {
  width: 520,
  height: 700,
});

penpot.ui.onMessage(async (message) => {

  if (message.type === 'CREATE_FRAMES') {
    const { nodes, viewport } = message;

    // Canvas offset so frames don't land on top of existing content
    const OFFSET_X = 100;
    const OFFSET_Y = 100;

    // Keep a map of our nodeId → penpot frame so we can appendChild correctly
    const frameMap = {};

    // Walk the tree depth-first and create frames
    function createNode(node, parentPenpotFrame) {
      // Create a frame for every element
      const frame = penpot.createFrame();
      frame.name = node.name || node.tag;

      // Position — if this is a root node, offset to canvas position
      // If it has a parent, position is relative to parent
      if (!parentPenpotFrame) {
        frame.x = OFFSET_X + node.rect.x;
        frame.y = OFFSET_Y + node.rect.y;
      } else {
        frame.x = node.rect.x - node.parentRect.x;
        frame.y = node.rect.y - node.parentRect.y;
      }

      frame.width  = Math.max(1, node.rect.width);
      frame.height = Math.max(1, node.rect.height);

      // Background color
      if (node.styles.backgroundColor) {
        const fill = parseCssColor(node.styles.backgroundColor);
        if (fill) frame.fills = [fill];
        else      frame.fills = [];
      } else {
        frame.fills = [];
      }

      // Border radius
      const br = parseFloat(node.styles.borderRadius);
      if (!isNaN(br) && br > 0) frame.borderRadius = Math.round(br);

      // Border / stroke
      if (node.styles.borderColor && node.styles.borderWidth) {
        const bw = parseFloat(node.styles.borderWidth);
        const bc = parseCssColor(node.styles.borderColor);
        if (bc && bw > 0) {
          frame.strokes = [{
            strokeColor:     bc.fillColor,
            strokeOpacity:   bc.fillOpacity,
            strokeStyle:     'solid',
            strokeWidth:     Math.round(bw),
            strokeAlignment: 'inner',
          }];
        }
      }

      // Clip content so children don't overflow
      frame.clipContent = true;

      // Append to parent if exists
      if (parentPenpotFrame) {
        parentPenpotFrame.appendChild(frame);
      }

      frameMap[node.id] = frame;

      // Text layer on top if element has direct text
      if (node.text && node.text.trim()) {
        const txt = penpot.createText();
        txt.characters  = node.text.trim();
        txt.growType    = 'auto-height';

        // Font
        txt.fontFamily  = cleanFont(node.styles.fontFamily) || 'Inter';
        txt.fontSize    = String(Math.round(parseFloat(node.styles.fontSize) || 14));
        txt.fontWeight  = node.styles.fontWeight || '400';

        // Text color
        const tc = parseCssColor(node.styles.color);
        if (tc) txt.fills = [tc];

        txt.x = 0;
        txt.y = 0;
        frame.appendChild(txt);
      }

      // Recurse into children
      (node.children || []).forEach(child => createNode(child, frame));
    }

    // Create all root nodes
    nodes.forEach(node => createNode(node, null));

    penpot.ui.sendMessage({ type: 'DONE', count: Object.keys(frameMap).length });
  }

});

// ── Helpers

// Parse "rgb(r, g, b)" or "rgba(r, g, b, a)" → penpot fill object
function parseCssColor(str) {
  if (!str || str === 'transparent' || str === 'rgba(0, 0, 0, 0)') return null;

  const rgba = str.match(/rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)/);
  if (rgba) {
    const r = parseInt(rgba[1]);
    const g = parseInt(rgba[2]);
    const b = parseInt(rgba[3]);
    const a = rgba[4] !== undefined ? parseFloat(rgba[4]) : 1;
    if (a < 0.01) return null;
    return {
      fillColor:   rgbToHex(r, g, b),
      fillOpacity: Math.round(a * 100) / 100,
    };
  }

  // Hex color passed directly
  if (str.startsWith('#')) {
    return { fillColor: str, fillOpacity: 1 };
  }

  return null;
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

// "IBM Plex Sans", sans-serif  →  IBM Plex Sans
function cleanFont(str) {
  if (!str) return null;
  return str.split(',')[0].trim().replace(/['"]/g, '');
}
