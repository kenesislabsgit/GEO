export function ScoreRing({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = 84;
  const circumference = 2 * Math.PI * radius;
  const filled = (clamped / 100) * circumference;

  return (
    <div className="relative size-48 md:size-56" role="img" aria-label={`AI Visibility Score ${score} out of 100`}>
      <svg viewBox="0 0 200 200" className="size-full -rotate-90">
        <circle
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth="10"
        />
        <circle
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          stroke="var(--rb-blue)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference - filled}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-5xl font-semibold tracking-tight text-white md:text-6xl">
          {score}
        </span>
        <span className="mt-1 text-[11px] font-medium tracking-wide text-white/50 uppercase">
          AI Visibility
        </span>
      </div>
    </div>
  );
}
