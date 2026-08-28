export const BACK = Symbol("back");

export async function walkSelections(steps) {
  const values = {};
  let index = 0;

  while (index < steps.length) {
    const step = steps[index];
    const value = await step.select(values);
    if (value === BACK) {
      delete values[step.key];
      if (index === 0) return BACK;
      index -= 1;
      delete values[steps[index].key];
      continue;
    }
    values[step.key] = value;
    index += 1;
  }

  return values;
}
