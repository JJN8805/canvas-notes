/** What the webview can tell about a video file before it is stored: its size on screen and length. Rejects when it can't play the file here. */
export function readVideoInfo(blob: Blob): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    const done = (fn: () => void) => {
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new Error('this video didn’t load (it may be in a format this device can’t play)'))), 8000);
    v.preload = 'metadata';
    v.muted = true;
    const answer = () => {
      if (v.videoWidth > 0 && v.videoHeight > 0) return done(() => resolve({ width: v.videoWidth, height: v.videoHeight, duration: Number.isFinite(v.duration) ? v.duration : 0 }));
      return false;
    };
    // The size is known once the metadata is in; some files (a fresh recording, a stream) only say it when the first frame has been decoded.
    v.onloadedmetadata = () => void answer();
    v.onloadeddata = () => {
      if (answer() === false) done(() => reject(new Error('this file has no picture to show (is it a video?)')));
    };
    v.onerror = () => done(() => reject(new Error('this device can’t play that video format')));
    v.src = url;
  });
}
