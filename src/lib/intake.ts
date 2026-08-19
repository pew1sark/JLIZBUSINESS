/** Definición del formulario de carga de datos duros (catálogo, rendimientos, costos). */

export type CampoTipo = 'texto' | 'numero' | 'dinero' | 'select' | 'area'

export interface Campo {
  key: string
  label: string
  tipo: CampoTipo
  ayuda?: string
  placeholder?: string
  opciones?: { value: string; label: string }[]
  requerido?: boolean
  ancho?: 'sm' | 'md' | 'lg'
}

export interface Seccion {
  kind:
    | 'productos' | 'rendimientos' | 'clientes' | 'proveedores' | 'costos'
    | 'inventario_apertura' | 'saldos_cobrar' | 'saldos_pagar'
  titulo: string
  intro: string
  filaUnica?: boolean
  etiquetaFila: string
  campos: Campo[]
  grupos?: { titulo: string; campos: string[] }[]
}

export const SECCIONES: Seccion[] = [
  {
    kind: 'productos',
    titulo: 'Catálogo de productos',
    intro:
      'Una fila por producto que venden. Si el mismo pescado se vende entero y en filete, van en dos filas distintas, porque tienen precio y costo diferentes.',
    etiquetaFila: 'producto',
    campos: [
      { key: 'nombre', label: 'Nombre del producto', tipo: 'texto', requerido: true, placeholder: 'Merluza filete', ancho: 'lg' },
      { key: 'especie', label: 'Especie', tipo: 'texto', placeholder: 'Merluza', ancho: 'md' },
      { key: 'presentacion', label: 'Presentación', tipo: 'texto', placeholder: 'Filete sin piel', ancho: 'md' },
      {
        key: 'unidad', label: 'Se vende por', tipo: 'select', ancho: 'sm',
        opciones: [
          { value: 'kg', label: 'Kilo' },
          { value: 'unidad', label: 'Unidad' },
          { value: 'bandeja', label: 'Bandeja' },
          { value: 'caja', label: 'Caja' },
        ],
      },
      { key: 'costo_compra', label: 'Costo de compra', tipo: 'dinero', ayuda: 'Lo que pagan al proveedor, sin flete', ancho: 'sm' },
      { key: 'precio_venta', label: 'Precio de venta', tipo: 'dinero', ayuda: 'Neto, sin IVA', ancho: 'sm' },
      { key: 'stock_minimo', label: 'Stock mínimo', tipo: 'numero', ayuda: 'Bajo esta cantidad, el sistema avisa', ancho: 'sm' },
      { key: 'dias_duracion', label: 'Días que dura', tipo: 'numero', ancho: 'sm' },
      { key: 'proveedor_habitual', label: 'Proveedor habitual', tipo: 'texto', ancho: 'md' },
      { key: 'sku', label: 'Código interno', tipo: 'texto', ancho: 'sm' },
      { key: 'observaciones', label: 'Observaciones', tipo: 'texto', ancho: 'lg' },
    ],
  },
  {
    kind: 'rendimientos',
    titulo: 'Rendimiento del proceso',
    intro:
      'Ustedes compran entero y filetean, y el rendimiento cambia según el pescado. Con esto el sistema calcula el costo real del filete. Una fila por cada transformación que hacen.',
    etiquetaFila: 'rendimiento',
    campos: [
      { key: 'producto_entero', label: 'Producto que entra', tipo: 'texto', requerido: true, placeholder: 'Merluza entera', ancho: 'lg' },
      { key: 'producto_final', label: 'Producto que sale', tipo: 'texto', requerido: true, placeholder: 'Merluza filete', ancho: 'lg' },
      { key: 'kg_entrada', label: 'Kilos que entran', tipo: 'numero', placeholder: '100', ancho: 'sm' },
      { key: 'kg_salida', label: 'Kilos que salen', tipo: 'numero', placeholder: '46', ancho: 'sm' },
      { key: 'rendimiento_pct', label: 'Rendimiento %', tipo: 'numero', ayuda: 'Se calcula solo si llenan los kilos', ancho: 'sm' },
      { key: 'observaciones', label: 'Observaciones', tipo: 'texto', ancho: 'lg' },
    ],
  },
  {
    kind: 'clientes',
    titulo: 'Clientes',
    intro: 'Sus clientes activos. Con esto el sistema arranca con la cartera real y su condición de pago.',
    etiquetaFila: 'cliente',
    campos: [
      { key: 'nombre', label: 'Nombre del local', tipo: 'texto', requerido: true, placeholder: 'Restaurante Mar Azul', ancho: 'lg' },
      { key: 'empresa', label: 'Razón social', tipo: 'texto', ancho: 'lg' },
      { key: 'rut', label: 'RUT', tipo: 'texto', ancho: 'sm' },
      {
        key: 'tipo', label: 'Tipo', tipo: 'select', ancho: 'sm',
        opciones: [
          { value: 'restaurante', label: 'Restaurante' },
          { value: 'hotel', label: 'Hotel' },
          { value: 'supermercado', label: 'Supermercado' },
          { value: 'mayorista', label: 'Mayorista' },
          { value: 'distribuidor', label: 'Distribuidor' },
          { value: 'particular', label: 'Particular' },
        ],
      },
      { key: 'contacto_pedido', label: 'Quién hace el pedido', tipo: 'texto', placeholder: 'Chef Pedro', ancho: 'md' },
      { key: 'contacto_pago', label: 'Quién paga', tipo: 'texto', placeholder: 'Administración', ancho: 'md' },
      { key: 'telefono', label: 'Teléfono', tipo: 'texto', ancho: 'md' },
      { key: 'whatsapp', label: 'WhatsApp', tipo: 'texto', ancho: 'md' },
      { key: 'email', label: 'Correo', tipo: 'texto', ancho: 'md' },
      { key: 'direccion', label: 'Dirección de entrega', tipo: 'texto', ancho: 'lg' },
      { key: 'comuna', label: 'Comuna', tipo: 'texto', ancho: 'sm' },
      { key: 'ventana_horaria', label: 'Horario de entrega', tipo: 'texto', placeholder: '09:00 - 11:00', ancho: 'sm' },
      { key: 'dias_credito', label: 'Días de crédito', tipo: 'numero', ancho: 'sm' },
      { key: 'limite_credito', label: 'Límite de crédito', tipo: 'dinero', ancho: 'sm' },
      { key: 'observaciones', label: 'Observaciones', tipo: 'texto', ancho: 'lg' },
    ],
  },
  {
    kind: 'proveedores',
    titulo: 'Proveedores',
    intro: 'Los proveedores con los que trabajan habitualmente en el terminal.',
    etiquetaFila: 'proveedor',
    campos: [
      { key: 'nombre', label: 'Nombre', tipo: 'texto', requerido: true, ancho: 'lg' },
      { key: 'empresa', label: 'Razón social', tipo: 'texto', ancho: 'lg' },
      { key: 'rut', label: 'RUT', tipo: 'texto', ancho: 'sm' },
      { key: 'contacto', label: 'Contacto', tipo: 'texto', ancho: 'md' },
      { key: 'telefono', label: 'Teléfono', tipo: 'texto', ancho: 'md' },
      { key: 'whatsapp', label: 'WhatsApp', tipo: 'texto', ancho: 'md' },
      { key: 'email', label: 'Correo', tipo: 'texto', ancho: 'md' },
      { key: 'ubicacion', label: 'Local / dirección', tipo: 'texto', placeholder: 'Terminal Pesquero, local 12', ancho: 'lg' },
      { key: 'productos', label: 'Qué les vende', tipo: 'texto', ancho: 'lg' },
      { key: 'dias_pago', label: 'Días de pago', tipo: 'numero', ancho: 'sm' },
      { key: 'evaluacion', label: 'Evaluación (1-5)', tipo: 'numero', ancho: 'sm' },
      { key: 'observaciones', label: 'Observaciones', tipo: 'texto', ancho: 'lg' },
    ],
  },
  {
    kind: 'inventario_apertura',
    titulo: 'Stock que hay hoy',
    intro:
      'Lo que tienen en cámara en este momento, con lo que costó. Es el punto de partida del inventario: sin esto el sistema arranca en cero y no cuadra con la realidad. Complétenlo el día antes de empezar a usarlo.',
    etiquetaFila: 'producto en cámara',
    campos: [
      { key: 'producto', label: 'Producto', tipo: 'texto', requerido: true, ayuda: 'Debe llamarse igual que en el catálogo', ancho: 'lg' },
      { key: 'kilos', label: 'Kilos que hay', tipo: 'numero', requerido: true, ancho: 'sm' },
      { key: 'costo_kilo', label: 'Costo por kilo', tipo: 'dinero', ayuda: 'Lo que pagaron por ese pescado', ancho: 'sm' },
      { key: 'proveedor', label: 'Proveedor', tipo: 'texto', ancho: 'md' },
      { key: 'fecha_recepcion', label: 'Cuándo llegó', tipo: 'texto', placeholder: '2026-08-18', ancho: 'sm' },
      { key: 'vence', label: 'Vence', tipo: 'texto', placeholder: '2026-08-21', ancho: 'sm' },
      { key: 'ubicacion', label: 'Dónde está', tipo: 'texto', placeholder: 'Cámara oficina', ancho: 'md' },
      { key: 'observaciones', label: 'Observaciones', tipo: 'texto', ancho: 'lg' },
    ],
  },
  {
    kind: 'saldos_cobrar',
    titulo: 'Lo que les deben',
    intro:
      'Facturas pendientes de cobro al día de hoy, una por fila. Sin esto la cobranza arranca vacía y se pierde de vista plata real. No hace falta cargar el historial completo: solo lo que sigue pendiente.',
    etiquetaFila: 'factura por cobrar',
    campos: [
      { key: 'cliente', label: 'Cliente', tipo: 'texto', requerido: true, ayuda: 'Igual que en la lista de clientes', ancho: 'lg' },
      { key: 'documento', label: 'N° de factura', tipo: 'texto', ancho: 'sm' },
      { key: 'fecha', label: 'Fecha de emisión', tipo: 'texto', placeholder: '2026-07-20', ancho: 'sm' },
      { key: 'vence', label: 'Vence', tipo: 'texto', placeholder: '2026-08-19', ancho: 'sm' },
      { key: 'monto', label: 'Monto total', tipo: 'dinero', requerido: true, ancho: 'sm' },
      { key: 'abonado', label: 'Ya abonado', tipo: 'dinero', ayuda: 'Si pagó una parte', ancho: 'sm' },
      { key: 'observaciones', label: 'Observaciones', tipo: 'texto', ancho: 'lg' },
    ],
  },
  {
    kind: 'saldos_pagar',
    titulo: 'Lo que ustedes deben',
    intro:
      'Facturas de proveedores pendientes de pago al día de hoy. Igual que la anterior: solo lo que sigue abierto.',
    etiquetaFila: 'factura por pagar',
    campos: [
      { key: 'proveedor', label: 'Proveedor', tipo: 'texto', requerido: true, ancho: 'lg' },
      { key: 'documento', label: 'N° de factura', tipo: 'texto', ancho: 'sm' },
      { key: 'fecha', label: 'Fecha de emisión', tipo: 'texto', placeholder: '2026-08-01', ancho: 'sm' },
      { key: 'vence', label: 'Vence', tipo: 'texto', placeholder: '2026-08-31', ancho: 'sm' },
      { key: 'monto', label: 'Monto total', tipo: 'dinero', requerido: true, ancho: 'sm' },
      { key: 'abonado', label: 'Ya abonado', tipo: 'dinero', ancho: 'sm' },
      { key: 'observaciones', label: 'Observaciones', tipo: 'texto', ancho: 'lg' },
    ],
  },
  {
    kind: 'costos',
    titulo: 'Costos exactos',
    intro:
      'Estos números son los que convierten el margen estimado en margen real. Los de viaje se reparten entre los kilos comprados; los fijos permiten saber cuánto queda de verdad al final del mes.',
    etiquetaFila: 'ficha de costos',
    filaUnica: true,
    grupos: [
      { titulo: 'Por cada viaje al terminal', campos: ['viajes_semana', 'flete_viaje', 'combustible_viaje', 'peajes_viaje', 'hielo_viaje', 'cajas_viaje', 'laminas_viaje', 'otros_viaje'] },
      { titulo: 'Costos fijos del mes', campos: ['arriendo', 'sueldos', 'luz_agua', 'internet_telefono', 'mantencion_vehiculos', 'contador', 'software', 'otros_fijos'] },
      { titulo: 'Referencia', campos: ['kilos_por_viaje', 'notas_costos'] },
    ],
    campos: [
      { key: 'viajes_semana', label: 'Viajes al terminal por semana', tipo: 'numero', ancho: 'sm' },
      { key: 'flete_viaje', label: 'Flete por viaje', tipo: 'dinero', ayuda: 'Si el camión es propio, dejar en 0 y cargar combustible', ancho: 'sm' },
      { key: 'combustible_viaje', label: 'Combustible por viaje', tipo: 'dinero', ancho: 'sm' },
      { key: 'peajes_viaje', label: 'Peajes por viaje', tipo: 'dinero', ancho: 'sm' },
      { key: 'hielo_viaje', label: 'Hielo por viaje', tipo: 'dinero', ancho: 'sm' },
      { key: 'cajas_viaje', label: 'Cajas por viaje', tipo: 'dinero', ancho: 'sm' },
      { key: 'laminas_viaje', label: 'Láminas por viaje', tipo: 'dinero', ancho: 'sm' },
      { key: 'otros_viaje', label: 'Otros costos por viaje', tipo: 'dinero', ancho: 'sm' },
      { key: 'kilos_por_viaje', label: 'Kilos que traen por viaje', tipo: 'numero', ayuda: 'Sirve para repartir el costo por kilo', ancho: 'sm' },
      { key: 'arriendo', label: 'Arriendo mensual', tipo: 'dinero', ancho: 'sm' },
      { key: 'sueldos', label: 'Sueldos mensuales', tipo: 'dinero', ancho: 'sm' },
      { key: 'luz_agua', label: 'Luz y agua', tipo: 'dinero', ancho: 'sm' },
      { key: 'internet_telefono', label: 'Internet y teléfono', tipo: 'dinero', ancho: 'sm' },
      { key: 'mantencion_vehiculos', label: 'Mantención de vehículos', tipo: 'dinero', ancho: 'sm' },
      { key: 'contador', label: 'Contador', tipo: 'dinero', ancho: 'sm' },
      { key: 'software', label: 'Software y facturación', tipo: 'dinero', ancho: 'sm' },
      { key: 'otros_fijos', label: 'Otros costos fijos', tipo: 'dinero', ancho: 'sm' },
      { key: 'notas_costos', label: 'Notas', tipo: 'area', ancho: 'lg' },
    ],
  },
]

export const CAMPOS_VIAJE = [
  'flete_viaje', 'combustible_viaje', 'peajes_viaje', 'hielo_viaje',
  'cajas_viaje', 'laminas_viaje', 'otros_viaje',
]

export const CAMPOS_FIJOS = [
  'arriendo', 'sueldos', 'luz_agua', 'internet_telefono',
  'mantencion_vehiculos', 'contador', 'software', 'otros_fijos',
]
