# Auditrapport: Migratie naar OpenAI (Versie 2)

**Datum:** 2026-03-14

**Auteur:** Manus AI

## 1. Inleiding

Dit rapport is een update van de eerdere audit en richt zich specifiek op de meest recente wijzigingen (commits en Pull Requests) in de `leaderbot-fb-image-gen` repository. Deze update analyseert hoe de nieuwste aanpassingen de migratie naar OpenAI beïnvloeden.

## 2. Analyse van Recente Wijzigingen

### 2.1. Commit `6e1f0d3`: Adviseer nieuwere OpenAI API

Deze commit introduceert belangrijke configuratie-opties in `.env.example` die de migratie naar modernere OpenAI-modellen ondersteunen:

- **Chat Engine Rollout:** Er zijn variabelen toegevoegd voor een gefaseerde uitrol van de nieuwe chat-engine (`MESSENGER_CHAT_ENGINE`, `MESSENGER_CHAT_CANARY_PERCENT`).
- **Modelkeuze:** `OPENAI_TEXT_MODEL` is nu expliciet aanwezig met de standaardwaarde `gpt-4.1-mini`.
- **Chat Context:** Variabelen voor historie-limieten en TTL zijn toegevoegd, wat essentieel is voor kostenbeheersing en relevantie bij OpenAI-aanroepen.

### 2.2. PR #194: Add in-memory generated images cache

Hoewel de titel spreekt over een cache, bevat de diff van deze PR (gebaseerd op de tests) cruciale wijzigingen voor de OpenAI-migratie:

- **Storage Refactoring:** De applicatie stapt over van het lokaal opslaan van afbeeldingen naar het gebruik van een `storagePut` helper (in `server/storage.ts`). Deze helper maakt gebruik van een 'Forge' storage proxy.
- **Test Validatie:** In `server/imageService.test.ts` wordt nu expliciet getest of de `OpenAiImageGenerator` correct communiceert met `https://api.openai.com/v1/images/edits` en het resultaat vervolgens naar de nieuwe storage-service uploadt.
- **Bestandsnaamgeving:** De gegenereerde bestandsnamen in tests zijn aangepast van een vast patroon (`leaderbot-style-timestamp.jpg`) naar een UUID-gebaseerd patroon (`[0-9a-f-]+\.jpg`), wat wijst op een overgang naar meer robuuste opslagidentificatie.

### 2.3. Commit `d2b1676`: Fix webhook handler import name

Dit is een bugfix die een importfout herstelt (`createWebhookHandlers` in plaats van `createWebhookHandler`). Dit bevestigt dat de herstructurering van de webhook-logica (waarschijnlijk in commit `1d34043`) nu de standaard is.

## 3. Impact op de OpenAI Migratie

De recente wijzigingen hebben de volgende impact:

| Component | Status na recente wijzigingen | Resterende actie voor migratie |
| :--- | :--- | :--- |
| **Configuratie** | Grotendeels voorbereid in `.env.example`. | Activeer `MESSENGER_CHAT_ENGINE=responses` in productie om de nieuwe engine te gebruiken. |
| **Beeldopslag** | Gemigreerd naar een abstracte storage-laag (`storage.ts`). | Geen, dit vergemakkelijkt de migratie omdat lokale schijfbeperkingen vervallen. |
| **Beeldgeneratie** | Tests bevestigen gebruik van OpenAI `images/edits`. | Het model `gpt-image-1` in `imageService.ts` moet nog steeds worden vervangen door een officieel model (`dall-e-2`). |
| **Chat Logica** | Rollout-mechanisme is aanwezig in `chatRollout.ts`. | De `RESPONSES_API_URL` in `messengerResponsesService.ts` wijst nog naar een niet-standaard endpoint. |

## 4. Bijgewerkte Aanbevelingen

Op basis van de laatste 'sweep' zijn de aanbevelingen als volgt verfijnd:

1.  **Valideer de Storage Proxy:** Zorg dat de `BUILT_IN_FORGE_API_URL` in productie correct is geconfigureerd, aangezien de nieuwe beeldgeneratie-flow hier nu hard van afhankelijk is voor het opslaan van resultaten.
2.  **Model-update in Code:** Hoewel de configuratie nu `gpt-4.1-mini` suggereert voor tekst, staat in `imageService.ts` nog steeds het ongeldige model `gpt-image-1`. Dit moet met hoge prioriteit worden gecorrigeerd naar `dall-e-2`.
3.  **Endpoint Correctie:** De `RESPONSES_API_URL` in `messengerResponsesService.ts` moet worden gewijzigd naar de standaard OpenAI Chat Completions endpoint (`https://api.openai.com/v1/chat/completions`) om compatibel te zijn met de officiële API.
4.  **Verwijder Legacy Tests:** De PR #194 heeft al een begin gemaakt met het verwijderen van tests die afhankelijk zijn van lokale `/generated` opslag. Dit moet worden voltooid voor de hele testsuite.

## 5. Conclusie

De repository bevindt zich in een actieve overgangsfase. De infrastructuur voor opslag en de configuratie voor een gefaseerde uitrol van OpenAI-functies zijn nu aanwezig. De laatste kritieke stappen zijn het corrigeren van de specifieke modelnamen en API-endpoints in de broncode om de afhankelijkheid van de 'Forge' proxy volledig te kunnen afbouwen.
