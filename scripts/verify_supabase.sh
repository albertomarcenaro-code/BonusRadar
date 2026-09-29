#!/usr/bin/env bash
# ============================================================
# BonusRadar Italia — verifica end-to-end Supabase
# Uso:  bash scripts/verify_supabase.sh
# Richiede: VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY nell'ambiente
# (il workspace Freebuff le inietta automaticamente da .env.local)
# ============================================================
set -u

B="${VITE_SUPABASE_URL:-}"
K="${VITE_SUPABASE_ANON_KEY:-}"

if [[ -z "$B" || -z "$K" ]]; then
  echo "❌ VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY non impostate"
  exit 1
fi

B="${B%/}" # rimuove eventuale slash finale
TS=$(date +%s)
EMAIL="br.verifica.$TS@gmail.com"
PASS="V3rifica-$TS-Br"
RC=0
AT=""
UID_=""
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

say() { echo "$*"; }
ok()  { echo "  ✅ $*"; }
bad() { RC=1; echo "  ❌ $*"; }
msg() { echo "  ℹ️  $*"; }

# req METHOD PATH [JSON_BODY] [EXTRA_HEADER]  -> stampa lo status HTTP
req() {
  local m=$1 p=$2 d=${3:-} extra=${4:-}
  curl -s --max-time 20 -X "$m" "$B$p" \
    -H "apikey: $K" \
    ${AT:+-H "Authorization: Bearer $AT"} \
    ${d:+-H "Content-Type: application/json"} \
    ${extra:+-H "$extra"} \
    ${d:+-d "$d"} \
    -o "$TMP/out" -w "%{http_code}"
}

json() { node -e "const j=JSON.parse(require('fs').readFileSync('$TMP/out','utf8')); const r=($1); if(r!==undefined){console.log(typeof r==='object'?JSON.stringify(r):r)}" 2>/dev/null; }

say "🧪 BonusRadar — verifica end-to-end Supabase"
say "Progetto: $B"
say "================================================================"

# ---------- 0) raggiungibilità ----------
say ""
say "0) Raggiungibilità REST"
c=$(req GET "/rest/v1/profiles?limit=1")
if [[ "$c" == 200 ]]; then ok "REST raggiungibile (HTTP 200)"; else bad "REST non raggiungibile (HTTP $c)"; exit 1; fi

# ---------- 1) signup test user ----------
say ""
say "1) Signup utente di test ($EMAIL)"
c=$(req POST "/auth/v1/signup" "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
if [[ "$c" == 200 && $(json 'j.access_token && j.user ? "1" : "0"') == "1" ]]; then
  UID_=$(json 'j.user.id')
  AT=$(json 'j.access_token')
  ok "Signup OK con sessione immediata (uid=$UID_)"
else
  msg "Nessuna sessione (HTTP $c). Risposta:"
  head -c 300 "$TMP/out"; echo
  msg "Probabile 'Confirm email' ancora attivo: Dashboard → Authentication → Sign In / Providers → OFF"
  exit 1
fi

# ---------- 2) trigger handle_new_user ----------
say ""
say "2) Trigger handle_new_user → profilo auto-creato"
c=$(req GET "/rest/v1/profiles?id=eq.$UID_&select=full_name,email")
if [[ "$c" == 200 && $(json 'Array.isArray(j) && j.length === 1 ? "1" : "0"') == "1" ]]; then
  ok "Profilo creato dal trigger (email: $(json 'j[0].email'))"
else
  bad "Profilo mancante per uid=$UID_ (HTTP $c)"
fi

# ---------- 3) catalogo bonus ----------
say ""
say "3) Catalogo bonus (attesi 5 seed)"
c=$(req GET "/rest/v1/bonuses?select=id,title&order=title.asc")
if [[ "$c" == 200 ]]; then
  N=$(json 'j.length')
  if [[ "$N" == "5" ]]; then ok "5 bonus seed presenti e leggibili"; else bad "attesi 5 bonus, trovati $N"; fi
  json 'j.forEach(b => console.log("     • " + b.title))'
  BID=$(json 'j[0] ? j[0].id : ""')
  export BID
else
  bad "lettura catalogo fallita (HTTP $c)"
fi

# ---------- 4) scritture per-utente ----------
say ""
say "4) Scritture RLS per-utente"

c=$(req PATCH "/rest/v1/profiles?id=eq.$UID_" '{"full_name":"Utente Verifica","city":"Roma"}')
if [[ "$c" == 204 || "$c" == 200 ]]; then ok "UPDATE profilo (HTTP $c)"; else bad "UPDATE profilo fallito (HTTP $c)"; fi

c=$(req POST "/rest/v1/sources" "{\"user_id\":\"$UID_\",\"name\":\"Sito Verifica\",\"url\":\"https://example.com/verifica-$TS\"}")
if [[ "$c" == 201 ]]; then ok "INSERT fonte (HTTP 201)"; else bad "INSERT fonte fallita (HTTP $c)"; head -c 200 "$TMP/out"; echo; fi

if [[ -n "$BID" ]]; then
  c=$(req POST "/rest/v1/user_bonuses" "{\"user_id\":\"$UID_\",\"bonus_id\":\"$BID\",\"is_favorite\":true}")
  if [[ "$c" == 201 ]]; then ok "INSERT preferito (HTTP 201)"; else bad "INSERT preferito fallita (HTTP $c)"; head -c 200 "$TMP/out"; echo; fi

  c=$(req GET "/rest/v1/user_bonuses?user_id=eq.$UID_&select=bonus_id,is_favorite")
  if [[ "$c" == 200 && $(json 'Array.isArray(j) && j.length === 1 && j[0].bonus_id === process.env.BID ? "1" : "0"') == "1" ]]; then
    ok "Lettura preferiti (1 riga, bonus corretto)"
  else
    bad "lettura preferiti inattesa (HTTP $c)"
  fi
else
  msg "skip preferiti: nessun bonus id disponibile"
fi

c=$(req POST "/rest/v1/questionnaires" "{\"user_id\":\"$UID_\",\"status\":\"completed\",\"answers\":{\"isee\":25000,\"citta\":\"Roma\"}}")
if [[ "$c" == 201 ]]; then ok "INSERT questionario (HTTP 201)"; else bad "INSERT questionario fallita (HTTP $c)"; head -c 200 "$TMP/out"; echo; fi

# ---------- 5) Storage ----------
say ""
say "5) Storage bucket privato 'documents'"
# upload: body testuale, serve una chiamata curl esplicita
c=$(curl -s --max-time 20 -X POST "$B/storage/v1/object/documents/$UID_/verifica/test.txt" \
  -H "apikey: $K" -H "Authorization: Bearer $AT" -H "Content-Type: text/plain" \
  --data-binary "ciao dal test BonusRadar" -o "$TMP/out" -w "%{http_code}")
if [[ "$c" == 200 ]]; then ok "upload (HTTP 200)"; else bad "upload fallito (HTTP $c)"; head -c 200 "$TMP/out"; echo; fi

c=$(req POST "/storage/v1/object/sign/documents/$UID_/verifica/test.txt" '{"expiresIn":120}')
if [[ "$c" == 200 ]]; then
  SURL=$(json 'j.signedURL || ""')
  if [[ -n "$SURL" ]]; then
    dc=$(curl -s -L --max-time 20 -o /dev/null -w "%{http_code}" "$B/storage/v1$SURL")
    if [[ "$dc" == 200 ]]; then ok "download via signed URL (HTTP 200)"; else bad "download fallito (HTTP $dc)"; fi
  else
    bad "signed URL mancante nella risposta"
  fi
else
  bad "creazione signed URL fallita (HTTP $c)"; head -c 200 "$TMP/out"; echo
fi

# ---------- 6) isolamento RLS ----------
say ""
say "6) Isolamento RLS (nessun dato altrui visibile)"
c=$(req GET "/rest/v1/profiles?id=neq.$UID_&limit=1")
if [[ "$c" == 200 && $(json 'Array.isArray(j) && j.length === 0 ? "1" : "0"') == "1" ]]; then
  ok "profili altrui non leggibili"
else
  bad "possibile leak RLS su profiles (HTTP $c)"
fi

# ---------- 7) cleanup ----------
say ""
say "7) Cleanup dati di test"
for x in "user_bonuses?user_id=eq.$UID_" "questionnaires?user_id=eq.$UID_" "sources?user_id=eq.$UID_" "profiles?id=eq.$UID_"; do
  c=$(req DELETE "/rest/v1/$x")
  msg "DELETE $x -> HTTP $c"
done
c=$(curl -s --max-time 20 -X DELETE "$B/storage/v1/object/documents/$UID_/verifica/test.txt" \
  -H "apikey: $K" -H "Authorization: Bearer $AT" -o "$TMP/out" -w "%{http_code}")
msg "DELETE file storage -> HTTP $c"
msg "L'utente auth di test ($EMAIL) resta in Authentication → Users: eliminabile da lì"

# ---------- esito ----------
say ""
say "================================================================"
if [[ "$RC" -eq 0 ]]; then
  say "🎉 TUTTI I TEST PASSATI — puoi riattivare 'Confirm email'"
else
  say "❌ Alcuni test falliti — tieni 'Confirm email' disattivata e rimandami l'output"
fi
exit $RC
