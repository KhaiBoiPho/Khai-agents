const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Top-level Markdown blocks, split at blank lines outside code fences.
 *
 * While a reply streams, only its last block changes; rendering blocks
 * separately lets every finished one keep its parsed tree instead of the
 * whole message being re-parsed (and re-highlighted) on every frame. A line
 * that starts indented continues the previous block (list items, nested
 * content), so splitting never changes what the Markdown means there.
 */
export function splitMarkdownBlocks(markdown: string): string[] {
  const lines = markdown.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  let blank = false;
  for (const line of lines) {
    const marker = FENCE.exec(line)?.[1];
    if (fence) {
      current.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (!line.trim()) {
      blank = true;
      current.push(line);
      continue;
    }
    if (blank && current.some((entry) => entry.trim()) && !/^\s/.test(line)) {
      blocks.push(current.join("\n"));
      current = [];
    }
    blank = false;
    if (marker) fence = marker;
    current.push(line);
  }
  if (current.length) blocks.push(current.join("\n"));
  return blocks;
}
