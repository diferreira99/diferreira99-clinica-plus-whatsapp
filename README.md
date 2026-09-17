# clinica-plus-whatsapp

Servidor WhatsApp (Baileys) dedicado ao **Clínica+**, separado do `prospecta-whatsapp`.

Baseado no servidor do Prospecta+, com dois adicionais:
1. Encaminha toda mensagem recebida (resposta do paciente) pro webhook do n8n
   configurado em `N8N_WEBHOOK_URL`.
2. Quando o WhatsApp entrega a mensagem com um identificador `@lid` (Linked ID)
   em vez do número de telefone — algo que acontece com contatos que ativaram
   uma configuração de privacidade do WhatsApp — o servidor tenta resolver o
   telefone real de duas formas: (a) campos internos do Baileys
   (`remoteJidAlt`/`participantAlt`), e (b) consultando a própria tabela
   `pacientes` no Supabase, caso esse LID já tenha sido vinculado manualmente
   pelo dashboard. Se não achar de nenhuma forma, grava a mensagem em
   `mensagens_nao_identificadas` para vínculo manual pela recepção.

## Variáveis de ambiente (Railway)

| Variável               | Obrigatória | Descrição |
|-------------------------|:-----------:|-----------|
| `API_TOKEN`             | recomendado | Token pra proteger as rotas (`x-api-token` no header) |
| `N8N_WEBHOOK_URL`       | sim         | URL do webhook do n8n que recebe as mensagens de entrada |
| `SUPABASE_URL`          | sim         | URL do projeto Supabase (ex: `https://xxxx.supabase.co`) |
| `SUPABASE_SERVICE_KEY`  | sim         | **service_role key** do Supabase (nunca exponha no front) |
| `CLINICA_ID`            | sim         | UUID da clínica dona desta instância dedicada |
| `PORT`                  | não         | Definida automaticamente pelo Railway |

## Deploy

1. Crie um **novo projeto** no Railway (não um service dentro do projeto do Prospecta+).
2. Conecte este repo via "Deploy from GitHub repo".
3. Adicione um **Volume** montado em `/app/auth_info` (ou o caminho equivalente do build) pra persistir a sessão entre deploys — sem isso a sessão se degrada e reconecta do zero a cada deploy.
4. Configure as env vars acima.
5. Gere um domínio público (Settings > Networking).
6. Acesse `/qr` com o número dedicado da clínica e escaneie IMEDIATAMENTE (o QR expira rápido).

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

## Mensagens não identificadas (LID)

Quando um paciente responde e o WhatsApp expõe só o `@lid` dele (sem telefone
associado que o Baileys consiga resolver), a mensagem some do fluxo automático
e cai na tabela `mensagens_nao_identificadas`. No dashboard do Clínica+, a aba
**Mensagens não identificadas** lista essas ocorrências e permite vincular
manualmente a um paciente cadastrado — a partir daí, esse LID fica salvo em
`pacientes.whatsapp_lid` e o servidor passa a reconhecer automaticamente as
próximas mensagens desse mesmo contato.
