/** Options for the setup page's model, thinking and subagent-model pickers, built from `taro.models.list`. */

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

/** "Default" (empty value; the provider's own, named when known) plus the model's thinking options; a saved value it does not offer stays, marked. */
export function thinkingOptions(models: readonly PickerModel[], modelId: string, saved: string): PickerOption[] {
  const model = models.find((candidate) => candidate.id === modelId);
  const offered = model?.thinkingOptions ?? [];
  const defaultLabel = model !== undefined && model.defaultThinking !== "" ? `Default (${model.defaultThinking})` : "Default";
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

/** Adds or removes one subagent model, keeping the list's order. */
export function toggleSubagentModel(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((candidate) => candidate !== id) : [...selected, id];
}

export interface ModelGroup {
  /** The provider's name as the labels give it ("Claude"), or the id's provider for an unlisted model. */
  provider: string;
  /** Each option labelled without the provider prefix the group heading already shows. */
  options: PickerOption[];
}

const PROVIDER_SEPARATOR = " · ";

/**
 * The models the subagent picker can still add, grouped by provider in list order: the chosen ones
 * are left out, and a query keeps the models whose label or id contains every word of it.
 */
export function addableModelGroups(options: readonly PickerOption[], selected: readonly string[], query: string): ModelGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "");
  const groups: ModelGroup[] = [];
  // `forEach`, not `for…of`: the `find` closure would capture a loop variable, which Hermes mishandles.
  options.forEach((option) => {
    if (selected.includes(option.value)) return;
    const haystack = `${option.label} ${option.value}`.toLowerCase();
    if (!words.every((word) => haystack.includes(word))) return;
    const separator = option.label.indexOf(PROVIDER_SEPARATOR);
    const provider = separator > 0 ? option.label.slice(0, separator) : (option.value.split("/")[0] ?? option.value);
    const label = separator > 0 ? option.label.slice(separator + PROVIDER_SEPARATOR.length) : option.label;
    const group = groups.find((candidate) => candidate.provider === provider);
    if (group === undefined) groups.push({ provider, options: [{ label, value: option.value }] });
    else group.options.push({ label, value: option.value });
  });
  return groups;
}
