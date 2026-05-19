'use client';

import React, { useEffect } from 'react';

type ModalMaxWidth = 'md' | 'lg';

interface ModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  maxWidth?: ModalMaxWidth;
  panelClassName?: string;
  children: React.ReactNode;
}

interface ModalSectionProps {
  children: React.ReactNode;
  className?: string;
}

const maxWidthClasses: Record<ModalMaxWidth, string> = {
  md: 'max-w-md',
  lg: 'max-w-lg',
};

function joinClassNames(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(' ');
}

function ModalShellRoot({
  isOpen,
  onClose,
  maxWidth = 'lg',
  panelClassName,
  children,
}: ModalShellProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 overflow-y-auto"
      onClick={onClose}
    >
      <div className="min-h-full flex items-center justify-center p-4">
        <div
          onClick={(event) => event.stopPropagation()}
          className={joinClassNames(
            'bg-white dark:bg-gray-800 rounded-2xl w-full shadow-2xl transform transition-all max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden',
            maxWidthClasses[maxWidth],
            panelClassName,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function ModalHeader({ children, className }: ModalSectionProps) {
  return (
    <div
      className={joinClassNames(
        'shrink-0 px-6 sm:px-8 pt-6 sm:pt-8 pb-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

function ModalBody({ children, className }: ModalSectionProps) {
  return (
    <div
      className={joinClassNames(
        'flex-1 min-h-0 overflow-y-auto px-6 sm:px-8 py-2',
        className,
      )}
    >
      {children}
    </div>
  );
}

function ModalFooter({ children, className }: ModalSectionProps) {
  return (
    <div
      className={joinClassNames(
        'shrink-0 px-6 sm:px-8 pb-6 sm:pb-8 pt-4 flex justify-end gap-3 border-t border-gray-100 dark:border-gray-700',
        className,
      )}
    >
      {children}
    </div>
  );
}

export const ModalShell = Object.assign(ModalShellRoot, {
  Header: ModalHeader,
  Body: ModalBody,
  Footer: ModalFooter,
});
