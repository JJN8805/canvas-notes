import { useRef, useState } from 'react';

/**
 * A stored picture, GIF or video, as the right element: `<img>` for pictures and GIFs (a GIF animates by itself), `<video>` for a video.
 * A video shows its first frame; `play` says when it moves: 'hover' (a gallery tile plays while the pointer is over it), 'always'
 * (muted, looping), or 'controls' (the person presses play and can unmute). If this device cannot play the format, a short message
 * takes its place instead of a broken picture.
 */
export function Picture({ url, video = false, alt = '', play = 'hover', className }: { url: string; video?: boolean; alt?: string; play?: 'hover' | 'always' | 'controls' | 'never'; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  if (!video) return <img className={className} src={url} alt={alt} draggable={false} />;
  if (failed) return <span className={'pic-failed' + (className ? ' ' + className : '')}>This video can’t be played on this device</span>;
  const hover = play === 'hover';
  return (
    <video
      ref={ref}
      className={className}
      // `#t=0.001` makes the first frame show before anything plays.
      src={`${url}#t=0.001`}
      aria-label={alt || 'Video'}
      muted={play !== 'controls'}
      loop
      playsInline
      preload="metadata"
      autoPlay={play === 'always'}
      controls={play === 'controls'}
      draggable={false}
      onError={() => setFailed(true)}
      onMouseEnter={hover ? () => void ref.current?.play().catch(() => {}) : undefined}
      onMouseLeave={
        hover
          ? () => {
              const v = ref.current;
              if (v) {
                v.pause();
                v.currentTime = 0;
              }
            }
          : undefined
      }
    />
  );
}
