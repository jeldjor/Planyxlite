# Planyx-lite

Lichte PWA-routeplanner zonder Supabase.

## Werkwijze
1. Open de app op laptop.
2. Vul standaard start- en eindadres en TomTom API-key in.
3. Importeer Excel/CSV met minimaal: `d_name`, `d_phone`, `d_address1`, `d_zipcode`, `d_city`, `d_country`, `delivery_date`.
4. Klik **Genereer planning**. De app groepeert per `delivery_date`, geocodeert via TomTom en genereert alle dagen achter elkaar.
5. Klik **Open op telefoon** en scan de QR-code. Als de planning te groot is, gebruik de overdrachtslink of `.planyx`-bestand.
6. Op telefoon: **Navigeren**, **Bezocht**, of **Naar andere dag**.
7. Exporteer op telefoon naar Excel. De export bevat de zeven bronvelden plus `bezocht` (Ja/Nee), waarbij `delivery_date` de uiteindelijke datum is.

## Opslag en privacy
- Geen Supabase, account of backend.
- Planning, TomTom-key en voorkeuren staan in `localStorage` van het apparaat.
- De TomTom-key wordt niet meegestuurd in de QR/overdracht.
- Route-overdracht bevat wel de ingevoerde aflevergegevens; deel QR/link alleen met de chauffeur.

## Hosting
De app is statisch en kan via GitHub Pages/Netlify/Vercel worden gehost. HTTPS is aanbevolen voor PWA-installatie.

## Externe browserbibliotheken
- SheetJS voor Excel import/export.
- qrcode.js voor QR-weergave.
Beide worden via CDN geladen; routegegevens zelf gaan niet via deze bibliotheken naar een backend.


## Naar telefoon
Na het genereren van de routes kies je **Naar telefoon**. Deel de gegenereerde link via de systeemeigen deelknop, WhatsApp of kopieer de link. Op de telefoon opent dezelfde Planyx-lite website en worden alle dagen en routes direct lokaal ingeladen. QR en een `.planyx` overdrachtsbestand blijven beschikbaar als reserveopties.


## v1.0.7
- Knop heet `Optimaliseer route`.
- Navigatie-app blijft per apparaat instelbaar: Google Maps, Waze of Apple Kaarten.
- Nieuwe knop `Hele route` opent waar ondersteund de volledige dagroute in de gekozen navigatie-app. Google Maps ondersteunt tussenstops via Maps URLs; Waze en Apple Maps web-links ondersteunen geen volledige multi-stop overdracht, daarom blijft per-stop navigatie daarvoor leidend.

## v1.0.12
- Eén responsive PWA met twee schermen: `Import / Database` en `Route`.
- Laptop opent standaard `Import / Database`; telefoon opent standaard `Route`.
- Route-scherm toont alleen geplande dagen uit de huidige kalenderweek.
- Dagpijlen blijven binnen die huidige week.
- `Optimaliseer route` gebruikt TomTom opnieuw wanneer een API-key beschikbaar is; lokale optimalisatie is alleen fallback.
- Navigatie-app is per apparaat instelbaar: Google Maps, Waze of Apple Kaarten.
- `Hele route` blijft beschikbaar boven de dagroute; volledige multi-stop overdracht vanuit een webapp is het betrouwbaarst met Google Maps.
- Geen Supabase of andere backend; planning wordt lokaal opgeslagen en via `Naar telefoon` overgedragen.


## v1.0.14
- Correcte TomTom optimizedWaypoints-mapping: sorteren op optimizedIndex en oorspronkelijke stop kiezen via providedIndex.
- Optimalisatie gebruikt routeType=fastest.


## v1.0.15
- `Optimaliseer route` gebruikt niet meer `computeBestOrder` als routeplanner.
- De app vraagt via TomTom Matrix Routing v2 de echte rijtijd tussen alle relevante punten op.
- De stopvolgorde wordt lokaal geoptimaliseerd op totale rijtijd met meerdere startoplossingen, nearest-neighbour, verplaatsen, wisselen en 2-opt.
- Start- en eindadres blijven vast; iedere afleverstop komt exact één keer voor.
- De oorspronkelijke route en de kandidaatroute worden daarna allebei door TomTom als `fastest` autoroute gecontroleerd met verkeer.
- De nieuwe volgorde wordt alleen toegepast als die volgens TomTom daadwerkelijk sneller is (bij gelijke tijd: korter in afstand).
- Geocodecache is vernieuwd en postcode/stad wegen mee bij het kiezen van het beste geocoderesultaat.
- PWA gebruikt voor eigen bestanden network-first en versie-URL's, zodat een GitHub-update niet stilletjes oude JavaScript blijft draaien.
