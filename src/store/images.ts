import { addBlock, getStorage } from './notes';
import { toast } from './ui';

const MAX_SIDE = 4096;
const KEEP_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif'];

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('this file can’t be read as an image'));
    };
    img.src = url;
  });
}

/** Keeps the original file unless it is huge or in a format the app can’t store. */
export async function prepareImage(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const img = await loadImage(file);
  const width = img.naturalWidth || 400;
  const height = img.naturalHeight || 300;
  const tooBig = Math.max(width, height) > MAX_SIDE;
  if (!tooBig && KEEP_TYPES.includes(file.type)) return { blob: file, width, height };

  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.9));
  if (!blob) throw new Error('the image couldn’t be converted');
  return { blob, width: canvas.width, height: canvas.height };
}

export function imageFiles(dt: DataTransfer | null): File[] {
  return dt ? Array.from(dt.files).filter((f) => f.type.startsWith('image/')) : [];
}

/** Stores the files and places them on the page, cascading from `at`. Returns the new block ids. */
export async function addImages(pageId: string, files: File[], at: { x: number; y: number }): Promise<string[]> {
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (!images.length) {
    toast('Only image files can be placed on a page.');
    return [];
  }
  const ids: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const f = images[i];
    try {
      const { blob, width, height } = await prepareImage(f);
      const imageId = await getStorage().putImage(blob);
      const s = Math.min(1, 440 / width, 360 / height);
      ids.push(
        addBlock(pageId, 'image', { x: at.x + i * 24, y: at.y + i * 24 }, {
          imageId,
          aspect: width / height,
          w: Math.max(48, Math.round(width * s)),
          h: Math.max(32, Math.round(height * s)),
          alt: f.name.replace(/\.[^.]+$/, ''),
        }),
      );
    } catch (e) {
      toast(`Couldn’t add ${f.name || 'the image'}: ${e instanceof Error ? e.message : 'unknown error'}.`);
    }
  }
  return ids;
}
