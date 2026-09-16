# clinica-plus-whatsapp

Servidor WhatsApp (Baileys) dedicado ao **Clínica+**, separado do `prospecta-whatsapp`.

Baseado no servidor do Prospecta+, com um adicional: encaminha toda mensagem
recebida (resposta do paciente) pro webhook do n8n configurado em
`N8N_WEBHOOK_URL`.

## Variáveis de ambiente (Railway)

| Variável          | Obrigatória | Descrição |
|-------------------|:-----------:|-----------|
| `API_TOKEN`       | recomendado | Token pra proteger as rotas (`x-api-token` no header) |
| `N8N_WEBHOOK_URL` | sim         | URL do webhook do n8n que recebe as mensagens de entrada |
| `PORT`            | não         | Definida automaticamente pelo Railway |

## Deploy

1. Crie um **novo projeto** no Railway (não um service dentro do projeto do Prospecta+).
2. Conecte este repo via "Deploy from GitHub repo".
3. Adicione um **Volume** montado em `/app/auth_info` (ou o caminho equivalente do build) pra persistir a sessão entre deploys.
4. Configure as env vars acima.
5. Gere um domínio público (Settings > Networking).
6. Acesse `/qr` com o número dedicado da clínica e escaneie.

## Rotas

- `GET /qr` — QR code pra conectar
- `POST /pairing-code` — código de pareamento alternativo (`{ phone }`)
- `GET /status` — `{ connected: true/false }`
- `POST /send-message` — `{ phone, message }`
- `POST /check-number` — `{ phone }` → `{ exists }`
- Mensagens recebidas são enviadas automaticamente via POST para `N8N_WEBHOOK_URL`:
  ```json
  { "phone": "5511999999999", "jid": "...", "message": "Sim", "timestamp": 123, "raw_type": "conversation" }
  ```
