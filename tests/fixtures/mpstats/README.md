# MPStats fixtures

Fixtures in this directory are split into two groups:

- `*.sample.json` in this directory are synthetic fixtures based on documented fields and likely field variants.
- `live/*.live.sample.json` are sanitized live MPStats fixtures captured on 2026-07-03 through the server-side MPStats integration layer.

Real MPStats responses can contain seller names, product names, IDs, commercial metrics, and other account-specific data. Do not commit live MPStats responses without sanitizing:

- remove or replace seller/product names that should not be public;
- remove raw links if they identify a private check;
- keep only fields needed by normalizer tests;
- never include `MPSTATS_TOKEN`, request headers, cookies, or raw authorization data.

Current sanitized live coverage:

- WB `items/{id}/full`
- WB `seller/by_date`
- WB `seller/price_segmentation`
- Ozon `items/{id}/full`
- Ozon `seller/by_date`
- Ozon `seller/price_segmentation`
- Ozon `seller/geography`

WB `seller/warehouses`, WB `seller/subjects`, and Ozon `seller/niches` were not stored as live fixtures because the checked requests did not return usable live payloads.
