export type SplitOrientation = "horizontal" | "vertical";

export interface PanelInstance {
  panelId: string;
  contentRef: string;
}

export interface StackNode {
  kind: "stack";
  stackId: string;
  panelIds: string[];
}

export interface SplitNode {
  kind: "split";
  splitId: string;
  orientation: SplitOrientation;
  children: LayoutNode[];
}

export type LayoutNode = StackNode | SplitNode;

export interface LayoutTree {
  root: LayoutNode;
  panels: Record<string, PanelInstance>;
}

export type LayoutCommand =
  | { kind: "swap"; leftPanelId: string; rightPanelId: string }
  | { kind: "mergeTab"; panelId: string; targetStackId: string }
  | { kind: "splitPane"; panelId: string; orientation: SplitOrientation; splitId: string; stackId: string };

function replacePanelIds(node: LayoutNode, leftPanelId: string, rightPanelId: string): LayoutNode {
  if (node.kind === "stack") {
    return {
      ...node,
      panelIds: node.panelIds.map((panelId) => {
        if (panelId === leftPanelId) return rightPanelId;
        if (panelId === rightPanelId) return leftPanelId;
        return panelId;
      }),
    };
  }
  return { ...node, children: node.children.map((child) => replacePanelIds(child, leftPanelId, rightPanelId)) };
}

function removePanel(node: LayoutNode, panelId: string): LayoutNode {
  if (node.kind === "stack") return { ...node, panelIds: node.panelIds.filter((id) => id !== panelId) };
  return { ...node, children: node.children.map((child) => removePanel(child, panelId)) };
}

function appendToStack(node: LayoutNode, stackId: string, panelId: string): LayoutNode {
  if (node.kind === "stack") {
    return node.stackId === stackId && !node.panelIds.includes(panelId)
      ? { ...node, panelIds: [...node.panelIds, panelId] }
      : node;
  }
  return { ...node, children: node.children.map((child) => appendToStack(child, stackId, panelId)) };
}

function splitStack(
  node: LayoutNode,
  panelId: string,
  orientation: SplitOrientation,
  splitId: string,
  stackId: string,
): LayoutNode {
  if (node.kind === "stack") {
    if (node.stackId !== stackId || !node.panelIds.includes(panelId)) return node;
    const remaining: StackNode = {
      kind: "stack",
      stackId: node.stackId,
      panelIds: node.panelIds.filter((id) => id !== panelId),
    };
    const detached: StackNode = { kind: "stack", stackId: `${stackId}:split`, panelIds: [panelId] };
    return { kind: "split", splitId, orientation, children: [remaining, detached] };
  }
  return {
    ...node,
    children: node.children.map((child) => splitStack(child, panelId, orientation, splitId, stackId)),
  };
}

export function applyLayoutCommand(tree: LayoutTree, command: LayoutCommand): LayoutTree {
  if (command.kind === "swap") {
    return { ...tree, root: replacePanelIds(tree.root, command.leftPanelId, command.rightPanelId) };
  }
  if (command.kind === "mergeTab") {
    return {
      ...tree,
      root: appendToStack(removePanel(tree.root, command.panelId), command.targetStackId, command.panelId),
    };
  }

  return {
    ...tree,
    root: splitStack(tree.root, command.panelId, command.orientation, command.splitId, command.stackId),
  };
}
export function stackPanelIds(node: LayoutNode, stackId: string): string[] | null {
  if (node.kind === "stack") return node.stackId === stackId ? [...node.panelIds] : null;
  for (const child of node.children) {
    const panelIds = stackPanelIds(child, stackId);
    if (panelIds) return panelIds;
  }
  return null;
}

export class LayoutHistory {
  private readonly states: LayoutTree[];
  private cursor: number;

  constructor(initial: LayoutTree) {
    this.states = [structuredClone(initial)];
    this.cursor = 0;
  }

  execute(command: LayoutCommand): LayoutTree {
    const next = applyLayoutCommand(this.states[this.cursor]!, command);
    this.states.splice(this.cursor + 1);
    this.states.push(structuredClone(next));
    this.cursor += 1;
    return structuredClone(next);
  }

  undo(): LayoutTree {
    this.cursor = Math.max(0, this.cursor - 1);
    return structuredClone(this.states[this.cursor]!);
  }

  redo(): LayoutTree {
    this.cursor = Math.min(this.states.length - 1, this.cursor + 1);
    return structuredClone(this.states[this.cursor]!);
  }
}
