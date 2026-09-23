/** One lab-wide number. `value` is null while the count is still loading (never a made-up placeholder figure). */
export function StatCard({ value, label }: { value: number | null; label: string }) {
  return (
    <div className="stat-card">
      <div className="stat-card__value">{value === null ? "–" : value}</div>
      <div className="stat-card__label">{label}</div>
    </div>
  );
}
