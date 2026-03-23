-- ============================================================
-- Tabla: warehouse_layouts
-- Almacena los layouts completos del diseñador de almacén
-- ============================================================

CREATE TABLE IF NOT EXISTS warehouse_layouts (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    layout_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Índice para búsqueda por nombre
CREATE INDEX IF NOT EXISTS idx_warehouse_layouts_name ON warehouse_layouts (name);

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_warehouse_layouts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_warehouse_layouts_updated_at ON warehouse_layouts;
CREATE TRIGGER trg_warehouse_layouts_updated_at
    BEFORE UPDATE ON warehouse_layouts
    FOR EACH ROW
    EXECUTE FUNCTION update_warehouse_layouts_updated_at();

-- Deshabilitar RLS para desarrollo (igual que las demás tablas)
ALTER TABLE warehouse_layouts DISABLE ROW LEVEL SECURITY;
