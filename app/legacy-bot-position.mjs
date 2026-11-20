/** Position the chat above its launcher, falling below when that side has more room. */
export function legacyBotPosition(anchor, size, viewport, dock) {
  const edge = 12, gap = 12;
  const width = Math.min(size.width, Math.max(0, viewport.width - edge * 2));
  const height = Math.min(size.height, Math.max(0, viewport.height - edge * 2));
  const anchorTop = Math.min(anchor.top, dock?.top ?? anchor.top);
  const above = anchorTop - gap - edge;
  const below = viewport.height - edge - anchor.bottom - gap;
  const preferredTop = height <= above || above >= below ? anchorTop - gap - height : anchor.bottom + gap;
  return {
    left: Math.max(edge, Math.min(anchor.right - width, viewport.width - edge - width)),
    top: Math.max(edge, Math.min(preferredTop, viewport.height - edge - height)),
  };
}
