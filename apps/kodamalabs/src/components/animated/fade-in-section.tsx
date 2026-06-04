'use client';

import * as React from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';

import { cn } from '@/lib/utils';

type FadeInSectionProps = HTMLMotionProps<'div'> & {
  delay?: number;
  /** Distance in pixels for the entrance translate. Defaults to 24. */
  y?: number;
};

export function FadeInSection({
  className,
  delay = 0,
  y = 24,
  children,
  ...props
}: FadeInSectionProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay }}
      className={cn(className)}
      {...props}
    >
      {children}
    </motion.div>
  );
}
