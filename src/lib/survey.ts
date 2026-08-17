// GENERADO DESDE docs/Levantamiento_Cliente_JLIZ.xlsx — no editar a mano.
// Para regenerar: python3 scripts/survey_from_xlsx.py

export interface SurveyQuestion {
  id: string
  q: string
  why: string
  example: string
  priority: string
}

export interface SurveyBlock {
  title: string
  questions: SurveyQuestion[]
}

export interface SurveySection {
  key: string
  title: string
  short: string
  intro: string
  blocks: SurveyBlock[]
}

export const SURVEY: SurveySection[] = [
  {
    "key": "A",
    "title": "A · EL NEGOCIO Y SU OPERACIÓN",
    "short": "A. Negocio",
    "intro": "Contexto general. Estas respuestas configuran los datos de la empresa, los horarios de corte y el tamaño real de la operación.",
    "blocks": [
      {
        "title": "Identificación de la empresa",
        "questions": [
          {
            "id": "A1",
            "q": "Razón social completa y nombre de fantasía",
            "why": "Encabezado de documentos y configuración del sistema",
            "example": "Distribuidora JLIZ Ltda. / JLIZ Pescados",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "A2",
            "q": "RUT de la empresa",
            "why": "Documentos y futura facturación electrónica",
            "example": "76.123.456-7",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "A3",
            "q": "Dirección, comuna y región de la bodega principal",
            "why": "Origen de las rutas de reparto",
            "example": "Av. Lo Espejo 0200, Lo Espejo, RM",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "A4",
            "q": "Teléfono, WhatsApp y correo del negocio",
            "why": "Contacto en documentos y avisos",
            "example": "+56 9 1234 5678 / contacto@jliz.cl",
            "priority": "Fase 2"
          },
          {
            "id": "A5",
            "q": "¿Tiene más de un local, bodega o punto de venta?",
            "why": "Define si hay que manejar ubicaciones o sucursales separadas",
            "example": "Solo una bodega con 3 cámaras",
            "priority": "Fase 2 · bloqueante"
          }
        ]
      },
      {
        "title": "Ritmo de la operación",
        "questions": [
          {
            "id": "A6",
            "q": "¿A qué hora llega la mercadería y a qué hora sale el reparto?",
            "why": "Define el horario de corte de pedidos y las alertas del día",
            "example": "Llega 05:00, reparto sale 08:30",
            "priority": "Fase 3"
          },
          {
            "id": "A7",
            "q": "¿Hasta qué hora recibe pedidos para despachar al día siguiente?",
            "why": "Corte automático de pedidos y aviso a los clientes",
            "example": "Hasta las 19:00 del día anterior",
            "priority": "Fase 3"
          },
          {
            "id": "A8",
            "q": "¿Cuántos pedidos atiende en un día normal? ¿Y en el día más cargado del año?",
            "why": "Dimensiona el tablero de pedidos y el rendimiento necesario",
            "example": "25 normales, 90 en Semana Santa",
            "priority": "Fase 3"
          },
          {
            "id": "A9",
            "q": "¿Cuántos kilos mueve al mes aproximadamente?",
            "why": "Dimensiona inventario y reportes",
            "example": "18.000 kg",
            "priority": "Fase 2"
          },
          {
            "id": "A10",
            "q": "¿Qué días de la semana opera? ¿Hay temporadas altas y bajas?",
            "why": "Reportes comparativos y proyección de demanda",
            "example": "Lunes a sábado. Peak: Semana Santa, 18 y fin de año",
            "priority": "Fase 5"
          },
          {
            "id": "A11",
            "q": "¿Cómo se llaman las cámaras o zonas de almacenamiento? Nómbrelas todas",
            "why": "Cada lote se guarda con su ubicación real",
            "example": "Cámara fresco 1, Cámara congelado, Antesala",
            "priority": "Fase 2 · bloqueante"
          }
        ]
      },
      {
        "title": "Cómo se trabaja hoy",
        "questions": [
          {
            "id": "A12",
            "q": "¿Con qué lleva hoy el control? (cuaderno, Excel, WhatsApp, otro sistema)",
            "why": "Define qué se migra y qué hábitos hay que respetar",
            "example": "Cuaderno + Excel de precios + WhatsApp",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "A13",
            "q": "Si usa un sistema o Excel, ¿puede enviarnos una copia?",
            "why": "Permite cargar el catálogo y los clientes reales de una vez",
            "example": "Sí, planilla de precios y lista de clientes",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "A14",
            "q": "¿Cuáles son hoy los 3 problemas que más plata o tiempo le cuestan?",
            "why": "Define qué se prioriza en las siguientes fases",
            "example": "No sé cuánto stock tengo; me equivoco al cobrar; no sé quién me debe",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "A15",
            "q": "¿Qué información necesita ver sí o sí todas las mañanas?",
            "why": "Define el tablero principal",
            "example": "Qué tengo que despachar hoy y cuánto stock queda",
            "priority": "Fase 2"
          },
          {
            "id": "A16",
            "q": "¿Cuántos celulares/tablets hay disponibles para el personal? ¿Android o iPhone?",
            "why": "Define el diseño de la interfaz de terreno",
            "example": "3 Android en bodega, repartidores usan el suyo",
            "priority": "Fase 4"
          },
          {
            "id": "A17",
            "q": "¿Hay señal de internet en bodega y en las rutas de reparto?",
            "why": "Define si se necesita trabajo sin conexión (offline)",
            "example": "En bodega sí, en ruta a veces se corta",
            "priority": "Fase 7"
          },
          {
            "id": "A18",
            "q": "¿Qué balanza usan? ¿Tiene salida de datos o imprime etiqueta?",
            "why": "Define si el peso se puede capturar automáticamente",
            "example": "Balanza digital 300 kg sin conexión",
            "priority": "Fase 4"
          },
          {
            "id": "A19",
            "q": "¿Tiene impresora térmica o de etiquetas? ¿Qué tamaño?",
            "why": "Define impresión de comprobantes y etiquetas de bulto",
            "example": "No / Sí, 80 mm",
            "priority": "Fase 6"
          }
        ]
      }
    ]
  },
  {
    "key": "B",
    "title": "B · PRODUCTOS, UNIDADES Y PRECIOS",
    "short": "B. Productos y precios",
    "intro": "El corazón del sistema. Cómo se mide, se presenta y se cobra cada producto.",
    "blocks": [
      {
        "title": "Cómo se mide y se vende",
        "questions": [
          {
            "id": "B1",
            "q": "¿Todo se vende por kilo, o hay productos por unidad, caja o bandeja?",
            "why": "Define la unidad base de cada producto y todos los cálculos de stock",
            "example": "Pescado por kilo; choritos por malla de 10 kg; ostiones por bandeja",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "B2",
            "q": "Cuando vende una caja o malla, ¿siempre pesa lo mismo o varía?",
            "why": "Define si la caja es unidad fija o se convierte a kilos variables",
            "example": "La malla dice 10 kg pero llega entre 9,5 y 10,5",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "B3",
            "q": "¿Qué presentaciones maneja del mismo pescado? (entero, HG, filete, medallón, trozado)",
            "why": "Cada presentación es un producto distinto con su propio stock y precio",
            "example": "Salmón: entero, filete c/piel, filete s/piel",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "B4",
            "q": "¿Compra entero y procesa en el local (filetea, limpia, trocea)?",
            "why": "Determina si hay que construir el módulo de transformación (un lote entra, otro sale)",
            "example": "Sí, compramos merluza entera y fileteamos",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "B5",
            "q": "Si procesa: ¿cuánto rinde? Ej: 100 kg de entero dan ¿cuántos kg de filete?",
            "why": "Es el cálculo de costo real del producto procesado y de la merma de proceso",
            "example": "100 kg entero → 45 kg filete + 55 kg desecho",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "B6",
            "q": "¿Vende algo que no sea pescado o marisco? (hielo, envases, abarrotes)",
            "why": "Define categorías adicionales del catálogo",
            "example": "Vendemos hielo en bolsa",
            "priority": "Fase 2"
          }
        ]
      },
      {
        "title": "Precios",
        "questions": [
          {
            "id": "B7",
            "q": "¿Los precios que maneja son con IVA incluido o netos?",
            "why": "Afecta TODOS los totales del sistema. Es la decisión más importante de esta hoja",
            "example": "Netos, el IVA se agrega en la factura",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "B8",
            "q": "¿Cada cuánto cambia el precio de venta? ¿Quién lo define?",
            "why": "Define si se necesita precio por día y bitácora de cambios de precio",
            "example": "Semanal, lo define el dueño según lo que costó",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "B9",
            "q": "¿Qué listas de precios usa realmente? Nómbrelas",
            "why": "Se crean las listas y se asignan a cada cliente",
            "example": "Público, Restaurante, Mayorista",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "B10",
            "q": "¿Hace descuento por volumen? ¿Desde cuántos kilos y de cuánto?",
            "why": "Define reglas automáticas de precio",
            "example": "Sobre 100 kg, 5% menos",
            "priority": "Fase 3"
          },
          {
            "id": "B11",
            "q": "¿Se negocia precio caso a caso con algunos clientes?",
            "why": "Define si el vendedor puede editar el precio y si requiere autorización",
            "example": "Sí, con 3 clientes grandes",
            "priority": "Fase 3"
          },
          {
            "id": "B12",
            "q": "¿Redondea los precios? ¿A cuánto?",
            "why": "Formato de precios en el sistema",
            "example": "Siempre a la centena: $8.900",
            "priority": "Fase 2"
          }
        ]
      },
      {
        "title": "Control de stock por producto",
        "questions": [
          {
            "id": "B13",
            "q": "¿Qué productos nunca pueden faltar? ¿Cuál es el mínimo de cada uno?",
            "why": "Configura las alertas automáticas de stock bajo",
            "example": "Merluza nunca bajo 50 kg",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "B14",
            "q": "¿Cuántos días dura cada tipo de producto en cámara?",
            "why": "Configura vencimientos y el orden de salida (lo más antiguo primero)",
            "example": "Fresco 3 días, congelado 6 meses",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "B15",
            "q": "¿Usa códigos internos o SKU para los productos?",
            "why": "Se respetan sus códigos en vez de inventar otros",
            "example": "SAL-01, MER-02",
            "priority": "Fase 2"
          },
          {
            "id": "B16",
            "q": "¿Quiere foto de cada producto en el sistema?",
            "why": "Define si se habilita almacenamiento de imágenes",
            "example": "Sí, ayuda al personal nuevo",
            "priority": "Fase 2"
          }
        ]
      }
    ]
  },
  {
    "key": "C",
    "title": "C · PROVEEDORES, COMPRAS Y RECEPCIÓN",
    "short": "C. Compras",
    "intro": "Cómo entra la mercadería y cómo se calcula lo que realmente costó cada kilo.",
    "blocks": [
      {
        "title": "Proveedores",
        "questions": [
          {
            "id": "C1",
            "q": "¿A cuántos proveedores le compra habitualmente?",
            "why": "Dimensiona el módulo y el comparador de precios",
            "example": "3 fijos y 2 ocasionales",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "C2",
            "q": "¿Le compra a pescadores, caletas o particulares sin factura?",
            "why": "Define si se necesita registro de compra sin documento tributario",
            "example": "Sí, a veces en caleta con boleta de compra",
            "priority": "Fase 2"
          },
          {
            "id": "C3",
            "q": "¿Cómo se acuerda el precio? ¿Fijo, del día, por WhatsApp?",
            "why": "Define si hay que guardar precio pactado por compra",
            "example": "Precio del día por WhatsApp cada mañana",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "C4",
            "q": "¿Le compra a crédito? ¿A cuántos días paga cada proveedor?",
            "why": "Configura las cuentas por pagar",
            "example": "Chiloé a 15 días, el resto contado",
            "priority": "Fase 5"
          },
          {
            "id": "C5",
            "q": "¿Da anticipos o paga por adelantado?",
            "why": "Define manejo de anticipos a proveedor",
            "example": "Sí, 50% al pedir",
            "priority": "Fase 5"
          }
        ]
      },
      {
        "title": "Recepción de la mercadería",
        "questions": [
          {
            "id": "C6",
            "q": "¿Quién recibe y pesa la mercadería que llega?",
            "why": "Define el rol y la responsabilidad en la trazabilidad",
            "example": "El jefe de bodega",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "C7",
            "q": "¿El peso que llega coincide con el de la guía o factura? ¿Cuánta diferencia es normal?",
            "why": "Define el registro de diferencia de peso en recepción",
            "example": "Casi siempre llega 1 o 2 kg menos",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "C8",
            "q": "¿Paga flete aparte? ¿Camión propio o de terceros? ¿Cuánto cuesta en promedio?",
            "why": "El flete se prorratea al costo por kilo de cada producto",
            "example": "Flete externo, $45.000 por viaje",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "C9",
            "q": "¿Qué otros costos tiene una compra? (hielo, cajas, comisiones, peajes)",
            "why": "Se suman al costo real del kilo",
            "example": "Hielo $12.000 por viaje",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "C10",
            "q": "¿Qué datos DEBE quedar registrados de cada recepción?",
            "why": "Define los campos obligatorios del lote",
            "example": "Origen, fecha de captura, temperatura, proveedor",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "C11",
            "q": "¿Mide y registra temperatura al recibir?",
            "why": "Define si se agrega control de cadena de frío",
            "example": "Sí, con termómetro de punzón",
            "priority": "Fase 6"
          },
          {
            "id": "C12",
            "q": "¿Qué hace si el producto llega en mal estado o falta?",
            "why": "Define devoluciones a proveedor y notas de crédito",
            "example": "Se descuenta de la factura",
            "priority": "Fase 2"
          },
          {
            "id": "C13",
            "q": "¿Sernapesca u otra autoridad le exige algún registro de trazabilidad?",
            "why": "Puede obligar a guardar datos y a emitir reportes específicos",
            "example": "Sí, guardamos las guías por 2 años",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "C14",
            "q": "¿Quién autoriza una compra grande?",
            "why": "Define si se requiere aprobación en el sistema",
            "example": "Solo el dueño sobre $2.000.000",
            "priority": "Fase 5"
          }
        ]
      }
    ]
  },
  {
    "key": "D",
    "title": "D · CLIENTES Y VENTAS",
    "short": "D. Clientes y ventas",
    "intro": "Cómo llega un pedido, cómo se cotiza y cómo se cobra realmente.",
    "blocks": [
      {
        "title": "Los clientes",
        "questions": [
          {
            "id": "D1",
            "q": "¿Cuántos clientes activos tiene hoy? ¿Cuántos compran cada semana?",
            "why": "Dimensiona el CRM y los reportes de frecuencia",
            "example": "45 activos, 20 semanales",
            "priority": "Fase 3 · bloqueante"
          },
          {
            "id": "D2",
            "q": "¿Qué tipos de cliente atiende y en qué proporción de sus ventas?",
            "why": "Define listas de precios y segmentación de reportes",
            "example": "70% restaurantes, 20% mayorista, 10% público",
            "priority": "Fase 3 · bloqueante"
          },
          {
            "id": "D3",
            "q": "¿Un cliente puede tener varias direcciones de entrega?",
            "why": "Define el manejo de direcciones múltiples",
            "example": "Sí, cadena con 3 locales",
            "priority": "Fase 3 · bloqueante"
          },
          {
            "id": "D4",
            "q": "¿Quién hace el pedido es la misma persona que paga?",
            "why": "Define contactos separados por cliente",
            "example": "Pide el chef, paga administración",
            "priority": "Fase 3"
          },
          {
            "id": "D5",
            "q": "¿Hay clientes con los que trabaja con precio fijo por contrato?",
            "why": "Define listas de precios especiales por cliente",
            "example": "Sí, un hotel con precio fijo mensual",
            "priority": "Fase 3"
          }
        ]
      },
      {
        "title": "Cómo se toma el pedido",
        "questions": [
          {
            "id": "D6",
            "q": "¿Por dónde le llegan los pedidos? ¿En qué proporción?",
            "why": "Define si se necesita entrada rápida de pedidos o portal de cliente",
            "example": "80% WhatsApp, 20% teléfono",
            "priority": "Fase 3 · bloqueante"
          },
          {
            "id": "D7",
            "q": "¿El cliente pide kilos exactos o cantidades aproximadas?",
            "why": "Define cómo se maneja la diferencia entre lo pedido y lo entregado",
            "example": "Pide 'unos 15 kilos de salmón'",
            "priority": "Fase 3 · bloqueante"
          },
          {
            "id": "D8",
            "q": "¿Hay clientes con pedido fijo y repetido cada semana?",
            "why": "Permite plantillas de pedido recurrente",
            "example": "Sí, 8 restaurantes piden lo mismo cada martes",
            "priority": "Fase 3"
          },
          {
            "id": "D9",
            "q": "¿Se puede vender algo que todavía no ha llegado a bodega?",
            "why": "Define si se permite vender contra compra futura (stock negativo controlado)",
            "example": "Sí, se compromete y se compra mañana",
            "priority": "Fase 3 · bloqueante"
          }
        ]
      },
      {
        "title": "La regla más importante: el peso",
        "questions": [
          {
            "id": "D10",
            "q": "¿Le cobra al cliente el peso que pidió o el peso real que despachó?",
            "why": "Es la regla central del sistema de facturación. Hoy está configurado para cobrar el peso real",
            "example": "El peso real que sale de la balanza",
            "priority": "Fase 3 · bloqueante"
          },
          {
            "id": "D11",
            "q": "¿Cuánta diferencia de peso acepta sin avisar al cliente?",
            "why": "Define alertas al preparar (ej. si difiere más de 5%, avisar)",
            "example": "Hasta 5% para arriba o para abajo",
            "priority": "Fase 4 · bloqueante"
          },
          {
            "id": "D12",
            "q": "Si falta producto al preparar, ¿qué se hace?",
            "why": "Define el comportamiento cuando el stock no alcanza",
            "example": "Se despacha menos y se avisa por WhatsApp",
            "priority": "Fase 4 · bloqueante"
          },
          {
            "id": "D13",
            "q": "¿Cobra el despacho? ¿Desde qué monto es gratis?",
            "why": "Configura el cargo de transporte automático",
            "example": "$15.000 bajo 50 kg, gratis sobre eso",
            "priority": "Fase 3"
          },
          {
            "id": "D14",
            "q": "¿Acepta devoluciones? ¿En qué casos y qué se hace con el producto?",
            "why": "Define el flujo de devolución y su impacto en inventario",
            "example": "Solo si viene en mal estado, se da nota de crédito",
            "priority": "Fase 5"
          }
        ]
      }
    ]
  },
  {
    "key": "E",
    "title": "E · PREPARACIÓN, EMPAQUE Y REPARTO",
    "short": "E. Preparación y reparto",
    "intro": "Lo que hace el equipo en bodega y en la calle. Define las pantallas móviles de los trabajadores.",
    "blocks": [
      {
        "title": "Preparación y empaque",
        "questions": [
          {
            "id": "E1",
            "q": "¿Quién prepara los pedidos y en qué horario?",
            "why": "Define los turnos y las tareas asignadas por rol",
            "example": "2 personas de 06:00 a 09:00",
            "priority": "Fase 4 · bloqueante"
          },
          {
            "id": "E2",
            "q": "¿Se prepara pedido por pedido, o se pesa todo un producto y luego se reparte?",
            "why": "Cambia por completo el diseño de la pantalla de empaque",
            "example": "Pedido por pedido",
            "priority": "Fase 4 · bloqueante"
          },
          {
            "id": "E3",
            "q": "¿Se pesa cada producto de cada pedido y se anota?",
            "why": "Define el registro de peso real por línea",
            "example": "Sí, se anota en la hoja del pedido",
            "priority": "Fase 4 · bloqueante"
          },
          {
            "id": "E4",
            "q": "¿Se etiquetan los bultos? ¿Qué información lleva la etiqueta?",
            "why": "Define impresión de etiquetas y contenido",
            "example": "Nombre del cliente y producto, a mano",
            "priority": "Fase 6"
          },
          {
            "id": "E5",
            "q": "¿Cuántos bultos o cajas salen por pedido en promedio?",
            "why": "Define el conteo de bultos en la entrega",
            "example": "2 a 4 cajas",
            "priority": "Fase 4"
          },
          {
            "id": "E6",
            "q": "¿Se agrega hielo? ¿Se cobra o se descuenta del peso?",
            "why": "Puede afectar el peso facturado",
            "example": "Hielo gratis, no se pesa",
            "priority": "Fase 4 · bloqueante"
          },
          {
            "id": "E7",
            "q": "¿Quién revisa que el pedido esté completo antes de salir?",
            "why": "Define si hay un paso de control de calidad antes del despacho",
            "example": "El jefe de bodega revisa",
            "priority": "Fase 4"
          }
        ]
      },
      {
        "title": "Reparto",
        "questions": [
          {
            "id": "E8",
            "q": "¿Cuántos vehículos y repartidores tiene? ¿Propios o externos?",
            "why": "Define usuarios de reparto y asignación de rutas",
            "example": "2 camionetas propias, 1 externo en peak",
            "priority": "Fase 4 · bloqueante"
          },
          {
            "id": "E9",
            "q": "¿Cuántas rutas hace al día? ¿Las zonas son fijas?",
            "why": "Define el armado de rutas",
            "example": "2 rutas: norte y sur",
            "priority": "Fase 4 · bloqueante"
          },
          {
            "id": "E10",
            "q": "¿Quién arma la ruta y con qué criterio?",
            "why": "Define si el orden lo pone el administrador o el repartidor",
            "example": "El dueño, por cercanía",
            "priority": "Fase 4"
          },
          {
            "id": "E11",
            "q": "¿El repartidor cobra en la entrega? ¿En efectivo, transferencia o ambas?",
            "why": "Define el cobro en terreno y la rendición de caja",
            "example": "Sí, efectivo y transferencia al momento",
            "priority": "Fase 4 · bloqueante"
          },
          {
            "id": "E12",
            "q": "¿El repartidor puede vender producto extra en la calle?",
            "why": "Define si necesita venta desde el vehículo con su propio stock",
            "example": "A veces vende lo que sobra",
            "priority": "Fase 4 · bloqueante"
          },
          {
            "id": "E13",
            "q": "¿Hoy pide firma, foto o algún respaldo de entrega?",
            "why": "Define la evidencia obligatoria al entregar",
            "example": "Firma en la guía impresa",
            "priority": "Fase 4 · bloqueante"
          },
          {
            "id": "E14",
            "q": "¿Qué pasa si el cliente no está o rechaza el pedido?",
            "why": "Define el flujo de entrega fallida y el retorno a bodega",
            "example": "Se devuelve y se reprograma",
            "priority": "Fase 4 · bloqueante"
          },
          {
            "id": "E15",
            "q": "¿Entrega documento impreso con el pedido? ¿Cuál?",
            "why": "Define qué documento debe generar el sistema",
            "example": "Guía de despacho impresa",
            "priority": "Fase 5"
          },
          {
            "id": "E16",
            "q": "¿Hay horario comprometido de entrega con algún cliente?",
            "why": "Define ventanas horarias y alertas de atraso",
            "example": "Restaurantes antes de las 11:00",
            "priority": "Fase 4"
          }
        ]
      }
    ]
  },
  {
    "key": "F",
    "title": "F · PAGOS, COBRANZA Y RENTABILIDAD",
    "short": "F. Dinero",
    "intro": "Cómo entra la plata, a quién se le fía y cómo se sabe si el negocio está ganando.",
    "blocks": [
      {
        "title": "Cobro y pagos",
        "questions": [
          {
            "id": "F1",
            "q": "¿Qué formas de pago recibe y en qué proporción?",
            "why": "Configura los métodos de pago del sistema",
            "example": "60% transferencia, 30% efectivo, 10% crédito",
            "priority": "Fase 5 · bloqueante"
          },
          {
            "id": "F2",
            "q": "¿A qué clientes les fía y a cuántos días?",
            "why": "Configura el crédito y las cuentas por cobrar",
            "example": "Restaurantes a 30 días, hoteles a 45",
            "priority": "Fase 5 · bloqueante"
          },
          {
            "id": "F3",
            "q": "¿Tiene un límite de crédito por cliente? ¿Quién lo autoriza?",
            "why": "Bloqueo automático de pedidos a clientes sobre su límite",
            "example": "Sí, $2.000.000. Lo autorizo yo",
            "priority": "Fase 5 · bloqueante"
          },
          {
            "id": "F4",
            "q": "¿A partir de cuántos días considera que una deuda está vencida?",
            "why": "Define las alertas de cobranza",
            "example": "A los 30 días de la factura",
            "priority": "Fase 5 · bloqueante"
          },
          {
            "id": "F5",
            "q": "¿Cobra interés o recargo por atraso?",
            "why": "Define el cálculo de mora",
            "example": "No",
            "priority": "Fase 5"
          },
          {
            "id": "F6",
            "q": "¿Quién hace la cobranza y cómo la lleva hoy?",
            "why": "Define el tablero de cobranza y sus responsables",
            "example": "Yo mismo, por WhatsApp",
            "priority": "Fase 5"
          }
        ]
      },
      {
        "title": "Documentos tributarios",
        "questions": [
          {
            "id": "F7",
            "q": "¿Emite boleta, factura y/o guía de despacho?",
            "why": "Define qué documentos debe generar el sistema",
            "example": "Factura y guía de despacho",
            "priority": "Fase 5 · bloqueante"
          },
          {
            "id": "F8",
            "q": "¿Con qué sistema factura hoy? (Nubox, Bsale, SII gratuito, otro)",
            "why": "Define la integración futura de facturación electrónica",
            "example": "Facturación gratuita del SII",
            "priority": "Fase 5 · bloqueante"
          },
          {
            "id": "F9",
            "q": "¿Quiere que el sistema EMITA la factura, o solo que registre el número?",
            "why": "Es la diferencia entre integrar con el SII o solo controlar",
            "example": "Por ahora solo registrar el número",
            "priority": "Fase 5 · bloqueante"
          }
        ]
      },
      {
        "title": "Rentabilidad",
        "questions": [
          {
            "id": "F10",
            "q": "¿Sabe hoy cuánto gana por kilo o por cliente?",
            "why": "Define qué reportes de margen se construyen primero",
            "example": "No, solo estimo",
            "priority": "Fase 5"
          },
          {
            "id": "F11",
            "q": "¿Qué costos fijos mensuales tiene? (arriendo, sueldos, luz, camión)",
            "why": "Permite calcular margen neto, no solo bruto",
            "example": "$4.500.000 mensuales",
            "priority": "Fase 5"
          },
          {
            "id": "F12",
            "q": "¿Paga comisiones o bonos por venta, kilo o entrega?",
            "why": "Define cálculos de comisión por trabajador",
            "example": "Repartidor gana bono por entrega",
            "priority": "Fase 5"
          },
          {
            "id": "F13",
            "q": "¿Quién puede ver los costos y los márgenes?",
            "why": "Define permisos: hoy solo el administrador los ve",
            "example": "Solo yo",
            "priority": "Fase 5 · bloqueante"
          },
          {
            "id": "F14",
            "q": "¿Qué informes le pide su contador y con qué frecuencia?",
            "why": "Define los reportes exportables",
            "example": "Ventas mensuales y compras con IVA",
            "priority": "Fase 5"
          }
        ]
      }
    ]
  },
  {
    "key": "G",
    "title": "G · MERMAS, CALIDAD Y REGLAS DEL NEGOCIO",
    "short": "G. Mermas y reglas",
    "intro": "Las pérdidas reales y las reglas que el sistema debe hacer cumplir (o permitir).",
    "blocks": [
      {
        "title": "Mermas y pérdidas",
        "questions": [
          {
            "id": "G1",
            "q": "¿Cuánto se pierde al mes aproximadamente? ¿En kilos o en pesos?",
            "why": "Define la línea base para medir la mejora",
            "example": "Unos 200 kg al mes",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "G2",
            "q": "¿Cuáles son las causas más comunes de pérdida?",
            "why": "Configura los motivos de merma del sistema",
            "example": "Se pasa de fecha, se maltrata, diferencia de peso",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "G3",
            "q": "El producto pierde peso solo en cámara (deshidratación). ¿Cuánto estima?",
            "why": "Define ajustes periódicos de inventario",
            "example": "1% a 2% por día",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "G4",
            "q": "¿Qué hace con el producto que no se vendió a tiempo?",
            "why": "Define si hay cambio de estado, rebaja o baja del producto",
            "example": "Se congela o se vende más barato",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "G5",
            "q": "¿Registra hoy las pérdidas en algún lado?",
            "why": "Define el punto de partida del módulo de mermas",
            "example": "No",
            "priority": "Fase 2"
          },
          {
            "id": "G6",
            "q": "¿Quién puede dar de baja producto?",
            "why": "Define permisos y autorizaciones para mermas",
            "example": "Solo el jefe de bodega y yo",
            "priority": "Fase 2 · bloqueante"
          }
        ]
      },
      {
        "title": "Reglas y excepciones",
        "questions": [
          {
            "id": "G7",
            "q": "¿Alguna vez vendió más de lo que tenía? ¿Cómo lo resolvieron?",
            "why": "Define si el sistema bloquea o solo advierte",
            "example": "Sí, se compró de urgencia a otro proveedor",
            "priority": "Fase 3 · bloqueante"
          },
          {
            "id": "G8",
            "q": "¿Quién puede cambiar un precio de venta?",
            "why": "Define permisos y bitácora de cambios de precio",
            "example": "Solo yo",
            "priority": "Fase 3 · bloqueante"
          },
          {
            "id": "G9",
            "q": "¿Quién puede anular o modificar un pedido ya despachado?",
            "why": "Hoy el sistema lo impide. Define si debe haber una excepción con autorización",
            "example": "Solo yo, y debe quedar registrado",
            "priority": "Fase 3 · bloqueante"
          },
          {
            "id": "G10",
            "q": "¿Un descuento sobre cierto porcentaje debe ser autorizado?",
            "why": "Define el flujo de aprobación de descuentos",
            "example": "Sobre 10% me tienen que preguntar",
            "priority": "Fase 3"
          },
          {
            "id": "G11",
            "q": "¿Hay información que ciertos trabajadores NO deben ver nunca?",
            "why": "Ajusta la matriz de permisos",
            "example": "Los repartidores no ven costos ni márgenes",
            "priority": "Fase 2 · bloqueante"
          },
          {
            "id": "G12",
            "q": "¿Qué error del personal le ha costado más caro?",
            "why": "Define qué validaciones agregar primero",
            "example": "Despachar al cliente equivocado",
            "priority": "Fase 4"
          },
          {
            "id": "G13",
            "q": "Si el sistema pudiera avisarle 3 cosas automáticamente, ¿cuáles serían?",
            "why": "Define las notificaciones automáticas",
            "example": "Stock bajo, cliente que debe, pedido sin despachar",
            "priority": "Fase 6 · bloqueante"
          },
          {
            "id": "G14",
            "q": "¿Qué le gustaría dejar de hacer a mano mañana mismo?",
            "why": "Prioriza el desarrollo",
            "example": "Sumar los pedidos con calculadora",
            "priority": "Fase 2"
          }
        ]
      }
    ]
  }
]

export const TOTAL_QUESTIONS = SURVEY.reduce(
  (n, s) => n + s.blocks.reduce((m, b) => m + b.questions.length, 0),
  0,
)

export const BLOCKING_IDS = new Set(
  SURVEY.flatMap((s) => s.blocks.flatMap((b) => b.questions))
    .filter((q) => q.priority.toLowerCase().includes('bloqueante'))
    .map((q) => q.id),
)
