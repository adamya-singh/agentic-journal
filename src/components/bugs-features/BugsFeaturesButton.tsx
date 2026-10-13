'use client';

import React from 'react';
import { useBugsFeatures } from './BugsFeaturesProvider';
import { SunMark } from './icons';

/** The header button on every page: opens the Bugs/Features drawer and shows how many are open. */
export function BugsFeaturesButton() {
  const bugsFeatures = useBugsFeatures();
  if (!bugsFeatures) return null;
  const { openCount, isOpen, toggleDrawer } = bugsFeatures;
  return (
    <button
      type="button"
      className="bf-hbtn"
      onClick={toggleDrawer}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      title="Save a bug or feature for Claude Code (Ctrl+.)"
    >
      <SunMark />
      <span className="bf-lbl">Bugs/Features</span>
      <span className={`bf-n${openCount ? '' : ' zero'}`} aria-label={`${openCount} open`}>
        {openCount}
      </span>
    </button>
  );
}
