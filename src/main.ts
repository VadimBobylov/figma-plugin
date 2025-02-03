figma.showUI(__html__);

const breakpoints: Record<string, number> = {
  base: 1024,
  '$desktop-breakpoint-s': 1366,
  '$desktop-breakpoint-md': 1440,
  '$desktop-breakpoint-l': 1920,
  '$desktop-breakpoint-xl': 2560
};

let selectedFields: string[] = [];
let nodesByBreakpointGlobal: Record<string, SceneNode> = {};
let selectionHistory: SceneNode[][] = [];
let historyIndex = -1;
let useToRem: boolean = true;

function toRem(value: number): string {
  return useToRem ? `to_rem(${value})` : `${value}px`;
}

function toRemIfNonZero(value: any): string | undefined {
  return typeof value === 'number' && value !== 0 ? toRem(value) : undefined;
}

function formatPadding(node: SceneNode & Partial<{
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number
}>): string | undefined {
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
  const styles = {
    width:            toRemIfNonZero(node.width),
    height:           toRemIfNonZero(node.height),
    'border-radius': toRemIfNonZero(node.cornerRadius),
    gap:              toRemIfNonZero(node.itemSpacing),
    padding:          formatPadding(node),
    'font-size':      toRemIfNonZero(node.fontSize),
    'font-weight':    node.fontWeight,
    'line-height': node.lineHeight?.unit === 'PIXELS' && typeof node.lineHeight.value === 'number' ? toRem(node.lineHeight.value) : node.lineHeight?.value?.toFixed(1).concat('%'),
    'letter-spacing': node.letterSpacing?.value === undefined ? undefined : toRemIfNonZero(node.letterSpacing.value)
  };
  return Object.fromEntries(Object.entries(styles).filter(([, value]) => value !== undefined));
}

function recordSelection() {
  const currentSelection = [...figma.currentPage.selection];
  if (currentSelection.length === 0) {
    return;
  }
  if (historyIndex >= 0) {
    const lastSelection = selectionHistory[historyIndex];
    if (lastSelection.length === currentSelection.length && lastSelection.every((node, i) => node.id === currentSelection[i].id)) {
      return;
    }
  }
  if (historyIndex < selectionHistory.length - 1) {
    selectionHistory = selectionHistory.slice(0, historyIndex + 1);
  }
  selectionHistory.push(currentSelection);
  historyIndex = selectionHistory.length - 1;
  updateHistoryButtons();
}

function updateHistoryButtons() {
  figma.ui.postMessage({
                         type: 'update-history-buttons',
                         historyBackEnabled: historyIndex > 0,
                         historyForwardEnabled: historyIndex < selectionHistory.length - 1
                       });
}

function processSelectedNodes(selectAll = false): void {
  const selectedNodes = figma.currentPage.selection;
  if (selectedNodes.length === 0) {
    figma.ui.postMessage({
                           css: '',
                           availableProps: [],
                           usedProps: [],
                           selectedFields
                         });
    nodesByBreakpointGlobal = {};
    return;
  }
  recordSelection();
  const availablePropsSet = new Set<string>();
  const breakpointEntries = Object.entries(breakpoints).sort(([, widthA], [, widthB]) => widthB - widthA);
  const nodesByBreakpoint: { [key: string]: SceneNode } = {};
  selectedNodes.forEach(node => {
    const parentFrame = findParentFrame(node);
    if (parentFrame) {
      const found = breakpointEntries.find(([, bpWidth]) => parentFrame.width >= bpWidth);
      if (found) {
        const [bpName, bpWidth] = found;
        if (nodesByBreakpoint[bpName]) {
          figma.notify(`Element for breakpoint ${bpWidth}px already selected!`);
        } else {
          nodesByBreakpoint[bpName] = node;
        }
      }
    }
  });
  nodesByBreakpointGlobal = nodesByBreakpoint;
  const mediaQueries: { [key: string]: { [key: string]: any } } = {};
  const mediaKeys = Object.keys(nodesByBreakpoint).sort((a, b) => breakpoints[a] - breakpoints[b]);
  let prevStyles: { [key: string]: any } = {};
  mediaKeys.forEach(bp => {
    const rawStyles = getNodeStyles(nodesByBreakpoint[bp]);
    Object.keys(rawStyles).forEach(prop => availablePropsSet.add(prop));
    let nodeStyles: { [key: string]: any };
    if (selectAll) {
      selectedFields = Object.keys(rawStyles);
      nodeStyles = rawStyles;
    } else {
      nodeStyles = Object.fromEntries(Object.entries(rawStyles).filter(([prop]) => selectedFields.includes(prop)));
    }
    const diff: { [key: string]: any } = {};
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
      if (bp === 'base') {
        generatedCSS += `/* Base styles (${breakpoints[bp]}px) */\n`;
        for (const [prop, value] of Object.entries(mediaQueries[bp])) {
          generatedCSS += `${prop}: ${value};\n`;
        }
        generatedCSS += '\n';
      } else {
        generatedCSS += `@media (min-width: ${bp}) {\n`;
        for (const [prop, value] of Object.entries(mediaQueries[bp])) {
          generatedCSS += `  ${prop}: ${value};\n`;
        }
        generatedCSS += '}\n\n';
      }
    }
  });
  const usedProps = new Set<string>();
  Object.values(mediaQueries).forEach(diff => Object.keys(diff).forEach(prop => usedProps.add(prop)));
  figma.ui.postMessage({
                         css: generatedCSS,
                         availableProps: Array.from(availablePropsSet),
                         usedProps: Array.from(usedProps),
                         selectedFields,
                         breakpoints: Object.entries(breakpoints).map(([name, width]) => ({
                           name,
                           width,
                           active: !!nodesByBreakpointGlobal[name]
                         }))
                       });
}

function switchToBreakpoint(bp: string): void {
  const node = nodesByBreakpointGlobal[bp];
  if (node) {
    figma.viewport.scrollAndZoomIntoView([node]);
    processSelectedNodes();
  } else {
    figma.notify(`Element for breakpoint ${breakpoints[bp]}px not found.`);
  }
}

function goHistoryBack(): void {
  if (historyIndex > 0) {
    historyIndex--;
    const previousSelection = selectionHistory[historyIndex];
    figma.currentPage.selection = previousSelection;
    figma.viewport.scrollAndZoomIntoView(previousSelection);
    processSelectedNodes();
    updateHistoryButtons();
  } else {
    figma.notify('No previous history.');
  }
}

function goHistoryForward(): void {
  if (historyIndex < selectionHistory.length - 1) {
    historyIndex++;
    const nextSelection = selectionHistory[historyIndex];
    figma.currentPage.selection = nextSelection;
    figma.viewport.scrollAndZoomIntoView(nextSelection);
    processSelectedNodes();
    updateHistoryButtons();
  } else {
    figma.notify('No forward history.');
  }
}

function navigateSelection(direction: 'up' | 'down'): void {
  const currentSelection = figma.currentPage.selection;
  const newSelection: SceneNode[] = [];
  currentSelection.forEach(node => {
    if (direction === 'up') {
      if (node.parent && node.parent.type !== 'PAGE') {
        newSelection.push(node.parent as SceneNode);
      }
    } else if (direction === 'down') {
      if ('children' in node && node.children.length > 0) {
        newSelection.push(node.children[0] as SceneNode);
      }
    }
  });
  if (newSelection.length > 0) {
    figma.currentPage.selection = newSelection;
    processSelectedNodes();
  } else {
    figma.notify(`No elements to navigate ${direction === 'up' ? 'up' : 'down'}.`);
  }
}

function navigateSiblings(direction: 'prev' | 'next'): void {
  const currentSelection = figma.currentPage.selection;
  const newSelectionSet = new Set<SceneNode>();
  currentSelection.forEach(node => {
    if (node.parent && 'children' in node.parent) {
      const siblings = node.parent.children as SceneNode[];
      const index = siblings.findIndex(sib => sib.id === node.id);
      if (index !== -1) {
        if (direction === 'prev' && index > 0) {
          newSelectionSet.add(siblings[index - 1]);
        }
        if (direction === 'next' && index < siblings.length - 1) {
          newSelectionSet.add(siblings[index + 1]);
        }
      }
    }
  });
  const newSelection = Array.from(newSelectionSet);
  if (newSelection.length > 0) {
    figma.currentPage.selection = newSelection;
    processSelectedNodes();
  } else {
    figma.notify(`No sibling elements to navigate ${direction === 'prev' ? 'left' : 'right'}.`);
  }
}

setTimeout(() => processSelectedNodes(figma.currentPage.selection.length === 1), 100);
figma.on('selectionchange', () => processSelectedNodes(figma.currentPage.selection.length === 1));

figma.ui.on('message', msg => {
  if (msg.type === 'update-fields') {
    selectedFields = msg.fields;
    processSelectedNodes();
  }
  if (msg.type === 'navigate') {
    navigateSelection(msg.direction);
  }
  if (msg.type === 'navigateSibling') {
    navigateSiblings(msg.direction);
  }
  if (msg.type === 'switchToBreakpoint') {
    switchToBreakpoint(msg.bp);
  }
  if (msg.type === 'historyBack') {
    goHistoryBack();
  }
  if (msg.type === 'historyForward') {
    goHistoryForward();
  }
  if (msg.type === 'toggleToRem') {
    useToRem = msg.useToRem;
    processSelectedNodes();
  }
});
