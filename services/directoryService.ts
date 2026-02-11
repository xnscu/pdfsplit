import { QuestionImage } from "../types";
import contentRaw from "@/assets/content.txt?raw";

export interface DirectoryNode {
  id: string; // unique ID for key
  name: string; // Full text e.g. "1.1.1 集合及其表示方法"
  level: number; // 0, 1, 2, 3
  children: DirectoryNode[];
  parent?: DirectoryNode; // Reference to parent for full path logic if needed
}

/**
 * Parsed directory structure from content.txt
 */
export const directoryTree: DirectoryNode[] = parseDirectory(contentRaw);

function parseDirectory(content: string): DirectoryNode[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rootNodes: DirectoryNode[] = [];
  const stack: DirectoryNode[] = []; // Stack keeps track of hierarchy: [Level0, Level1, Level2, ...]

  lines.forEach((line, index) => {
    // Determine level
    let level = 0;
    if (line.startsWith("      ")) level = 3;
    else if (line.startsWith("    ")) level = 2;
    else if (line.startsWith("  ")) level = 1;
    else level = 0;

    const name = line.trim().replace(/^-\s*/, "").replace(/:$/, ""); // Remove leading "- " and trailing ":"

    const node: DirectoryNode = {
      id: `node-${index}`,
      name,
      level,
      children: [],
    };

    // Find parent
    // Stack should have nodes up to level-1
    // If current level is L, we pop stack until stack has L items (indices 0..L-1)
    // Actually if level is 0, stack empty.
    // If level is 1, stack should have 1 item (Level 0).

    // Pop until stack size matches level.
    // Example: Node L1. Stack has [L0, L1_old]. Pop L1_old. Stack has [L0]. Parent is L0.
    // Example: Node L0. Stack has [L0_old]. Pop L0_old. Stack empty. No parent.
    while (stack.length > level) {
      stack.pop();
    }

    if (stack.length > 0) {
      const parent = stack[stack.length - 1];
      parent.children.push(node);
      node.parent = parent;
    } else {
      rootNodes.push(node);
    }

    stack.push(node);
  });

  return rootNodes;
}

/**
 * Filter questions based on selected directory node.
 * It matches any tag in the question that matches the node's level and name.
 */
export function filterQuestionsByNode(questions: QuestionImage[], node: DirectoryNode): QuestionImage[] {
  return questions.filter((q) => {
    const analysis = q.analysis || q.pro_analysis;
    if (!analysis || !analysis.tags) return false;

    // Check if any tag matches the selected node
    return analysis.tags.some((tag) => {
      // Logic:
      // If node is Level 0 (Chapter), we check if tag.level0 == node.name
      // If node is Level 1 (Section), we check if tag.level1 == node.name (and optionally parent matches level0)
      // Usually matching the specific level content is sufficient if names are unique enough.
      // But "1. 集合" might appear in multiple places? No, usually not.
      // Let's match strictly by level.

      switch (node.level) {
        case 0:
          // Fuzzy match or exact?
          // "第一章 集合与常用逻辑用语" vs "第一章 集合"
          // Let's try exact match locally first.
          return tag.level0 === node.name || (tag.level0 && node.name.startsWith(tag.level0));
        case 1:
          return tag.level1 === node.name || (tag.level1 && node.name.startsWith(tag.level1));
        case 2:
          return tag.level2 === node.name || (tag.level2 && node.name.startsWith(tag.level2));
        case 3:
          return tag.level3 === node.name || (tag.level3 && node.name.startsWith(tag.level3));
        default:
          return false;
      }
    });
  });
}

/**
 * Get flattened list of all nodes for search or flat display if needed
 */
export function getAllNodes(nodes: DirectoryNode[] = directoryTree): DirectoryNode[] {
  let result: DirectoryNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children.length > 0) {
      result = result.concat(getAllNodes(node.children));
    }
  }
  return result;
}
