// Risk band chip: monochrome, always with a text label (docs/design brief).
export const BAND_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High", auto_high: "Auto-High", prohibited: "Prohibited" };

export function Band({ band }: { band: string | null | undefined }) {
  if (!band) return <span className="muted">Not scored</span>;
  return <span className={`band ${band}`}>{BAND_LABEL[band] ?? band}</span>;
}
