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

/** The message id prefix of everything the plugin itself sends to an agent (nudges, reports, reloads); the user's own ids never carry it. */
export const PLUGIN_MESSAGE_PREFIX = "taro-";

/** The id prefix of the user's own answers the plugin relays from a decision card: supervision treats them as the plugin's, the chat shows them as the user's. */
export const USER_ANSWER_PREFIX = `${PLUGIN_MESSAGE_PREFIX}answer-`;

/** The sender a plugin-delivered message shows under. */
export const PLUGIN_SENDER = "Plugin";

/** A user message the plugin sent, recognised by its message id, as a received message from the plugin; null for the user's own. */
export function pluginMessage(item: { type: string; text?: string; clientMessageId?: string }): { sender: string; text: string } | null {
  if (item.type !== "user_message" || !item.clientMessageId?.startsWith(PLUGIN_MESSAGE_PREFIX) || item.clientMessageId.startsWith(USER_ANSWER_PREFIX)) return null;
  const text = item.text?.trim() ?? "";
  return text === "" ? null : { sender: PLUGIN_SENDER, text };
}
