# Planyx-lite v1.0.18

Schone lokale PWA-versie van Planyx-lite, zonder Supabase.

## Werkwijze
1. Open **Import / Database** op de laptop.
2. Vul startadres, eindadres en TomTom API-key in.
3. Importeer Excel met: `d_name`, `d_phone`, `d_address1`, `d_zipcode`, `d_city`, `d_country`, `delivery_date`.
4. Klik **Genereer planning**.
5. Open **Route** en klik per dag **Optimaliseer route**.
6. Stuur de planning via **Naar telefoon** naar iPhone/Android.
7. Gebruik onderweg Route, Navigeren, Bellen en Bezocht.
8. Exporteer het resultaat naar Excel wanneer nodig.

## Schoonmaak v1.0.18
- oud ongebruikt `planyx-brand.jpeg` verwijderd;
- oude `Installeer app`-knop en bijbehorende JavaScript verwijderd;
- splash gebruikt uitsluitend `assets/gj-motion-logo.png`;
- splashlogo heeft een nieuwe bestandsnaam én versieparameter zodat een oud logo niet kan blijven hangen;
- service worker verwijderd alle eerdere `planyx-lite-*` caches bij activatie;
- HTML wordt network-first geladen zodat nieuwe GitHub-deployments direct worden opgepakt;
- app controleert bij openen actief op een nieuwe service worker;
- dubbele/oude changelogregels verwijderd.

De PWA blijft installeerbaar via de browser zelf (bijvoorbeeld **Zet op beginscherm** op iPhone of **App installeren** in Chrome), maar Planyx-lite toont daarvoor geen eigen knop meer.
