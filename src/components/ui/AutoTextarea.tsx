import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> & {
  value: string;
  onValue: (v: string) => void;
};

/** A textarea that grows with its content (and re-measures when its width changes). */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, Props>(function AutoTextarea({ value, onValue, ...rest }, fwd) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(fwd, () => ref.current!);

  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = el.scrollHeight + 'px';
  };

  useLayoutEffect(fit, [value]);

  useLayoutEffect(() => {
    const el = ref.current!;
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== lastWidth) {
        lastWidth = el.clientWidth;
        fit();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return <textarea ref={ref} rows={1} value={value} onChange={(e) => onValue(e.target.value)} {...rest} />;
});
