type DisplayNameInput = {
  chat: { isGroup: boolean; name: string | null; waChatId: string };
  sender: { name: string | null; pushname: string | null } | null;
};

// For 1:1 chats, ingest.ts resolves an IN message's senderContactId from
// `msg.key.participant || chatWid` — participant is unset outside groups, so
// sender is always the exact same Contact row the chat's own waChatId would
// resolve to. No extra lookup needed; sender already carries the right name.
export function displayName({ chat, sender }: DisplayNameInput): string {
  if (chat.isGroup) return chat.name ?? "Grupo";
  const name = sender?.name ?? sender?.pushname;
  if (name) return name;
  const digits = chat.waChatId.replace(/\D/g, "");
  return `Contato ····${digits.slice(-4) || chat.waChatId.slice(-4)}`;
}
