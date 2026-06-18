export function getEvaluationCycle(date = new Date()) {
  const d = new Date(date);
  const day = d.getDate();
  const start =
    day >= 26
      ? new Date(d.getFullYear(), d.getMonth(), 26)
      : new Date(d.getFullYear(), d.getMonth() - 1, 26);
  const end =
    day >= 26
      ? new Date(d.getFullYear(), d.getMonth() + 1, 25, 23, 59, 59)
      : new Date(d.getFullYear(), d.getMonth(), 25, 23, 59, 59);
  return {
    start,
    end,
    label: `${start.toLocaleDateString('ar-EG')} - ${end.toLocaleDateString('ar-EG')}`,
  };
}

export const getEvalCycle = getEvaluationCycle;
