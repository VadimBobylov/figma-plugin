figma.showUI(
  `
  <style>
    body { font-family: sans-serif; padding: 20px; }
    textarea { width: 100%; height: 300px; font-family: monospace; resize: none; }
  </style>
  <h3>Generated media-query</h3>
  <textarea id="output" readonly></textarea>
  <script>
    window.onmessage = event => {
      if (event.data.pluginMessage !== undefined) {
        (document.getElementById('output')).value = event.data.pluginMessage;
      }
    };
  </script>
  `,
  { width: 500, height: 400 }
);

const breakpoints: Record<string, string> = {
  '1366px': '$desktop-breakpoint-s',
  '1440px': '$desktop-breakpoint-md',
  '1920px': '$desktop-breakpoint-l',
  '2560px': '$desktop-breakpoint-xl'
};

function toRem(value: number): string {
  return `to_rem(${value})`;
}

function toRemIfNumber(value: any): string | undefined {
  return typeof value === 'number' ? toRem(value) : undefined;
}

function formatPadding(
  node: SceneNode & Partial<{ paddingTop: number; paddingRight: number; paddingBottom: number; paddingLeft: number }>
): string | undefined {
  const top = toRemIfNumber(node.paddingTop);
  const right = toRemIfNumber(node.paddingRight);
  const bottom = toRemIfNumber(node.paddingBottom);
  const left = toRemIfNumber(node.paddingLeft);

  if (!top && !right && !bottom && !left) {
    return undefined;
  }
  if (top === right && top === bottom && top === left) {
    return `${top}`;
  }
  if (top === bottom && right === left) {
    return `${top} ${right}`;
  }
  if (right === left) {
    return `${top} ${right} ${bottom}`;
  }
  return `${top} ${right} ${bottom} ${left}`;
}

function findParentFrame(node: SceneNode): FrameNode | null {
  let current: BaseNode = node;
  let lastFrame: FrameNode | null = null;
  while (current.parent && current.parent.type !== 'PAGE' && current.parent.type !== 'SECTION') {
    if (current.parent.type === 'FRAME') {
      lastFrame = current.parent as FrameNode;
    }
    current = current.parent;
  }
  return lastFrame;
}

function getNodeStyles(node: any): { [key: string]: any } {
  if (!node) {
    return {};
  }

  return Object.fromEntries(
    Object.entries({
                     width:            toRemIfNumber(node.width),
                     height:           toRemIfNumber(node.height),
                     'border-radius':  toRemIfNumber(node.cornerRadius),
                     gap:              toRemIfNumber(node.itemSpacing),
                     padding:          formatPadding(node),
                     'font-size':      toRemIfNumber(node.fontSize),
                     'font-weight':    node.fontWeight,
                     'line-height':    node.lineHeight?.unit === 'PIXELS' && typeof node.lineHeight.value === 'number'
                                       ? toRem(node.lineHeight.value)
                                       : undefined,
                     'letter-spacing': node.letterSpacing?.value === undefined
                                       ? undefined : toRemIfNumber(node.letterSpacing.value),
                   }).filter(([, value]) => value !== undefined)
  );
}

function processSelectedNodes(): void {
  const selectedNodes = figma.currentPage.selection;
  if (selectedNodes.length === 0) {
    figma.ui.postMessage('');
    return;
  }

  const nodesByBreakpoint: { [key: string]: SceneNode[] } = {};

  selectedNodes.forEach(node => {
    const parentFrame = findParentFrame(node);
    let bpKey: string | null = null;
    if (parentFrame) {
      if (parentFrame.width >= 2560) {
        bpKey = '2560px';
      } else if (parentFrame.width >= 1920) {
        bpKey = '1920px';
      } else if (parentFrame.width >= 1440) {
        bpKey = '1440px';
      } else if (parentFrame.width >= 1366) {
        bpKey = '1366px';
      } else if (parentFrame.width >= 1024) {
        bpKey = 'base';
      }
    }
    if (bpKey) {
      if (!nodesByBreakpoint[bpKey]) {
        nodesByBreakpoint[bpKey] = [];
      }
      nodesByBreakpoint[bpKey].push(node);
    }
  });

  let baseStyles: { [key: string]: any } = {};
  if (nodesByBreakpoint['base'] && nodesByBreakpoint['base'].length > 0) {
    baseStyles = getNodeStyles(nodesByBreakpoint['base'][0]);
  }

  const mediaQueries: { [key: string]: { [key: string]: any } } = {};
  const mediaKeys = Object.keys(nodesByBreakpoint)
                          .filter(key => key !== 'base')
                          .sort((a, b) => parseInt(a) - parseInt(b));

  let prevStyles = baseStyles;

  mediaKeys.forEach(bp => {
    const nodeStyles = getNodeStyles(nodesByBreakpoint[bp][0]);
    const diff: { [key: string]: string | number | undefined } = {};

    for (const [prop, value] of Object.entries(nodeStyles)) {
      if (prevStyles[prop] !== value) {
        diff[prop] = value;
      }
    }

    if (Object.keys(diff).length > 0) {
      mediaQueries[bp] = diff;
    }

    prevStyles = nodeStyles;
  });

  let generatedCSS = '';
  if (Object.keys(baseStyles).length > 0) {
    generatedCSS += '/* Base styles (1024px) */\n';
    for (const [prop, value] of Object.entries(baseStyles)) {
      generatedCSS += `${prop}: ${value};\n`;
    }
    generatedCSS += '\n';
  }

  mediaKeys.forEach(bp => {
    if (mediaQueries[bp]) {
      generatedCSS += `@media (min-width: ${breakpoints[bp]}) {\n`;
      for (const [prop, value] of Object.entries(mediaQueries[bp])) {
        generatedCSS += `  ${prop}: ${value};\n`;
      }
      generatedCSS += '}\n\n';
    }
  });

  figma.ui.postMessage(generatedCSS);
}

processSelectedNodes();
figma.on('selectionchange', () => processSelectedNodes());
