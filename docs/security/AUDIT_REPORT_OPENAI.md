# Auditrapport: Migratie naar OpenAI

**Datum:** 2026-03-11

**Auteur:** Manus AI

## 1. Inleiding

Dit rapport bevat een gedetailleerde analyse van de `leaderbot-fb-image-gen` repository met als doel de migratie van de huidige AI-functionaliteiten naar OpenAI-diensten voor te bereiden. De audit richt zich op de identificatie van de huidige AI/LLM-integraties, de analyse van de code en de aanbevelingen voor een succesvolle migratie.

## 2. Samenvatting van de Bevindingen

De repository bevat een applicatie die via Facebook Messenger beelden kan genereren en met gebruikers kan chatten. De huidige implementatie maakt gebruik van een interne 'Forge' API voor beeldgeneratie, tekstgeneratie en spraak-naar-tekst. De code is modulair opgezet, wat een gerichte migratie naar OpenAI mogelijk maakt.

De belangrijkste bevindingen zijn:

| Categorie | Bevinding | Aanbeveling | Prioriteit |
| :--- | :--- | :--- | :--- |
| **Beeldgeneratie** | `OpenAiImageGenerator` in `imageService.ts` gebruikt `https://api.openai.com/v1/images/edits` met een verouderd model (`gpt-image-1`). | Migreer naar `dall-e-3` of `dall-e-2` via de `v1/images/generations` of `v1/images/edits` endpoints. | Hoog |
| **Tekstgeneratie (Chat)** | `messengerResponsesService.ts` gebruikt een `RESPONSES_API_URL` (`https://api.openai.com/v1/responses`) die niet (meer) standaard is voor OpenAI. | Migreer naar de `v1/chat/completions` endpoint met een modern model zoals `gpt-4o` of `gpt-4.1-mini`. | Hoog |
| **Tekstgeneratie (AI SDK)** | `chat.ts` gebruikt `@ai-sdk/openai` en `createOpenAI` om te verbinden met een 'Forge' proxy. Het model is hardcoded als `gpt-4o`. | Pas de `baseURL` in `createLLMProvider` aan naar de officiële OpenAI API-endpoint. | Hoog |
| **Spraak-naar-tekst** | `voiceTranscription.ts` gebruikt een 'Forge' proxy voor transcripties met het `whisper-1` model. | Pas de `fullUrl` aan om rechtstreeks met de OpenAI `v1/audio/transcriptions` endpoint te communiceren. | Medium |
| **Dependencies** | De `@ai-sdk/openai` package is al aanwezig. | Geen nieuwe dependencies nodig voor de kernmigratie. | Laag |
| **Configuratie** | API-sleutels en endpoints worden beheerd via omgevingsvariabelen (`BUILT_IN_FORGE_API_KEY`, `BUILT_IN_FORGE_API_URL`, `OPENAI_API_KEY`). | Centraliseer de OpenAI API-sleutel en maak de base URL configureerbaar. | Medium |

## 3. Gedetailleerde Analyse

### 3.1. Beeldgeneratie (`imageService.ts`)

De `OpenAiImageGenerator` class maakt een `POST` request naar `https://api.openai.com/v1/images/edits`. 

- **Model:** Het model is hardcoded als `gpt-image-1`, wat een niet-bestaand of verouderd model lijkt te zijn. Dit moet worden vervangen door een ondersteund model zoals `dall-e-3` of `dall-e-2`.
- **Endpoint:** Het `images/edits` endpoint wordt gebruikt. Afhankelijk van de gewenste functionaliteit kan ook het `images/generations` endpoint overwogen worden. Voor het aanpassen van een bestaande foto (zoals het hier lijkt te gebeuren) is `edits` correct, maar vereist het uploaden van een `mask` als niet het hele beeld aangepast moet worden.
- **Authenticatie:** De `Authorization` header wordt correct ingesteld met een Bearer token uit `process.env.OPENAI_API_KEY`.

**Aanbeveling:**

1.  Vervang het model `gpt-image-1` door `dall-e-2` (voor edits) of `dall-e-3` (voor generatie).
2.  Controleer de parameters van de API-call. Voor `dall-e-2` edits zijn `image` en `prompt` vereist. Een `mask` is optioneel.
3.  Implementeer foutafhandeling specifiek voor de OpenAI API, inclusief het parsen van de error response body.

### 3.2. Tekstgeneratie (`messengerResponsesService.ts` en `chat.ts`)

Er zijn twee mechanismen voor tekstgeneratie:

1.  **Legacy (`messengerResponsesService.ts`):** Dit systeem gebruikt een `RESPONSES_API_URL` die naar `https://api.openai.com/v1/responses` wijst. Dit is geen standaard OpenAI endpoint. De payload wordt opgebouwd met een system prompt en een geschiedenis van berichten. Het model is `gpt-4.1-mini`.
2.  **AI SDK (`chat.ts`):** Dit systeem gebruikt de Vercel AI SDK (`@ai-sdk/openai`). Het configureert een `createOpenAI` provider die naar een interne 'Forge' proxy (`BUILT_IN_FORGE_API_URL`) wijst. De `createPatchedFetch` functie suggereert dat er problemen waren met de proxy die opgelost moesten worden. Het model is hardcoded als `gpt-4o`.

**Aanbeveling:**

1.  **Consolideer naar één methode.** Het gebruik van de AI SDK (`chat.ts`) is de meest toekomstbestendige aanpak.
2.  Pas de `baseURL` in `createLLMProvider` in `chat.ts` aan van de 'Forge' proxy naar `https://api.openai.com/v1`.
3.  Verwijder de `createPatchedFetch` wrapper, aangezien deze waarschijnlijk niet nodig is bij directe communicatie met de OpenAI API.
4.  Migreer de logica uit `messengerResponsesService.ts` om de AI SDK te gebruiken. De `buildSystemPrompt` en de logica voor het ophalen van de geschiedenis kunnen grotendeels hergebruikt worden.
5.  Centraliseer de modelkeuze (bv. `gpt-4o` of `gpt-4.1-mini`) in een omgevingsvariabele.

### 3.3. Spraak-naar-tekst (`voiceTranscription.ts`)

De `transcribeAudio` functie stuurt audio naar een 'Forge' proxy endpoint dat `v1/audio/transcriptions` heet. Het model is hardcoded als `whisper-1`.

**Aanbeveling:**

1.  Pas de `fullUrl` constructie aan om rechtstreeks naar `https://api.openai.com/v1/audio/transcriptions` te wijzen.
2.  De `Authorization` header gebruikt `ENV.forgeApiKey`. Dit moet worden gewijzigd naar de `OPENAI_API_KEY`.
3.  De rest van de logica, inclusief het voorbereiden van de `FormData`, is compatibel met de OpenAI API en kan behouden blijven.

## 4. Migratieplan

Een gefaseerde aanpak wordt aanbevolen om de risico's te minimaliseren.

| Fase | Taak | Bestanden | Details |
| :--- | :--- | :--- | :--- |
| **1. Configuratie** | Centraliseer OpenAI API-sleutel en -endpoint. | `.env.example`, `server/_core/env.ts` | Voeg `OPENAI_API_BASE_URL` toe en zorg dat alle services `OPENAI_API_KEY` gebruiken. |
| **2. Beeldgeneratie** | Migreer `OpenAiImageGenerator`. | `server/_core/imageService.ts` | Vervang model, controleer endpoint en parameters. Test grondig. |
| **3. Spraak-naar-tekst** | Migreer `transcribeAudio`. | `server/_core/voiceTranscription.ts` | Pas endpoint en authenticatie aan. |
| **4. Tekstgeneratie** | Migreer `chat.ts` en `messengerResponsesService.ts`. | `server/_core/chat.ts`, `server/_core/messengerResponsesService.ts`, `server/_core/webhookHandlers.ts` | Pas `chat.ts` aan om de directe OpenAI API te gebruiken. Refactor `webhookHandlers.ts` om `generateMessengerReply` te vervangen door de AI SDK-gebaseerde chat. |
| **5. Opruimen** | Verwijder ongebruikte code. | `server/_core/patchedFetch.ts`, `server/_core/messengerResponsesService.ts` | Verwijder de 'Forge' proxy-gerelateerde code en de legacy `messengerResponsesService`. |

## 5. Conclusie

De `leaderbot-fb-image-gen` applicatie is goed gestructureerd voor een migratie naar OpenAI. De belangrijkste uitdaging is het vervangen van de 'Forge' proxy door directe API-aanroepen naar OpenAI. Door de aanbevelingen in dit rapport te volgen, kan de migratie efficiënt en met minimale verstoring van de functionaliteit worden uitgevoerd. Het is cruciaal om elke fase grondig te testen.
