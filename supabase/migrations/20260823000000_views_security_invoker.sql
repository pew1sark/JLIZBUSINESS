-- ===========================================================
-- Vistas operativas: security_invoker
-- -----------------------------------------------------------
-- Estas seis vistas se ejecutaban con los permisos de su creador,
-- ignorando el RLS de quien consulta. Con una sola empresa no hacía
-- daño; en la plataforma multiempresa serían la vía exacta por la que
-- una empresa leería los pedidos, el stock y los reportes de otra.
--
-- Las otras ocho vistas del proyecto ya tenían security_invoker activo.
-- Verificado tras el cambio: las seis devuelven el mismo número de filas
-- consultadas por un usuario admin real (0, 2, 0, 0, 30, 11).
-- ===========================================================
alter view public.v_hoja_ruta               set (security_invoker = on);
alter view public.v_stock_operativo         set (security_invoker = on);
alter view public.v_lotes_operativos        set (security_invoker = on);
alter view public.v_pedidos_operativos      set (security_invoker = on);
alter view public.v_pedido_items_operativos set (security_invoker = on);
alter view public.v_reportes_operativos     set (security_invoker = on);
