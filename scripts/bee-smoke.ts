import { BeeApiError, createBeeClient } from "../agent/lib/bee/client";

const bee = createBeeClient();

async function count(label: string, fn: () => Promise<number>): Promise<void> {
  try {
    console.log(label, await fn());
  } catch (err) {
    console.log(label, err instanceof BeeApiError ? `HTTP ${err.status}` : String(err));
  }
}

await count("me keys:", async () => (Object.keys(await bee.me()).length));
await count("conversations (page of 10):", async () => (await bee.listConversations({ limit: 10 })).conversations.length);
await count("conversation states:", async () => {
  const { conversations } = await bee.listConversations({ limit: 10 });
  console.log(" ", Object.entries(Object.groupBy(conversations, (c) => c.state)).map(([s, l]) => `${s}=${l?.length}`).join(" "));
  return conversations.length;
});
await count("first conversation utterances:", async () => {
  const { conversations } = await bee.listConversations({ limit: 1 });
  if (!conversations[0]) return 0;
  const { conversation } = await bee.getConversation(conversations[0].id);
  return conversation.transcriptions.reduce((n, t) => n + t.utterances.length, 0);
});
await count("journals:", async () => (await bee.listJournals({ limit: 10 })).journals.length);
await count("todos:", async () => (await bee.listTodos({ limit: 10 })).todos.length);
