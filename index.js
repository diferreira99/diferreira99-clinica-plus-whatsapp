/**
 * Servidor WhatsApp gratuito (Baileys) — instância dedicada do Clínica+
 * (baseado no prospecta-whatsapp, com listener de mensagens recebidas
 * encaminhando pro n8n)
 *
 * Rotas:
 *   GET  /qr              -> mostra o QR code para conectar o WhatsApp (escanear 1x)
 *   POST /pairing-code    -> { phone } -> código de pareamento (alternativa ao QR)
 *   GET  /status          -> { connected: true/false }
 *   POST /send-message    -> { phone: "5511999999999", message: "texto" }
 *   POST /check-number    -> { phone: "5511999999999" } -> { exists: true/false }
 *
 * Variáveis de ambiente:
 *   API_TOKEN        -> token simples para proteger as rotas (defina no Railway)
 *   PORT             -> porta (Railway define automaticamente)
 *   N8N_WEBHOOK_URL  -> URL do webhook n8n do Clínica+ que recebe as mensagens
 *                       que chegam no WhatsApp (resposta do paciente, etc)
 */

const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_TOKEN = process.env.API_TOKEN || ''; // se vazio, roda sem checagem (defina em produção!)
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || '';
const AUTH_FOLDER = path.join(__dirname, 'auth_info');

let sock = null;
let latestQR = null;
let isConnected = false;

// ---------- Middleware simples de autenticação por token ----------
function checkAuth(req, res, next) {
  if (!API_TOKEN) return next(); // sem token configurado = sem checagem (defina API_TOKEN!)
  const token = req.headers['x-api-token'] || req.query.token;
  if (token !== API_TOKEN) {
    return res.status(401).json({ error: 'Token inválido. Envie o header x-api-token.' });
  }
  next();
}

// ---------- Utilitário: normaliza telefone BR para o formato do WhatsApp ----------
function toWhatsAppJid(rawPhone) {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits) return null;
  const withCountry = digits.startsWith('55') ? digits : `55${digits}`;
  return `${withCountry}@s.whatsapp.net`;
}

function jidToPhone(jid) {
  return String(jid || '').split('@')[0];
}

// ---------- Encaminha mensagem recebida pro n8n ----------
async function forwardToN8n(payload) {
  if (!N8N_WEBHOOK_URL) return; // sem webhook configurado, ignora
  try {
    const res = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error('[n8n] Webhook respondeu com status', res.status);
    }
  } catch (err) {
    console.error('[n8n] Erro ao encaminhar mensagem:', err.message || err);
  }
}

// ---------- Conexão com o WhatsApp ----------
async function startSock() {
  if (!fs.existsSync(AUTH_FOLDER)) fs.mkdirSync(AUTH_FOLDER, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();
  console.log('[Baileys] Usando versão do protocolo WA:', version);

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      latestQR = qr;
    }

    if (connection === 'open') {
      isConnected = true;
      latestQR = null;
      console.log('[Baileys] Conectado ao WhatsApp com sucesso.');
    }

    if (connection === 'close') {
      isConnected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('[Baileys] Conexão fechada. Código:', statusCode, '| Motivo:', lastDisconnect?.error?.message || 'desconhecido', '| Reconectar?', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(() => startSock(), 2000);
      } else {
        console.log('[Baileys] Sessão deslogada. Apague a pasta auth_info e escaneie o QR novamente.');
      }
    }
  });

  // ---------- Mensagens recebidas: encaminha pro n8n ----------
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue; // ignora as que o próprio bot mandou
      const jid = msg.key.remoteJid;
      if (!jid || jid.endsWith('@g.us')) continue; // ignora grupos por enquanto

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
}

startSock().catch((err) => {
  console.error('[Baileys] Erro ao iniciar:', err);
});

// ---------- Rotas ----------

app.post('/pairing-code', checkAuth, async (req, res) => {
  if (isConnected) {
    return res.json({ connected: true });
  }
  if (!sock) {
    return res.status(503).json({ error: 'Servidor ainda inicializando, tente novamente em alguns segundos.' });
  }
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ error: 'Envie "phone" (com DDI, ex: 5511999999999) no corpo da requisição.' });
  }
  try {
    const digits = String(phone).replace(/\D/g, '');
    const code = await sock.requestPairingCode(digits);
    res.json({ code });
  } catch (err) {
    console.error('[Baileys] Erro ao gerar código de pareamento:', err);
    res.status(500).json({ error: err.message || 'Erro ao gerar código de pareamento.' });
  }
});

app.get('/qr', checkAuth, async (req, res) => {
  if (isConnected) {
    return res.send('<h2>✅ Já está conectado ao WhatsApp.</h2>');
  }
  if (!latestQR) {
    return res.send('<h2>Aguardando QR code... recarregue em alguns segundos.</h2>');
  }
  const qrImage = await qrcode.toDataURL(latestQR);
  res.send(`
    <html>
      <body style="display:flex;flex-direction:column;align-items:center;font-family:sans-serif;">
        <h2>Escaneie com o WhatsApp (Dispositivos Vinculados)</h2>
        <img src="${qrImage}" style="width:300px;height:300px;" />
        <p>Esta página atualiza sozinha a cada 5s.</p>
        <script>setTimeout(()=>location.reload(), 5000)</script>
      </body>
    </html>
  `);
});

app.get('/status', checkAuth, (req, res) => {
  res.json({ connected: isConnected });
});

app.get('/qr-image', checkAuth, async (req, res) => {
  if (isConnected) {
    return res.json({ connected: true });
  }
  if (!latestQR) {
    return res.json({ connected: false, qr: null });
  }
  const qrImage = await qrcode.toDataURL(latestQR);
  res.json({ connected: false, qr: qrImage });
});

app.post('/send-message', checkAuth, async (req, res) => {
  try {
    if (!isConnected || !sock) {
      return res.status(503).json({ error: 'WhatsApp não conectado ainda. Acesse /qr para conectar.' });
    }
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ error: 'Envie "phone" e "message" no corpo da requisição.' });
    }
    const jid = toWhatsAppJid(phone);
    if (!jid) {
      return res.status(400).json({ error: 'Número de telefone inválido.' });
    }

    await sock.sendMessage(jid, { text: message });
    res.json({ success: true, phone, jid });
  } catch (err) {
    console.error('[send-message] erro:', err);
    res.status(500).json({ error: err.message || 'Erro ao enviar mensagem.' });
  }
});

app.post('/check-number', checkAuth, async (req, res) => {
  try {
    if (!isConnected || !sock) {
      return res.status(503).json({ error: 'WhatsApp não conectado ainda.' });
    }
    const { phone } = req.body;
    const jid = toWhatsAppJid(phone);
    if (!jid) {
      return res.status(400).json({ error: 'Número de telefone inválido.' });
    }
    const [result] = await sock.onWhatsApp(jid);
    res.json({ phone, exists: !!(result && result.exists) });
  } catch (err) {
    console.error('[check-number] erro:', err);
    res.status(500).json({ error: err.message || 'Erro ao verificar número.' });
  }
});

app.get('/', (req, res) => {
  res.send('Servidor WhatsApp (Baileys) — Clínica+ — rodando. Acesse /qr para conectar.');
});

app.listen(PORT, () => {
  console.log(`[Baileys] Servidor Clínica+ rodando na porta ${PORT}`);
});
