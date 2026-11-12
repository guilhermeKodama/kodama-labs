'use client';

import { useEffect } from 'react';

import { startMotion } from './controller';

/** Starts the motion controller once the page has hydrated. Renders nothing. */
export function MotionRoot() {
  useEffect(() => startMotion(), []);
  return null;
}
