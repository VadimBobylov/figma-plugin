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
  '1024': 'base',
  '1366': '$desktop-breakpoint-s',
  '1440': '$desktop-breakpoint-md',
  '1920': '$desktop-breakpoint-l',
  '2560': '$desktop-breakpoint-xl'
};

function toRem(value: number): string {
  return `to_rem(${value})`;
}

function toRemIfNonZero(value: any): string | undefined {
  return typeof value === 'number' && value !== 0 ? toRem(value) : undefined;
}

function formatPadding(
  node: SceneNode & Partial<{ paddingTop: number; paddingRight: number; paddingBottom: number; paddingLeft: number }>
): string | undefined {
  const top = toRemIfNonZero(node.paddingTop);
  const right = toRemIfNonZero(node.paddingRight);
  const bottom = toRemIfNonZero(node.paddingBottom);
  const left = toRemIfNonZero(node.paddingLeft);

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
                     width:            toRemIfNonZero(node.width),
                     height:           toRemIfNonZero(node.height),
                     'border-radius':  toRemIfNonZero(node.cornerRadius),
                     gap:              toRemIfNonZero(node.itemSpacing),
                     padding:          formatPadding(node),
                     'font-size':      toRemIfNonZero(node.fontSize),
                     'font-weight':    node.fontWeight,
                     'line-height':    node.lineHeight?.unit === 'PIXELS' && typeof node.lineHeight.value === 'number'
                                       ? toRem(node.lineHeight.value)
                                       : undefined,
                     'letter-spacing': node.letterSpacing?.value === undefined
                                       ? undefined : toRemIfNonZero(node.letterSpacing.value),
                   }).filter(([, value]) => value !== undefined)
  );
}

function processSelectedNodes(): void {
  const selectedNodes = figma.currentPage.selection;
  if (selectedNodes.length === 0) {
    figma.ui.postMessage('');
    return;
  }

  const nodesByBreakpoint: { [key: string]: SceneNode } = {};

  selectedNodes.forEach(node => {
    const parentFrame = findParentFrame(node);
    if (parentFrame) {
      const breakpoint = Object.keys(breakpoints)
                               .map(Number)
                               .sort((a, b) => b - a)
                               .find(b => parentFrame.width >= b);

      if (breakpoint !== undefined) {
        if (nodesByBreakpoint[breakpoint]) {
          figma.notify(`A node for breakpoint ${breakpoint} is already selected!`);
        } else {
          nodesByBreakpoint[breakpoint] = node;
        }
      }
    }
  });

  const mediaQueries: { [key: string]: { [key: string]: any } } = {};

  const mediaKeys = Object.keys(nodesByBreakpoint)
                          .sort((a, b) => parseInt(a) - parseInt(b));

  let prevStyles = {} as any;

  mediaKeys.forEach(bp => {
    const nodeStyles = getNodeStyles(nodesByBreakpoint[bp]);
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

  mediaKeys.forEach(bp => {
    if (mediaQueries[bp]) {
      if (breakpoints[bp] === 'base') {
        generatedCSS += `/* Base styles (${bp}px) */\n`;
        for (const [prop, value] of Object.entries(mediaQueries[bp])) {
          generatedCSS += `${prop}: ${value};\n`;
        }
        generatedCSS += '\n';
        return;
      }

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
