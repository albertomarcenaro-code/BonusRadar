# Email transazionali — provider dedicato per Supabase Auth

## Perché

L'SMTP integrato di Supabase (piano free) è in **rate limit**: ne abbiamo avuto la
prova directa con `429 over_email_send_rate_limit` durante i test. Con la conferma
email attiva, gli utenti reali rischiano di non ricevere mai la mail di
registrazione o di reset password.

Tutte le email transazionali dell'app (conferma signup, reset password, magic link)
le invia **Supabase Auth** — l'app non contiene alcun codice di invio. L'integrazione
consiste quindi nel collegare un **provider SMTP dedicato** alle impostazioni SMTP di
Supabase. Nessuna modifica al codice, nessuna chiave nel repo.

## Provider consigliato: Brevo

- Sede UE (Francia) → dati dell'audience italiana/UE residenti in UE
- SMTP relay incluso: `smtp-relay.brevo.com:587`
- Piano free: ~300 email/giorno (largamente sopra il fabbisogno di decine/giorno)
- Autenticazione con **chiave SMTP** dedicata (non la password dell'account)

Alternative: **Postmark** (deliverabilità top, free solo 100/mese),
**Mailgun** (regione EU disponibile), **Elastic Email** (economico).

## Setup (10 minuti, lato dashboard — nessun deploy)

### 1. Brevo
1. Crea l'account su <https://www.brevo.com>.
2. **Impostazioni → SMTP & API → Chiavi SMTP → Genera una nuova chiave SMTP**
   (copiala: non viene più mostrata).
3. **Consigliato per la deliverability**: verifica un dominio mittente
   (es. il dominio del prodotto) in **Impostazioni → Domini → Aggiungi dominio**,
   aggiungendo i record DNS SPF/DKIM richiesti.

### 2. Supabase Dashboard → Project Settings → Authentication → SMTP Settings
Seleziona **Custom SMTP** e compila:

| Campo | Valore |
|---|---|
| Host | `smtp-relay.brevo.com` |
| Port | `587` (STARTTLS) |
| User | il **login SMTP** mostrato da Brevo nella pagina di generazione della chiave (in genere l'email dell'account; Brevo lo indica accanto alla chiave — **non** usare `smtp-relay.brevo.com` come login) |
| Pass | la chiave SMTP generata al passaggio 1.2 |
| Sender email | un indirizzo sul dominio verificato (es. `notifiche@ildominio.it`) |
| Sender name | `BonusRadar` |

Porta alternative se la 587 è bloccata: `465` (SSL) o `2525` (fonte: help.brevo.com).

Salva. Supabase inizia subito a usare il provider dedicato.

### 3. Verifica
1. Registrati con un indirizzo reale su `https://bonusradar.freebuff.app/auth`.
2. Arriva la mail di conferma → clicca il link → login.
3. Se non arriva: Supabase Dashboard → **Authentication → Logs** (invii/rate limit)
   e nella casella **Spam**.

## Note operative

- **Le credenziali SMTP restano solo in Supabase Dashboard**: non metterle nel repo,
  negli env del progetto Freebuff né nella tabella Keys (l'app non le usa).
- Supabase applica comunque i **rate limit di progetto**: se riprevali un
  `429 over_email_send_rate_limit` con SMTP proprio, controlla i log Auth —
  significa che il progetto ha superato la finestra oraria/giornaliera.
- Dopo il collegamento, "Confirm email" può restare attiva (lo è).
