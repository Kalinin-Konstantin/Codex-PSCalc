# MPStats Support Diagnostics

Generated at: `2026-07-06T07:41:56.029Z`
Report period: `2026-06-06` – `2026-07-06`

## Summary

Works:

- WB seller/by_date
- WB seller/price_segmentation
- Ozon seller/by_date
- Ozon seller/price_segmentation
- Ozon seller/geography

Does not work:

- WB seller/warehouses (422)
- WB seller/subjects (422)
- Ozon seller/niches (422)

## Source Products

| Marketplace | Product ID | Seller ID | Seller Name |
| --- | ---: | ---: | --- |
| WB | 898788449 | 4345380 | ООО АЙ ЭЙЧ ПИ Апплаенсес |
| Ozon | 4655965383 | 2490713 | Официальный магазин Hotpoint |

## WB seller/warehouses

### Successful chain before failing endpoint

```text
GET items/898788449/full
↓
HTTP 200
↓
seller.id = 4345380
↓
seller.name = ООО АЙ ЭЙЧ ПИ Апплаенсес
↓
POST seller/warehouses
↓
HTTP 422
```

### Request

- HTTP Method: `POST`
- Endpoint: `https://mpstats.io/api/analytics/v1/wb/seller/warehouses`
- Full Request URL: `https://mpstats.io/api/analytics/v1/wb/seller/warehouses?path=4345380&d1=2026-06-06&d2=2026-07-06&fbs=1`
- Full Query String: `path=4345380&d1=2026-06-06&d2=2026-07-06&fbs=1`

Request Headers:

```json
{
  "X-Mpstats-TOKEN": "**************",
  "Content-Type": "application/json",
  "Accept": "application/json, text/plain, */*"
}
```

Request Body:

```json
<no request body>
```

### Response

- HTTP Status: `422`

Response Headers:

```json
{
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "X-Mpstats-TOKEN, Content-Type, Accept, Origin",
  "access-control-allow-methods": "GET, POST, PUT, OPTIONS, PATCH, DELETE",
  "access-control-allow-origin": "https://mpstats.io",
  "connection": "keep-alive",
  "content-length": "423",
  "content-type": "application/json",
  "date": "Mon, 06 Jul 2026 07:41:54 GMT",
  "keep-alive": "timeout=15",
  "server": "QRATOR",
  "x-api-host-version": "18e16a891cd8159a60a4fa29c175114c"
}
```

Diagnostic IDs:

```json
{}
```

Response Body:

```json
{
  "message": "Значение поля d2 должно быть датой до 2026-07-06.",
  "errors": {
    "d2": [
      "Значение поля d2 должно быть датой до 2026-07-06."
    ]
  }
}
```

## WB seller/subjects

### Successful chain before failing endpoint

```text
GET items/898788449/full
↓
HTTP 200
↓
seller.id = 4345380
↓
seller.name = ООО АЙ ЭЙЧ ПИ Апплаенсес
↓
POST seller/subjects
↓
HTTP 422
```

### Request

- HTTP Method: `POST`
- Endpoint: `https://mpstats.io/api/analytics/v1/wb/seller/subjects`
- Full Request URL: `https://mpstats.io/api/analytics/v1/wb/seller/subjects?path=4345380&d1=2026-06-06&d2=2026-07-06&fbs=1`
- Full Query String: `path=4345380&d1=2026-06-06&d2=2026-07-06&fbs=1`

Request Headers:

```json
{
  "X-Mpstats-TOKEN": "**************",
  "Content-Type": "application/json",
  "Accept": "application/json, text/plain, */*"
}
```

Request Body:

```json
<no request body>
```

### Response

- HTTP Status: `422`

Response Headers:

```json
{
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "X-Mpstats-TOKEN, Content-Type, Accept, Origin",
  "access-control-allow-methods": "GET, POST, PUT, OPTIONS, PATCH, DELETE",
  "access-control-allow-origin": "https://mpstats.io",
  "connection": "keep-alive",
  "content-length": "423",
  "content-type": "application/json",
  "date": "Mon, 06 Jul 2026 07:41:55 GMT",
  "keep-alive": "timeout=15",
  "server": "QRATOR",
  "x-api-host-version": "18e16a891cd8159a60a4fa29c175114c"
}
```

Diagnostic IDs:

```json
{}
```

Response Body:

```json
{
  "message": "Значение поля d2 должно быть датой до 2026-07-06.",
  "errors": {
    "d2": [
      "Значение поля d2 должно быть датой до 2026-07-06."
    ]
  }
}
```

## Ozon seller/niches

### Successful chain before failing endpoint

```text
GET items/4655965383/full
↓
HTTP 200
↓
seller.id = 2490713
↓
seller.name = Официальный магазин Hotpoint
↓
POST seller/niches
↓
HTTP 422
```

### Request

- HTTP Method: `POST`
- Endpoint: `https://mpstats.io/api/analytics/v1/oz/seller/niches`
- Full Request URL: `https://mpstats.io/api/analytics/v1/oz/seller/niches?path=2490713&d1=2026-06-06&d2=2026-07-06&fbs=1`
- Full Query String: `path=2490713&d1=2026-06-06&d2=2026-07-06&fbs=1`

Request Headers:

```json
{
  "X-Mpstats-TOKEN": "**************",
  "Content-Type": "application/json",
  "Accept": "application/json, text/plain, */*"
}
```

Request Body:

```json
{
  "startRow": 0,
  "endRow": 100,
  "filterModel": {},
  "sortModel": []
}
```

### Response

- HTTP Status: `422`

Response Headers:

```json
{
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "X-Mpstats-TOKEN, Content-Type, Accept, Origin",
  "access-control-allow-methods": "GET, POST, PUT, OPTIONS, PATCH, DELETE",
  "access-control-allow-origin": "https://mpstats.io",
  "connection": "keep-alive",
  "content-length": "423",
  "content-type": "application/json",
  "date": "Mon, 06 Jul 2026 07:41:55 GMT",
  "keep-alive": "timeout=15",
  "server": "QRATOR",
  "x-api-host-version": "18e16a891cd8159a60a4fa29c175114c"
}
```

Diagnostic IDs:

```json
{}
```

Response Body:

```json
{
  "message": "Значение поля d2 должно быть датой до 2026-07-06.",
  "errors": {
    "d2": [
      "Значение поля d2 должно быть датой до 2026-07-06."
    ]
  }
}
```

## Security Check

- MPStats token value is masked as `**************`.
- No bearer-style auth header is included.
- No cookie header is included.
