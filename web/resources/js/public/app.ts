// Progressive enhancement only: public pages are complete without JavaScript (budget < 10 KB).
// Each enhanced element gets `is-ready` (or `is-clamped`) itself: a class on <html> would restyle and lay out the whole page
// once more right after the first paint, the longest task these pages have.
const all = <T extends Element>(selector: string, root: ParentNode = document): T[] => Array.from(root.querySelectorAll<T>(selector));

// FS-3 hero pager: the browser scrolls and snaps, this keeps the counter right and lets the small photos move the large one without jumping the page.
function pager(): void {
    const track = document.querySelector<HTMLElement>('[data-pager]');

    if (!track) return;

    const count = document.querySelector<HTMLElement>('[data-pager-count]');
    let frame = 0;

    track.addEventListener(
        'scroll',
        () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                if (count) count.textContent = `${Math.round(track.scrollLeft / track.clientWidth) + 1}/${count.dataset.total ?? ''}`;
            });
        },
        { passive: true },
    );

    all<HTMLAnchorElement>('[data-pager-link]').forEach((link) => {
        link.addEventListener('click', (event) => {
            event.preventDefault();
            track.scrollTo({ left: Number(link.dataset.pagerLink) * track.clientWidth });
        });
    });
}

// "Mehr anzeigen": the text is complete in the HTML; clamping starts here, and the button only appears when something is cut off.
// The check waits for the browser's own layout (ResizeObserver) instead of forcing one, and runs again when the web font changes the lines.
function clamp(): void {
    all<HTMLElement>('[data-clamp]').forEach((text) => {
        const button = text.parentElement?.querySelector<HTMLButtonElement>('[data-clamp-toggle]');

        if (!button) return;

        text.classList.add('is-clamped');
        button.addEventListener('click', () => {
            text.classList.add('is-open');
            text.removeAttribute('title');
            button.hidden = true;
        });

        const check = (): boolean => {
            if (text.scrollHeight <= text.clientHeight + 1) return false;

            button.hidden = false;
            text.title = text.textContent ?? '';

            return true;
        };

        if (!('ResizeObserver' in window)) {
            check();

            return;
        }

        const observer = new ResizeObserver(() => {
            if (text.classList.contains('is-open') || check()) observer.disconnect();
        });

        observer.observe(text);
    });
}

// Native share sheet where it exists, otherwise the address on the clipboard, confirmed in words.
function share(): void {
    all<HTMLButtonElement>('[data-share]').forEach((button) => {
        button.classList.add('is-ready');
        button.addEventListener('click', () => {
            const url = button.dataset.shareUrl ?? location.href;
            const title = button.dataset.shareTitle ?? document.title;

            if (navigator.share) {
                navigator.share({ title, url }).catch(() => undefined);

                return;
            }

            navigator.clipboard?.writeText(url).then(() => {
                const status = document.querySelector<HTMLElement>('[data-share-status]');

                if (status) status.textContent = button.dataset.shareDone ?? '';
            }).catch(() => undefined);
        });
    });
}

// The same key as the inline head script.
function theme(): void {
    const buttons = all<HTMLButtonElement>('[data-theme-value]');
    const root = document.documentElement;
    const mark = (): void => buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.themeValue === root.dataset.theme)));

    mark();
    all<HTMLElement>('[data-theme-picker]').forEach((picker) => picker.classList.add('is-ready'));
    buttons.forEach((button) => {
        button.addEventListener('click', () => {
            root.dataset.theme = button.dataset.themeValue ?? 'system';

            try {
                localStorage.setItem('sc-theme', root.dataset.theme);
            } catch {
                // Blocked storage: the choice lasts for this page.
            }

            mark();
        });
    });
}

// The anchored nav shows the section being read.
function spy(): void {
    const links = all<HTMLAnchorElement>('[data-spy-link]');

    if (links.length === 0 || !('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver(
        (entries) => {
            const visible = entries.find((entry) => entry.isIntersecting);

            if (!visible) return;

            links.forEach((link) => {
                if (link.dataset.spyLink === visible.target.id) {
                    link.setAttribute('aria-current', 'true');
                    link.parentElement?.scrollTo({ left: link.offsetLeft - 16 });
                } else {
                    link.removeAttribute('aria-current');
                }
            });
        },
        { rootMargin: '-20% 0px -70% 0px' },
    );

    links.forEach((link) => {
        const section = document.getElementById(link.dataset.spyLink ?? '');

        if (section) observer.observe(section);
    });
}

// F4: the installed app if there is one, else the store. Until a listing exists the plain link to the web app stands, and an unknown scheme never shows an error.
function openApp(): void {
    all<HTMLAnchorElement>('[data-open-app]').forEach((link) => {
        const { deepLink, storeIos, storeAndroid } = link.dataset;
        const agent = navigator.userAgent;

        if (!deepLink) return;

        if (/Android/i.test(agent)) {
            const fallback = encodeURIComponent(storeAndroid || link.href);
            link.href = `intent://${deepLink.replace(/^[a-z]+:\/\//, '')}#Intent;scheme=${deepLink.split(':')[0]};S.browser_fallback_url=${fallback};end`;
        } else if (/iPhone|iPad|iPod/i.test(agent) && storeIos) {
            link.addEventListener('click', (event) => {
                event.preventDefault();

                const timer = setTimeout(() => {
                    location.href = storeIos;
                }, 1200);

                window.addEventListener('pagehide', () => clearTimeout(timer), { once: true });
                location.href = deepLink;
            });
        }
    });
}

// §8 radios and checkboxes (DQ-425) show their focus ring on :focus, because WebKit drops :focus-visible when the arrow keys move
// through a radio group. A pointer press marks the document so a click alone draws no ring; the next key takes the mark away.
function pointerFocus(): void {
    const root = document.documentElement;

    document.addEventListener('pointerdown', () => root.setAttribute('data-sc-pointer', ''), true);
    document.addEventListener('keydown', () => root.removeAttribute('data-sc-pointer'), true);
}

pointerFocus();
pager();
clamp();
share();
theme();
spy();
openApp();
