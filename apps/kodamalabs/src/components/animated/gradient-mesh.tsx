'use client';

import { motion } from 'framer-motion';

import { cn } from '@/lib/utils';

type Blob = {
  className: string;
  duration: number;
  delay: number;
  path: { x: number[]; y: number[] };
};

const blobs: Blob[] = [
  {
    className:
      'left-[8%] top-[12%] h-[480px] w-[480px] bg-[radial-gradient(circle_at_center,oklch(0.7_0.18_160_/_0.35),transparent_70%)]',
    duration: 22,
    delay: 0,
    path: { x: [0, 40, -20, 0], y: [0, -30, 20, 0] },
  },
  {
    className:
      'right-[6%] top-[28%] h-[420px] w-[420px] bg-[radial-gradient(circle_at_center,oklch(0.7_0.18_220_/_0.3),transparent_70%)]',
    duration: 26,
    delay: 2,
    path: { x: [0, -50, 30, 0], y: [0, 40, -20, 0] },
  },
  {
    className:
      'left-[40%] bottom-[8%] h-[520px] w-[520px] bg-[radial-gradient(circle_at_center,oklch(0.65_0.2_290_/_0.28),transparent_70%)]',
    duration: 30,
    delay: 4,
    path: { x: [0, 30, -40, 0], y: [0, -20, 30, 0] },
  },
];

interface GradientMeshProps {
  className?: string;
}

export function GradientMesh({ className }: GradientMeshProps) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      {blobs.map((blob, i) => (
        <motion.div
          key={i}
          className={cn('absolute rounded-full blur-3xl', blob.className)}
          animate={{ x: blob.path.x, y: blob.path.y }}
          transition={{
            duration: blob.duration,
            delay: blob.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}
      <div className="grain absolute inset-0 opacity-40" />
    </div>
  );
}
