# Planyx-lite

Lichte PWA-routeplanner zonder Supabase.

## Werkwijze
1. Open de app op laptop.
2. Vul standaard start- en eindadres en TomTom API-key in.
3. Importeer Excel/CSV met minimaal: `d_name`, `d_phone`, `d_address1`, `d_zipcode`, `d_city`, `d_country`, `delivery_date`.
4. Klik **Route(s) genereren**. De app groepeert per `delivery_date`, geocodeert via TomTom en optimaliseert lokaal de volgorde.
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
