'use client';

import React from 'react';
import { X, Zap } from 'lucide-react';
import { useQuickCapture } from './QuickCaptureProvider';

interface QuickCaptureInputProps {
  variant: 'inline' | 'overlay';
  autoFocus?: boolean;
}

interface PastedImage {
  key: string;
  url: string;
  file: File;
}

// Matches the server's limit in src/lib/capture/images.ts.
const MAX_IMAGES = 8;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

function imageFiles(items: DataTransferItemList | undefined): File[] {
  return [...(items ?? [])]
    .filter((entry) => entry.kind === 'file' && IMAGE_TYPES.includes(entry.type))
    .map((entry) => entry.getAsFile())
    .filter((file): file is File => !!file);
}

export function QuickCaptureInput({ variant, autoFocus }: QuickCaptureInputProps) {
  const { submitCapture } = useQuickCapture();
  const [value, setValue] = React.useState('');
  const [images, setImages] = React.useState<PastedImage[]>([]);
  const imagesRef = React.useRef(images);
  imagesRef.current = images;

  // Previews are object URLs; free whatever is still attached when the input goes away.
  React.useEffect(
    () => () => imagesRef.current.forEach((image) => URL.revokeObjectURL(image.url)),
    [],
  );

  const addImages = (files: File[]) => {
    setImages((current) => [
      ...current,
      ...files.slice(0, MAX_IMAGES - current.length).map((file) => ({
        key: crypto.randomUUID(),
        url: URL.createObjectURL(file),
        file,
      })),
    ]);
  };

  const removeImage = (key: string) => {
    setImages((current) => {
      current.filter((image) => image.key === key).forEach((image) => URL.revokeObjectURL(image.url));
      return current.filter((image) => image.key !== key);
    });
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const files = imageFiles(event.clipboardData?.items);
    if (!files.length) {
      return;
    }
    event.preventDefault();
    // Keep the Bugs/Features drawer's document-level paste listener from grabbing it too.
    event.stopPropagation();
    addImages(files);
  };

  const handleDrop = (event: React.DragEvent<HTMLInputElement>) => {
    const files = imageFiles(event.dataTransfer?.items);
    if (!files.length) {
      return;
    }
    event.preventDefault();
    addImages(files);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !value && images.length) {
      removeImage(images[images.length - 1].key);
      return;
    }
    if (event.key !== 'Enter') {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed && !images.length) {
      return;
    }
    submitCapture(trimmed, images.map((image) => image.file));
    images.forEach((image) => URL.revokeObjectURL(image.url));
    setImages([]);
    setValue('');
  };

  const overlay = variant === 'overlay';
  const sizing = overlay ? 'px-4 py-3 text-base' : 'px-3.5 py-2 text-sm';
  const thumb = overlay ? 32 : 24;
  const shown = images.slice(0, 4);
  const extra = images.length - shown.length;
  // Room on the right for the thumbnails so the text never runs under them.
  const paddingRight = images.length ? shown.length * (thumb + 4) + (extra ? 28 : 0) + 12 : undefined;

  return (
    <div className="relative">
      <Zap
        className={`absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 ${
          overlay ? 'w-5 h-5' : 'w-4 h-4'
        }`}
      />
      <input
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onDrop={handleDrop}
        autoFocus={autoFocus}
        placeholder={images.length ? 'Add a note, or press Enter…' : 'Capture a thought… (⌘K)'}
        style={paddingRight ? { paddingRight } : undefined}
        className={`w-full ${sizing} pl-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:focus:ring-indigo-500 focus:border-transparent transition-shadow`}
      />
      {images.length > 0 && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {shown.map((image) => (
            <div key={image.key} className="group relative shrink-0" style={{ width: thumb, height: thumb }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
              <img
                src={image.url}
                alt="Pasted image"
                className="w-full h-full rounded object-cover ring-1 ring-gray-300 dark:ring-gray-600"
              />
              <button
                type="button"
                onClick={() => removeImage(image.key)}
                title="Remove image"
                aria-label="Remove image"
                className="absolute -top-1.5 -right-1.5 hidden group-hover:flex items-center justify-center w-4 h-4 rounded-full bg-gray-700 text-white dark:bg-gray-200 dark:text-gray-900"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
          {extra > 0 && (
            <span className="w-6 text-center text-xs text-gray-500 dark:text-gray-400">+{extra}</span>
          )}
        </div>
      )}
    </div>
  );
}
