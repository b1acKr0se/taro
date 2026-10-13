/** The manager's suggestions file (decision 39): `- <label> :: <prompt>` per line. Pure. */
export interface Suggestion {
  label: string;
  prompt: string;
}

export function parseSuggestions(text: string): Suggestion[] {
  const withoutNotes = text.replace(/<!--[\s\S]*?-->/g, "");
  const suggestions: Suggestion[] = [];
  for (const line of withoutNotes.split("\n")) {
    const match = /^\s*[-*]\s+(.+?)\s+::\s+(.+?)\s*$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) suggestions.push({ label: match[1], prompt: match[2] });
  }
  return suggestions;
}

export function suggestionKey(suggestion: Suggestion): string {
  return `${suggestion.label}\u0000${suggestion.prompt}`;
}
