import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QrCodeDisplayProps {
  value: string;
  size?: number;
  className?: string;
}

export function QrCodeDisplay({ value, size = 224, className = '' }: QrCodeDisplayProps) {
  const [svgMarkup, setSvgMarkup] = useState<string>('');
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let active = true;
    setHasError(false);

    QRCode.toString(value, {
      type: 'svg',
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0F172A',
        light: '#FFFFFF',
      },
    })
      .then((svg) => {
        if (active) {
          // Ensure responsive SVG sizing
          const sized = svg.replace('<svg ', `<svg width="${size}" height="${size}" class="w-full h-full block" `);
          setSvgMarkup(sized);
        }
      })
      .catch(() => {
        if (active) {
          setHasError(true);
        }
      });

    return () => {
      active = false;
    };
  }, [value, size]);

  if (hasError) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500 ${className}`}
      >
        QRコードの生成に失敗しました
      </div>
    );
  }

  if (!svgMarkup) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`animate-pulse rounded-xl bg-slate-100 ${className}`}
        aria-label="QRコードを生成中"
      />
    );
  }

  return (
    <div
      style={{ width: size, height: size }}
      className={`overflow-hidden rounded-xl border border-slate-200 bg-white p-2 ${className}`}
      role="img"
      aria-label={`トークルームへのQRコード: ${value}`}
      dangerouslySetInnerHTML={{ __html: svgMarkup }}
    />
  );
}
