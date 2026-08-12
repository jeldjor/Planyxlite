# Planyx-lite v1.0.19

Lichte routeplanner/PWA zonder Supabase.

## Workflow
1. Excel importeren.
2. **Genereer planning** zet afleveringen op de juiste dagen.
3. **Optimaliseer route** zoekt de snelste/logische stopvolgorde voor de gekozen dag.
4. Op telefoon gebruik je het Route-scherm voor navigatie en bezoekstatus.

## Routeherstel v1.0.19
- Oude geocode- en matrixcache wordt eenmalig ongeldig gemaakt.
- TomTom-geocoding gebruikt waar beschikbaar een routing/entrypoint in plaats van alleen het middenpunt van een adres.
- Matrix-aanvragen blijven bewust onder 100 cellen per aanvraag voor betrouwbaardere verwerking.
- Mislukte Matrix-cellen stoppen de optimalisatie niet meer direct.
- Ontbrekende verbindingen worden automatisch opnieuw berekend via de normale TomTom Routing API.
- Alleen als ook die fallback niet lukt, gebruikt de optimizer een zware schatting en controleert daarna altijd de complete eindroute bij TomTom.
- Definitieve routes worden op historische reistijd gecontroleerd, zodat toekomstige planningsdagen niet afhankelijk zijn van toevallig live verkeer op het moment van optimaliseren.

## Importkolommen
`d_name`, `d_phone`, `d_address1`, `d_zipcode`, `d_city`, `d_country`, `delivery_date`
