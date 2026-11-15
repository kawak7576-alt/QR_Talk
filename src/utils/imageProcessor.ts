import { MAX_IMAGE_DATA_URL_LENGTH, type ChatImage } from '../types/chat';

const MAX_DIMENSION = 1600;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('ファイルの読み込みに失敗しました。'));
      }
    };
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました。'));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像の解析に失敗しました。'));
    img.src = src;
  });
}

export async function processImageFile(file: File): Promise<ChatImage> {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `img-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const objectUrl = URL.createObjectURL(file);
  try {
    // Preserve animated GIFs if within limit
    if (file.type === 'image/gif') {
      const rawDataUrl = await readFileAsDataUrl(file);
      if (rawDataUrl.length <= MAX_IMAGE_DATA_URL_LENGTH) {
        const el = await loadImageElement(rawDataUrl);
        return {
          id,
          name: file.name || 'image.gif',
          mimeType: 'image/gif',
          dataUrl: rawDataUrl,
          width: el.naturalWidth,
          height: el.naturalHeight,
        };
      }
    }

    const imgEl = await loadImageElement(objectUrl);
    const srcW = imgEl.naturalWidth || 1;
    const srcH = imgEl.naturalHeight || 1;

    const scale = Math.min(1, MAX_DIMENSION / Math.max(srcW, srcH));
    const targetW = Math.max(1, Math.round(srcW * scale));
    const targetH = Math.max(1, Math.round(srcH * scale));

    // If PNG is already small enough and doesn't need resize, keep crisp PNG
    if (file.type === 'image/png' && scale === 1 && file.size <= 900_000) {
      const pngDataUrl = await readFileAsDataUrl(file);
      if (pngDataUrl.length <= MAX_IMAGE_DATA_URL_LENGTH) {
        return {
          id,
          name: file.name || 'image.png',
          mimeType: 'image/png',
          dataUrl: pngDataUrl,
          width: srcW,
          height: srcH,
        };
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('画像の変換に失敗しました。');
    }

    // Fill white background for transparent sources converted to JPEG
    const keepPng = file.type === 'image/png';
    if (!keepPng) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetW, targetH);
    }
    ctx.drawImage(imgEl, 0, 0, targetW, targetH);

    let mimeType = keepPng ? 'image/png' : 'image/jpeg';
    let dataUrl = keepPng
      ? canvas.toDataURL('image/png')
      : canvas.toDataURL('image/jpeg', 0.85);

    if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
      // Fallback to JPEG compression steps if PNG or high-res exceeded limit
      mimeType = 'image/jpeg';
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetW, targetH);
      ctx.globalCompositeOperation = 'source-over';

      for (const quality of [0.8, 0.65, 0.5]) {
        dataUrl = canvas.toDataURL('image/jpeg', quality);
        if (dataUrl.length <= MAX_IMAGE_DATA_URL_LENGTH) {
          break;
        }
      }
    }

    if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
      throw new Error('画像サイズが大きすぎます。別の画像を選択してください。');
    }

    const baseName = (file.name || 'image').replace(/\.[^.]+$/, '');
    const ext = mimeType === 'image/png' ? 'png' : 'jpg';

    return {
      id,
      name: `${baseName}.${ext}`,
      mimeType,
      dataUrl,
      width: targetW,
      height: targetH,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function downloadChatImage(image: ChatImage): void {
  const link = document.createElement('a');
  link.href = image.dataUrl;
  link.download = image.name || 'image.jpg';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function copyChatImageToClipboard(image: ChatImage): Promise<boolean> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    return false;
  }

  try {
    const imgEl = await loadImageElement(image.dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = imgEl.naturalWidth || 1;
    canvas.height = imgEl.naturalHeight || 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(imgEl, 0, 0);

    const pngBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((blob) => resolve(blob), 'image/png')
    );
    if (!pngBlob) return false;

    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': pngBlob,
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}
