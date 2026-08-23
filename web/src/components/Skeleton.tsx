/* TASK-85: shared loading placeholder — pulse block matching home's pattern.
 * prefers-reduced-motion globally collapses animation duration, so this
 * renders as a static shimmer-free block for users who opt out of motion. */
export default function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block animate-pulse rounded bg-panel-2 ${className}`}
    />
  );
}
