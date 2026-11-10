/**
 * `/` focuses the search. A screen with a search field may register how to focus it (DISC-01 can, in an M2.3 wiring step);
 * without a registration the shortcut opens Entdecken and focuses the first visible search box there (`role="searchbox"`,
 * which every `SearchBar` renders). Web only.
 */
type Focuser = () => boolean;

let registered: Focuser | null = null;

/** Returns the release. The newest registration wins: it is the screen in front. */
export function registerSearchFocus(focus: Focuser): () => void {
  registered = focus;
  return () => {
    if (registered === focus) registered = null;
  };
}

export function focusRegisteredSearch(): boolean {
  return registered?.() ?? false;
}

type FocusableElement = { focus: () => void; offsetParent: unknown; getClientRects?: () => { length: number } };
type DocumentLike = { querySelectorAll: (selector: string) => ArrayLike<unknown> };

/** The first search box that is laid out (not hidden in a background tab), focused. */
export function focusVisibleSearchBox(doc: DocumentLike | undefined = typeof document === 'undefined' ? undefined : document): boolean {
  if (!doc) return false;
  const boxes = doc.querySelectorAll('input[role="searchbox"], [role="searchbox"] input, input[type="search"]');
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index] as FocusableElement | undefined;
    if (!box) continue;
    const visible = box.offsetParent !== null || (box.getClientRects?.().length ?? 0) > 0;
    if (visible) {
      box.focus();
      return true;
    }
  }
  return false;
}
