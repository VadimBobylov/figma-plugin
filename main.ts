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

function toRem(px: number | null | undefined): string | undefined {
  if (px == null || px === 0) {
    return undefined;
  }
  return `to_rem(${px})`;
}

function formatPadding(
  node: SceneNode & Partial<{ paddingTop: number; paddingRight: number; paddingBottom: number; paddingLeft: number }>
): string | undefined {
  const top = toRem(node.paddingTop);
  const right = toRem(node.paddingRight);
  const bottom = toRem(node.paddingBottom);
  const left = toRem(node.paddingLeft);
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

function getNodeStyles(node: SceneNode): { [key: string]: any } {
  return {
    width:           typeof (node as any).width === 'number' ? toRem((node as any).width) : undefined,
    height:          typeof (node as any).height === 'number' ? toRem((node as any).height) : undefined,
    'border-radius': typeof (node as any).cornerRadius === 'number' ? toRem((node as any).cornerRadius) : undefined,
    gap:             typeof (node as any).itemSpacing === 'number' ? toRem((node as any).itemSpacing) : undefined,
    padding:         formatPadding(node as any),
    'font-size':     typeof (node as any).fontSize === 'number' ? toRem((node as any).fontSize) : undefined,
    'font-weight':   (node as any).fontWeight ?? '',
    'line-height':
                     (node as any).lineHeight && typeof (node as any).lineHeight.value === 'number' && (node as any).lineHeight.unit === 'PIXELS'
                     ? toRem((node as any).lineHeight.value)
                     : 'normal',
    'letter-spacing':
                     (node as any).letterSpacing && typeof (node as any).letterSpacing.value === 'number' && (node as any).letterSpacing.value !== 0
                     ? toRem((node as any).letterSpacing.value)
                     : undefined,
  };
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
    const nodeStyles = getNodeStyles(nodesByBreakpoint['base'][0]);
    Object.keys(nodeStyles).forEach(key => {
      if (nodeStyles[key] === undefined) {
        delete nodeStyles[key];
      }
    });
    baseStyles = nodeStyles;
  }

  const mediaQueries: { [key: string]: { [key: string]: any } } = {};
  const mediaKeys = Object.keys(nodesByBreakpoint)
                          .filter(key => key !== 'base')
                          .sort((a, b) => parseInt(a) - parseInt(b));

  mediaKeys.forEach(bp => {
    const nodeStyles = getNodeStyles(nodesByBreakpoint[bp][0]);
    Object.keys(nodeStyles).forEach(key => {
      if (nodeStyles[key] === undefined) {
        delete nodeStyles[key];
      }
    });
    const diff: { [key: string]: string | number | undefined } = {};
    for (const [prop, value] of Object.entries(nodeStyles)) {
      if (baseStyles[prop] !== value) {
        diff[prop] = value;
      }
    }
    if (Object.keys(diff).length > 0) {
      mediaQueries[bp] = diff;
    }
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
