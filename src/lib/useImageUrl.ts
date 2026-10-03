import { useEffect, useState } from 'react';
import { getStorage } from '../store/notes';

/** Resolves a stored image id to an object URL. `null` = missing, `undefined` = loading. */
export function useImageUrl(imageId: string): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setUrl(undefined);
    getStorage()
      .imageUrl(imageId)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
    };
  }, [imageId]);
  return url;
}
