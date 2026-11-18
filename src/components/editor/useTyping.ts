import { useEffect, useState } from 'react';
import { isTextEntry } from '../../lib/util';

/**
 * On a touch screen: true while a text field in the page area has the focus, which is when the on-screen keyboard is up. The page then
 * gives the keyboard's room back (the add tools and zoom buttons step aside) and docks the formatting bar just above the keyboard.
 * Also keeps `--kb` (the keyboard's height as the page sees it) up to date for the bar.
 */
export function useTyping(enabled: boolean): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let timer = 0;
    const inPage = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('.ed-body') && isTextEntry(t);
    const onIn = (e: FocusEvent) => {
      window.clearTimeout(timer);
      setTyping(inPage(e.target));
    };
    const onOut = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setTyping(false), 80); // a new focus right after (box to box) cancels it
    };
    const vv = window.visualViewport;
    const inset = () => document.documentElement.style.setProperty('--kb', `${Math.max(0, Math.round(window.innerHeight - (vv?.height ?? window.innerHeight) - (vv?.offsetTop ?? 0)))}px`);
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    vv?.addEventListener('resize', inset);
    vv?.addEventListener('scroll', inset);
    inset();
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
      vv?.removeEventListener('resize', inset);
      vv?.removeEventListener('scroll', inset);
      document.documentElement.style.removeProperty('--kb');
    };
  }, [enabled]);
  return enabled && typing;
}
