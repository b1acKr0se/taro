/** Options for the setup page's model, thinking and helper pickers, built from `taro.models.list`. */

export interface PickerModel {
  id: string;
  label: string;
  thinkingOptions: string[];
  defaultThinking: string;
}

export interface PickerOption {
  label: string;
  value: string;
}

const NOT_LISTED = "not listed";

/** Every listed model, plus the saved ones the list lacks (provider down, model removed) so a save never drops them. */
export function modelOptions(models: readonly PickerModel[], saved: readonly string[]): PickerOption[] {
  const listed = models.map((model) => ({ label: model.label, value: model.id }));
  const missing = saved
    .filter((id, index) => id !== "" && saved.indexOf(id) === index && !models.some((model) => model.id === id))
    .map((id) => ({ label: `${id} (${NOT_LISTED})`, value: id }));
  return [...listed, ...missing];
}

/** "Provider default" (empty value) plus the model's thinking options; a saved value it does not offer stays, marked. */
export function thinkingOptions(models: readonly PickerModel[], modelId: string, saved: string): PickerOption[] {
  const model = models.find((candidate) => candidate.id === modelId);
  const offered = model?.thinkingOptions ?? [];
  const defaultLabel = model !== undefined && model.defaultThinking !== "" ? `Provider default (${model.defaultThinking})` : "Provider default";
  const options = [{ label: defaultLabel, value: "" }, ...offered.map((option) => ({ label: option, value: option }))];
  if (saved !== "" && !offered.includes(saved)) options.push({ label: `${saved} (${NOT_LISTED})`, value: saved });
  return options;
}

/** The thinking value to keep after switching models: unchanged if the new model offers it (or is unlisted), else the default. */
export function thinkingAfterModelChange(models: readonly PickerModel[], modelId: string, thinking: string): string {
  const model = models.find((candidate) => candidate.id === modelId);
  if (model === undefined || thinking === "") return thinking;
  return model.thinkingOptions.includes(thinking) ? thinking : "";
}

/** Adds or removes one helper model, keeping the list's order. */
export function toggleHelper(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((candidate) => candidate !== id) : [...selected, id];
}
