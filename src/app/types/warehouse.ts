// ─── Tool / Element types ───────────────────────────────────────────────────

export type WElementType = 'rack' | 'bin' | 'wall' | 'dockdoor' | 'zonearea';
export type WTool = 'select' | 'pan' | 'rack' | 'bin' | 'wall' | 'dockdoor' | 'rackgroup' | 'zone';

export type WBinStatus = 'available' | 'occupied' | 'blocked' | 'maintenance';

// ─── Domain objects ──────────────────────────────────────────────────────────

export interface WZone {
    id: string;
    name: string;
    color: string; // hex WITHOUT '#', e.g. 'bbdefb'
}

export interface WRack {
    id: string;
    label: string;
    x: number;
    y: number;
    w: number;
    h: number;
    zoneId?: string;
    linkedId?: string;   // FK to Location.id in Supabase
    priority?: number;   // 1–10
    active: boolean;
    binIds: string[];    // ordered child bin IDs
    // Location fields (synced to locations table)
    category?: string;   // REGULAR, HURT, PICKING, REPOSITORY, FLOW, BLOCKED
    type?: string;       // Floor-F, Low-L, Mid-M, Top-T, Special-S, Toxicity-TX
    area?: string;
    row?: string;
    bay?: string;
    level?: string;
    storageName?: string;
    customName?: boolean;
    content?: string;
    storageNameFormat?: string;
}

export interface WBin {
    id: string;
    rackId: string;      // parent rack
    label: string;
    sku?: string;
    status: WBinStatus;
    x: number;           // absolute canvas coords
    y: number;
    w: number;
    h: number;
    linkedId?: string;   // FK to Bin.id in Supabase
    active: boolean;
    capacity?: number;       // max capacity
    currentStock?: number;   // current stock level
}

export interface WWall {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    angle?: number;
    label?: string;
}

export interface WDockDoor {
    id: string;
    label: string;
    x: number;
    y: number;
    w: number;
    h: number;
    angle?: number;
    wallId?: string;
}

export interface WZoneArea {
    id: string;
    zoneId?: string;  // assigned zone — undefined = unassigned
    x: number;
    y: number;
    w: number;
    h: number;
}

// ─── Layout (persisted) ───────────────────────────────────────────────────────

export interface WLayout {
    version: 2;
    name: string;
    zones: WZone[];
    zoneAreas: WZoneArea[];
    racks: WRack[];
    bins: WBin[];
    walls: WWall[];
    dockDoors: WDockDoor[];
}

// ─── Rack Group Generator ─────────────────────────────────────────────────────

export interface WRackGroupParams {
    count: number;
    axis: 'x' | 'y';
    rackW: number;
    rackH: number;
    gap: number;
    startX: number;
    startY: number;
    prefix: string;
    startIndex: number;
    binsPerRack: number;
    binPrefix: string;
    zoneId?: string;
}

// ─── History snapshot ────────────────────────────────────────────────────────

export interface WHistorySnapshot {
    racks: WRack[];
    bins: WBin[];
    walls: WWall[];
    dockDoors: WDockDoor[];
    zoneAreas: WZoneArea[];
}

// ─── Custom data stored on Fabric.js objects ─────────────────────────────────

export interface FabricWhData {
    kind: WElementType;
    id: string;
    rackId?: string; // set on bins
}
