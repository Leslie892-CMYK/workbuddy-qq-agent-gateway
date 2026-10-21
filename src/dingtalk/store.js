import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const defaults = () => ({ version: 1, conversations: {}, campaigns: [], captures: [], preferences: { skipTeachers: [] } });

export class DingTalkStore {
  constructor(file) { this.file = file; this.state = defaults(); this.saving = Promise.resolve(); }
  async load() {
    try { this.state = { ...defaults(), ...JSON.parse(await readFile(this.file, "utf8")) }; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    return this.state;
  }
  async save() {
    const payload = JSON.stringify(this.state, null, 2);
    this.saving = this.saving.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.tmp`;
      await writeFile(temporary, payload, { mode: 0o600 });
      await rename(temporary, this.file);
    });
    return this.saving;
  }
  conversation(id, type = "group") {
    const key = String(id || "").trim();
    if (!key || key.length > 200) throw new Error("会话标识无效");
    if (!this.state.conversations[key]) {
      this.state.conversations[key] = { id: key, type, enabled: false, sharedWith: null,
        permissions: { notifications: false, calendar: false, files: false, stickers: false, home: false },
        messages: [], files: [], summary: "" };
    }
    return this.state.conversations[key];
  }
  addCapture(capture) {
    const chat = this.conversation(capture.conversationId, capture.type);
    const known = new Set(chat.messages.map((item) => item.fingerprint));
    let added = 0;
    for (const message of capture.messages || []) {
      if (!message.text || known.has(message.fingerprint)) continue;
      chat.messages.push(message);
      known.add(message.fingerprint);
      added++;
    }
    chat.messages = chat.messages.slice(-500);
    this.state.captures.unshift({ at: new Date().toISOString(), conversationId: chat.id, added });
    this.state.captures = this.state.captures.slice(0, 100);
    return { chat, added };
  }
  context(id) {
    const chat = this.conversation(id);
    const shared = chat.sharedWith ? this.state.conversations[chat.sharedWith] : null;
    const reverse = Object.values(this.state.conversations).filter((other) => other.sharedWith === chat.id && other.id !== chat.id);
    return { chat: chat.messages,
      shared: [shared, ...reverse].filter(Boolean).flatMap((other) => other.messages.map((message) => ({ ...message, conversationId: other.id }))),
      summary: chat.summary, sharedSummary: [shared, ...reverse].filter(Boolean).map((other) => other.summary).join("\n") };
  }
}
