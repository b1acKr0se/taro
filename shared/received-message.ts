/** The sender and words of a message another agent sent (a tool call carrying `agentMessage`), or null for any other item. */
export function receivedMessage(item: { type: string }): { sender: string; text: string } | null {
  if (item.type !== "tool_call") return null;
  const message: unknown = Reflect.get(item, "agentMessage");
  if (typeof message !== "object" || message === null) return null;
  const text: unknown = Reflect.get(message, "text");
  if (typeof text !== "string" || text.trim() === "") return null;
  const sender: unknown = Reflect.get(message, "sender");
  const title: unknown = typeof sender === "object" && sender !== null ? Reflect.get(sender, "title") : undefined;
  return { sender: typeof title === "string" && title.trim() !== "" ? title.trim() : "another agent", text: text.trim() };
}
