// ---------- Resolve o JID "de verdade" (telefone) mesmo quando vem como @lid ----------
// Em alguns casos o WhatsApp manda o remoteJid como "xxxxx@lid" (Linked ID) em vez do
// número de telefone (...@s.whatsapp.net). O Baileys 6.7+ costuma trazer o JID real
// em key.remoteJidAlt (ou key.participantAlt em mensagens dentro de grupo/contexto).
function resolveRealJid(msg) {
  const jid = msg.key.remoteJid;
  if (jid && jid.endsWith('@lid')) {
    return msg.key.remoteJidAlt || msg.key.participantAlt || jid;
  }
  return jid;
}

// ---------- Mensagens recebidas: encaminha pro n8n ----------
sock.ev.on('messages.upsert', async ({ messages, type }) => {
  if (type !== 'notify') return;
  for (const msg of messages) {
    if (!msg.message || msg.key.fromMe) continue; // ignora as que o próprio bot mandou

    const jid = resolveRealJid(msg);
    if (!jid || jid.endsWith('@g.us')) continue; // ignora grupos por enquanto

    if (jid.endsWith('@lid')) {
      // Não veio remoteJidAlt/participantAlt — não temos como saber o telefone real.
      // Loga pra você identificar esses casos e decidir depois (ex: pedir o número
      // por outro canal, ou tratar handshake inicial diferente).
      console.warn('[Baileys] Mensagem recebida com @lid sem JID real disponível:', JSON.stringify(msg.key));
      continue;
    }

    const texto =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.buttonsResponseMessage?.selectedDisplayText ||
      msg.message.listResponseMessage?.title ||
      '';

    await forwardToN8n({
      phone: jidToPhone(jid),
      jid,
      message: texto,
      timestamp: msg.messageTimestamp,
      raw_type: Object.keys(msg.message)[0],
    });
  }
});
