import { Instrument_Serif } from 'next/font/google';

/** The Mission theme's display serif; put `missionSerif.variable` on a page's root. */
export const missionSerif = Instrument_Serif({
  weight: '400',
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-instrument-serif',
});
