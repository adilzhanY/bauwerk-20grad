/** Twelve small bars for the monthly PV yield, January first, in the scale's yellow. */
export function MonthBars({ values, label }: { values: readonly number[]; label: string }) {
  const max = Math.max(1e-9, ...values);
  return (
    <span role="img" aria-label={label} className="flex h-6 items-end gap-[3px]">
      {values.map((v, i) => (
        <span
          key={i}
          className="w-[5px] rounded-t-[2px] bg-sun"
          style={{ height: `${String(Math.max(8, (v / max) * 100))}%` }}
        />
      ))}
    </span>
  );
}
