/** The reader may contain only host replies while notification emails carry
 * the guest's side. Use the same merge in the inbox and the AI prompt. */
type Message = { body: string; at: string; outbound: boolean };

export function cleanGuestMessage(body: string) {
  return body.replace(/^[^\n]+ has sent you a message about[^\n]*\n/i, "").trim();
}

export function mergeGuestConversation<T extends Message>(
  recorded: T[],
  emails: T[],
  mergeDuplicate: (recorded: T, email: T) => T = (recorded) => recorded,
): T[] {
  const merged = recorded.map(message => ({ ...message, body: cleanGuestMessage(message.body) }));
  for (const email of emails) {
    const body = cleanGuestMessage(email.body);
    const key = body.replace(/\s+/g, " ");
    const index = merged.findIndex(message => !message.outbound &&
      message.body.replace(/\s+/g, " ") === key &&
      Math.abs(+new Date(message.at) - +new Date(email.at)) <= 10 * 60_000);
    if (index < 0) merged.push({ ...email, body });
    else merged[index] = mergeDuplicate(merged[index], { ...email, body });
  }
  return merged.sort((a,b) => +new Date(a.at) - +new Date(b.at));
}
