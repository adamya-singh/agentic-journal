'use client';

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { QuickCaptureInput } from './QuickCaptureInput';

interface QuickCaptureOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function QuickCaptureOverlay({ open, onClose }: QuickCaptureOverlayProps) {
  React.useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            onClick={onClose}
            className="fixed inset-0 z-[9998] bg-black/20 dark:bg-black/40"
          />
          <motion.div
            key="panel"
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ duration: 0.14 }}
            className="fixed top-8 left-1/2 -translate-x-1/2 z-[9999] w-[calc(100%-2rem)] max-w-2xl"
          >
            <div className="rounded-xl bg-white dark:bg-gray-800 shadow-2xl border border-gray-200 dark:border-gray-700 p-2">
              <QuickCaptureInput variant="overlay" autoFocus />
              <div className="px-2 pt-1.5 pb-0.5 text-[11px] text-gray-400 dark:text-gray-500">
                Enter to capture · stays open for more · Esc to close
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
