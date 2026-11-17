/**
 * Next focus index while the mobile navigation drawer is open.
 *
 * Returns null when Tab should keep the browser's natural target: an item in
 * the middle of the drawer, or a portaled control such as a Clerk menu.
 * `activeIndex` is -1 when focus is not on a drawer item.
 * `activeInPage` is true when focus has landed in the page behind the drawer.
 */
export function cycleDrawerFocusIndex(
  count: number,
  activeIndex: number,
  shiftKey: boolean,
  activeInPage: boolean,
): number | null {
  if (count <= 0) return null;
  if (activeInPage) return shiftKey ? count - 1 : 0;
  if (activeIndex < 0 || activeIndex >= count) return null;
  if (shiftKey && activeIndex === 0) return count - 1;
  if (!shiftKey && activeIndex === count - 1) return 0;
  return null;
}
