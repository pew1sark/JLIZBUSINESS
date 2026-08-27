# Carga de ventas enero–mayo 2026

**Fecha:** 26 de agosto de 2026
**Origen:** `Venta 2026 (dany).xlsx` — planilla de ventas que lleva el cliente
**Motivo:** la base solo tenía junio en adelante, porque la importación de Bsale
arranca el 1 de junio. Enero a mayo existía únicamente en la planilla.

No es una migración re-ejecutable: depende de un archivo que no vive en el repo.
Queda acá como registro de qué entró y cómo se validó.

## Qué se cargó

| | |
|---|---|
| Facturas | 1.113 (ene 1 – may 30) |
| Monto facturado | $219.083.976 |
| Cobros | 1.105, con la fecha de pago exacta de la planilla |
| Facturas sin pago | 8 |
| Clientes creados | 10 |

Los 10 clientes son los que dejaron de comprar antes de junio, así que Bsale
nunca los creó: Andina, Bardot, Barrica, Blu, Caleta de Locos, Carloto, Cívico
Moneda, Cuero Vaca (dos RUT distintos) y Lolita. Quedan marcados en `notes`.

## Criterios

- **Cliente:** por RUT, comparando en mayúsculas (la planilla escribe algunos
  dígitos verificadores en minúscula).
- **Neto e IVA:** la planilla los guarda como `total/1,19` con decimales; Bsale
  guarda el neto en pesos enteros. Se reconstruyó a la manera de Bsale
  (`neto = round(total/1,19)`, `iva = total − neto`), que reproduce exactamente
  los 726 documentos que ya estaban cargados.
- **Vencimiento:** emisión + 30 días, el plazo pactado con todos los clientes y
  el mismo criterio de la importación de Bsale.
- **Cobros:** uno por factura, método transferencia, fechado a las 12:00 para que
  el `timestamptz` no corra el día en horario de Chile.

## Excepciones

- **34105** (Europeo, 29-ene): único documento del año cuyo IVA no es el 19% del
  neto — la planilla trae neto 688.500 e IVA 70.934 sobre 759.434. Se respetaron
  las cifras de la planilla en vez de recalcular.
- **34232 y 34973:** la planilla las marca `N.D.C` con total 0 (anuladas por nota
  de crédito). Se cargaron con total 0 para no dejar huecos en la numeración.
- **4 facturas** tienen fecha de pago anterior a la de emisión en la planilla
  (34226, 34282, 34296, 34407). Se cargaron tal cual: corregirlas es decisión del
  cliente, no de la carga.

## Notas de crédito aplicadas

Las 20 notas de crédito estaban cargadas pero sin vincular a su factura y sin
aplicar, así que había facturas anuladas figurando como deuda. Se aplicaron las
11 de calce inequívoco, por $2.431.278:

- **8 anulan la factura completa** — la planilla las marca `N.D.C` con total 0:
  1131→35401, 1134→35413, 1136→35567, 1137→35644, 1138→35646, 1139→35647,
  1140→35680, 1141→35699.
- **3 cubren exactamente el saldo abierto** de una factura parcial:
  1127→35087, 1128→35125, 1129→35199.

Se imputan como un cobro de método `otro` (no entró plata, se descontó con un
documento) y la NC queda con `amount_paid = abs(total)` para que no vuelva a
contarse como crédito disponible.

**Quedan 9 sin aplicar, por $1.464.926** (1126, 1130, 1132, 1133, 1135, 1142,
1143, 1144, 1145): o no calzan por monto con ninguna factura, o calzan con más de
una. Necesitan el respaldo de Bsale para resolverse.

## Validación

Contra la planilla, después de cargar:

| Chequeo | Resultado |
|---|---|
| Filas de la planilla sin factura en la base | 0 |
| Montos distintos | 0 |
| Fechas de emisión distintas | 0 |
| Fechas de pago distintas | 0 |
| `neto + iva <> total` | 0 |
| Pagos sin imputar | 0 |

Totales por mes, planilla contra base: enero $47.107.764 (218), febrero
$27.919.663 (183), marzo $44.270.836 (227), abril $47.057.486 (230), mayo
$52.728.227 (255). Calzan los cinco.
