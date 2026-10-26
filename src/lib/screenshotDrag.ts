export function quoteForShell(path: string) {
  return /^[A-Za-z0-9_./@%+:,=-]+$/.test(path)
    ? path
    : `'${path.replace(/'/g, "'\\''")}'`;
}

export function terminalAtPoint(x: number, y: number): HTMLElement | null {
  return document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-terminal-id]") ?? null;
}
