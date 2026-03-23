import { Injectable, OnDestroy, signal, computed, NgZone, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { Canvas, Rect, FabricText, Group, Point, Line } from 'fabric';
import type { FabricObject } from 'fabric';
import {
    WLayout, WRack, WBin, WWall, WDockDoor, WZone, WZoneArea,
    WTool, WRackGroupParams, WHistorySnapshot, FabricWhData
} from '../../types/warehouse';
import { SupabaseService } from '../../services/supabase.service';

// ─── Constants ───────────────────────────────────────────────────────────────

const SNAP_GRID = 20;
const STORAGE_KEY = 'wh-designer-layout-v2';
const MAX_HISTORY = 50;
const ALIGN_THRESHOLD = 6;       // px for alignment snap guides
const GRID_COLOR = '#d0d5dd';
const GRID_OPACITY = 0.45;
const RULER_SIZE = 24;            // px width/height of ruler bar
const RULER_BG = '#f8f9fa';
const RULER_LINE = '#94a3b8';
const RULER_TEXT = '#64748b';

const RACK_LABEL_H = 0;               // label is now a separate floating object
const RACK_LABEL_OFFSET_Y = 16;       // px above the rack rect for the floating label
const BIN_PAD = 0;                    // px padding between bin and rack edges (0 for grid alignment)
const RACK_DEFAULT = { w: 120, h: 80 };
const BIN_DEFAULT  = { w: 60,  h: 40 };
const WALL_DEFAULT = { w: 200, h: 6 };
const DOCK_DEFAULT = { w: 60,  h: 12 };  // h = thickness (thicker than wall)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function snapV(v: number, g = SNAP_GRID): number {
    return Math.round(v / g) * g;
}

function cloneDeep<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class WarehouseCanvasService implements OnDestroy {

    private canvas!: Canvas;
    private container!: HTMLElement;
    private resizeObserver!: ResizeObserver;

    // Pan state
    private spaceDown = false;
    private isPanning = false;
    private lastPanPoint = { x: 0, y: 0 };

    // Draw state
    private isDrawing = false;
    private drawStart = { x: 0, y: 0 };
    private previewRect: Rect | null = null;
    private previewLine: Line | null = null;

    // History (undo/redo)
    private undoStack: WHistorySnapshot[] = [];
    private redoStack: WHistorySnapshot[] = [];

    // Clipboard (copy/paste)
    private clipboard: { racks: WRack[]; bins: WBin[]; walls: WWall[]; docks: WDockDoor[] } | null = null;

    // Alignment guides
    private guideLines: Line[] = [];

    // Grid lines (fabric objects)
    private gridObjects: FabricObject[] = [];

    // Ruler canvases
    private rulerHCanvas: HTMLCanvasElement | null = null;
    private rulerVCanvas: HTMLCanvasElement | null = null;

    // ── Signals ──────────────────────────────────────────────────────────────

    readonly racks      = signal<WRack[]>([]);
    readonly bins       = signal<WBin[]>([]);
    readonly walls      = signal<WWall[]>([]);
    readonly dockDoors  = signal<WDockDoor[]>([]);
    readonly zones      = signal<WZone[]>([]);
    readonly zoneAreas  = signal<WZoneArea[]>([]);

    readonly layoutName = signal<string>('Mi Almacén');
    readonly activeTool = signal<WTool>('select');
    readonly zoom       = signal<number>(1);
    readonly canUndo    = signal<boolean>(false);
    readonly canRedo    = signal<boolean>(false);

    readonly selectedRackId = signal<string | null>(null);
    readonly selectedBinId  = signal<string | null>(null);

    readonly gridVisible  = signal<boolean>(true);
    readonly rulerVisible = signal<boolean>(false);
    readonly searchQuery  = signal<string>('');
    readonly searchResults = signal<{ kind: string; id: string; label: string }[]>([]);

    readonly rackCount   = computed(() => this.racks().length);
    readonly binCount    = computed(() => this.bins().length);
    readonly zoneOptions = computed(() =>
        this.zones().map(z => ({ label: z.name, value: z.id }))
    );

    // ── Sync state ─────────────────────────────────────────────────────────────

    readonly syncing    = signal(false);
    readonly syncError  = signal<string | null>(null);

    // ── Event subjects (service → component) ─────────────────────────────────

    readonly rackDblClick$    = new Subject<WRack>();
    readonly binDblClick$     = new Subject<WBin>();
    readonly syncFailed$      = new Subject<string>();
    readonly rackGroupArea$   = new Subject<{ x: number; y: number; w: number; h: number }>();
    readonly zoneAreaDblClick$ = new Subject<WZoneArea>();

    private supabase = inject(SupabaseService);

    constructor(private ngZone: NgZone) {}

    // ─── Init ─────────────────────────────────────────────────────────────────

    initCanvas(canvasEl: HTMLCanvasElement, container: HTMLElement): void {
        this.container = container;

        this.canvas = new Canvas(canvasEl, {
            selection: true,
            preserveObjectStacking: true,
            stopContextMenu: true,
            backgroundColor: '#f0f2f5',
        } as any);

        this.resizeCanvas();

        this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
        this.resizeObserver.observe(container);

        this.setupEventListeners();

        // Always start with empty canvas — user can load via explicit action
        if (this.gridVisible()) {
            this.drawGrid();
        }
    }

    private resizeCanvas(): void {
        if (!this.canvas || !this.container) return;
        (this.canvas as any).setWidth(this.container.clientWidth);
        (this.canvas as any).setHeight(this.container.clientHeight);
        this.canvas.renderAll();
    }

    // ─── Tool ─────────────────────────────────────────────────────────────────

    setTool(tool: WTool): void {
        this.activeTool.set(tool);
        const isSelect = tool === 'select';
        const isPan    = tool === 'pan';
        (this.canvas as any).selection = isSelect;
        (this.canvas as any).defaultCursor = isPan ? 'grab' : isSelect ? 'default' : 'crosshair';
        this.canvas.getObjects().forEach(o => {
            const d = this.getWhData(o);
            if (d) {
                o.selectable = isSelect;
                o.evented    = isSelect;
            }
        });
        this.canvas.discardActiveObject();
        this.canvas.renderAll();
    }

    setSpaceDown(down: boolean): void {
        this.spaceDown = down;
        if (!down) this.isPanning = false;
    }

    // ─── Event Listeners ──────────────────────────────────────────────────────

    private setupEventListeners(): void {
        this.canvas.on('mouse:down',     (e: any) => this.onMouseDown(e));
        this.canvas.on('mouse:move',     (e: any) => this.onMouseMove(e));
        this.canvas.on('mouse:up',       (e: any) => this.onMouseUp(e));
        this.canvas.on('mouse:dblclick', (e: any) => this.onDblClick(e));
        this.canvas.on('mouse:wheel',    (e: any) => this.onWheel(e));
        this.canvas.on('object:moving',  (e: any) => this.onObjectMoving(e));
        this.canvas.on('object:scaling',  (e: any) => this.onObjectScaling(e));
        this.canvas.on('object:rotating', (e: any) => this.onObjectRotating(e));
        this.canvas.on('object:modified',(e: any) => this.onObjectModified(e));
        this.canvas.on('selection:created', (e: any) => this.onSelectionChanged(e));
        this.canvas.on('selection:updated', (e: any) => this.onSelectionChanged(e));
        this.canvas.on('selection:cleared', ()      => this.onSelectionCleared());
    }

    private getPointer(nativeEvent: MouseEvent): { x: number; y: number } {
        const p = (this.canvas as any).getPointer(nativeEvent) as Point;
        return { x: p.x, y: p.y };
    }

    private onMouseDown(e: any): void {
        // Pan via space, pan tool, or middle mouse button
        if (this.spaceDown || this.activeTool() === 'pan' || e.e.button === 1) {
            this.isPanning = true;
            this.lastPanPoint = { x: e.e.clientX, y: e.e.clientY };
            (this.canvas as any).defaultCursor = 'grabbing';
            e.e.preventDefault();
            return;
        }
        const tool = this.activeTool();
        if (tool === 'select' || e.target) return;

        const p = this.getPointer(e.e);
        this.isDrawing = true;
        this.drawStart = { x: snapV(p.x), y: snapV(p.y) };

        const colors: Record<string, { fill: string; stroke: string }> = {
            rack:      { fill: '#c8e6c9', stroke: '#2e7d32' },
            bin:       { fill: '#fff9c4', stroke: '#f9a825' },
            wall:      { fill: '#37474f', stroke: '#263238' },
            dockdoor:  { fill: '#ffcc80', stroke: '#e65100' },
            rackgroup: { fill: '#b3e5fc', stroke: '#0277bd' },
            zone:      { fill: 'rgba(124,58,237,0.08)', stroke: '#7c3aed' },
        };
        const c = colors[tool] ?? colors['rack'];

        // Walls and dock doors use a line preview; everything else uses a rect preview
        if (tool === 'wall' || tool === 'dockdoor') {
            const isWall = tool === 'wall';
            this.previewLine = new Line(
                [this.drawStart.x, this.drawStart.y, this.drawStart.x, this.drawStart.y],
                {
                    stroke: isWall ? '#9e9e9e' : '#e65100',
                    strokeWidth: isWall ? WALL_DEFAULT.h : DOCK_DEFAULT.h,
                    opacity: 0.6, selectable: false, evented: false,
                    strokeDashArray: [8, 4], strokeLineCap: 'butt',
                },
            );
            this.canvas.add(this.previewLine);
        } else {
            this.previewRect = new Rect({
                left: this.drawStart.x, top: this.drawStart.y,
                width: 0, height: 0,
                fill: c.fill, stroke: c.stroke, strokeWidth: 1.5,
                opacity: 0.5, selectable: false, evented: false,
                strokeDashArray: [6, 3],
            });
            this.canvas.add(this.previewRect);
        }
    }

    private onMouseMove(e: any): void {
        if (this.isPanning) {
            const dx = e.e.clientX - this.lastPanPoint.x;
            const dy = e.e.clientY - this.lastPanPoint.y;
            this.canvas.relativePan(new Point(dx, dy));
            this.lastPanPoint = { x: e.e.clientX, y: e.e.clientY };
            if (this.rulerVisible()) this.drawRulers();
            return;
        }
        if (!this.isDrawing) return;

        const p = this.getPointer(e.e);
        const ex = snapV(p.x), ey = snapV(p.y);

        if (this.previewLine) {
            // Snap to horizontal or vertical based on dominant axis
            const dx = Math.abs(ex - this.drawStart.x);
            const dy = Math.abs(ey - this.drawStart.y);
            const snapX2 = dx >= dy ? ex : this.drawStart.x;
            const snapY2 = dx >= dy ? this.drawStart.y : ey;
            this.previewLine.set({ x2: snapX2, y2: snapY2 });
        } else if (this.previewRect) {
            this.previewRect.set({
                left:   Math.min(ex, this.drawStart.x),
                top:    Math.min(ey, this.drawStart.y),
                width:  Math.abs(ex - this.drawStart.x),
                height: Math.abs(ey - this.drawStart.y),
            });
        } else {
            return;
        }
        this.canvas.renderAll();
    }

    private onMouseUp(e: any): void {
        if (this.isPanning) {
            this.isPanning = false;
            (this.canvas as any).defaultCursor = (this.spaceDown || this.activeTool() === 'pan') ? 'grab' : 'crosshair';
            return;
        }
        if (!this.isDrawing) return;
        this.isDrawing = false;

        const tool = this.activeTool();

        // ── Wall / Dock Door: line-based drawing (snapped to H or V) ──
        if (this.previewLine) {
            const x1 = this.drawStart.x;
            const y1 = this.drawStart.y;
            const p = this.getPointer(e.e);
            const rawX2 = snapV(p.x);
            const rawY2 = snapV(p.y);
            this.canvas.remove(this.previewLine);
            this.previewLine = null;

            const adx = Math.abs(rawX2 - x1);
            const ady = Math.abs(rawY2 - y1);
            const isHoriz = adx >= ady;
            const x2 = isHoriz ? rawX2 : x1;
            const y2 = isHoriz ? y1 : rawY2;

            const length = snapV(Math.abs(isHoriz ? x2 - x1 : y2 - y1));
            if (length < SNAP_GRID) { this.setTool('select'); return; }

            const angle = isHoriz ? 0 : 90;
            const startX = Math.min(x1, x2);
            const startY = Math.min(y1, y2);

            this.pushHistory();

            if (tool === 'dockdoor') {
                // Dock doors must be placed on a wall
                const midX = (x1 + x2) / 2;
                const midY = (y1 + y2) / 2;
                const wall = this.findWallAtPoint(midX, midY);
                if (!wall) {
                    this.undoStack.pop();
                    this.canUndo.set(this.undoStack.length > 0);
                    this.setTool('select');
                    return;
                }
                this.createDockDoor(startX, startY, length, DOCK_DEFAULT.h, angle);
            } else {
                this.createWall(startX, startY, length, WALL_DEFAULT.h, angle);
            }
            this.setTool('select');
            return;
        }

        if (!this.previewRect) return;

        const left   = this.previewRect.left ?? 0;
        const top    = this.previewRect.top  ?? 0;
        const width  = this.previewRect.width  ?? 0;
        const height = this.previewRect.height ?? 0;
        this.canvas.remove(this.previewRect);
        this.previewRect = null;

        // Rack Group tool: emit drawn area and open dialog (no element created)
        if (tool === 'rackgroup') {
            const w = width  < 100 ? 400 : width;
            const h = height < 100 ? 300 : height;
            this.setTool('select');
            this.ngZone.run(() => {
                this.rackGroupArea$.next({ x: left, y: top, w, h });
            });
            return;
        }

        // Zone area tool: draw a zone region with dashed border
        if (tool === 'zone') {
            const w = width  < 40 ? 200 : width;
            const h = height < 40 ? 150 : height;
            this.pushHistory();
            this.createZoneArea(left, top, w, h);
            this.setTool('select');
            return;
        }

        const defaults: Record<string, { w: number; h: number }> = {
            rack: RACK_DEFAULT, bin: BIN_DEFAULT,
        };
        const def = defaults[tool] ?? RACK_DEFAULT;
        const w = width  < 10 ? def.w : width;
        const h = height < 10 ? def.h : height;

        this.pushHistory();

        if (tool === 'rack') {
            this.createRack(left, top, w, h);
        } else if (tool === 'bin') {
            const parentRack = this.findRackAtPoint(left + w / 2, top + h / 2);
            if (!parentRack) {
                this.undoStack.pop();
                this.canUndo.set(this.undoStack.length > 0);
                return;
            }
            this.createBin(parentRack.id, left, top, w, h);
        }

        this.setTool('select');
    }

    private onDblClick(e: any): void {
        const obj = e.target as FabricObject | undefined;
        if (!obj) return;

        // Inline-edit dock door labels on double-click
        if ((obj as any)._isDockLabel) {
            this.startInlineLabelEdit(obj as FabricText, 'dock');
            return;
        }
        // Inline-edit rack labels on double-click
        if ((obj as any)._isRackLabel) {
            this.startInlineLabelEdit(obj as FabricText, 'rack');
            return;
        }

        const d = this.getWhData(obj);
        if (!d) return;

        this.ngZone.run(() => {
            if (d.kind === 'rack') {
                const rack = this.racks().find(r => r.id === d.id);
                if (rack) this.rackDblClick$.next(cloneDeep(rack));
            } else if (d.kind === 'bin') {
                const bin = this.bins().find(b => b.id === d.id);
                if (bin) this.binDblClick$.next(cloneDeep(bin));
            } else if (d.kind === 'zonearea') {
                const za = this.zoneAreas().find(z => z.id === d.id);
                if (za) this.zoneAreaDblClick$.next(cloneDeep(za));
            }
        });
    }

    /** Start inline text editing on a floating label (dock or rack) */
    private startInlineLabelEdit(labelObj: FabricText, kind: 'dock' | 'rack'): void {
        const name = (labelObj as any).name as string;
        // Extract id from name like "docklabel-xxx" or "racklabel-xxx"
        const id = name.replace(`${kind}label-`, '');

        // Create an HTML input overlay positioned on top of the label
        const vpt = this.canvas.viewportTransform!;
        const zoom = this.canvas.getZoom();
        const canvasEl = this.canvas.getElement();
        const rect = canvasEl.getBoundingClientRect();

        const labelLeft = (labelObj.left ?? 0) * zoom + vpt[4] + rect.left;
        const labelTop = (labelObj.top ?? 0) * zoom + vpt[5] + rect.top;

        const input = document.createElement('input');
        input.type = 'text';
        input.value = labelObj.text ?? '';
        Object.assign(input.style, {
            position: 'fixed',
            left: `${labelLeft}px`,
            top: `${labelTop}px`,
            fontSize: `${(labelObj.fontSize ?? 11) * zoom}px`,
            fontWeight: 'bold',
            fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
            color: labelObj.fill as string,
            background: 'white',
            border: '1px solid #94a3b8',
            borderRadius: '2px',
            padding: '1px 4px',
            outline: 'none',
            zIndex: '9999',
            minWidth: '40px',
        });

        document.body.appendChild(input);
        input.focus();
        input.select();

        const commit = () => {
            const newLabel = input.value.trim();
            if (newLabel && newLabel !== labelObj.text) {
                this.pushHistory();
                labelObj.set({ text: newLabel });
                if (kind === 'dock') {
                    this.dockDoors.update(ds => ds.map(d =>
                        d.id === id ? { ...d, label: newLabel } : d
                    ));
                } else {
                    this.racks.update(rs => rs.map(r =>
                        r.id === id ? { ...r, label: newLabel } : r
                    ));
                }
                this.canvas.renderAll();
                this.saveLayout();
            }
            input.remove();
        };

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (ev: KeyboardEvent) => {
            if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
            if (ev.key === 'Escape') { input.value = labelObj.text ?? ''; input.blur(); }
        });
    }

    private onObjectMoving(e: any): void {
        const obj = e.target as FabricObject;
        if (!obj) return;
        const d = this.getWhData(obj);

        // Multi-selection (ActiveSelection): sync all rack labels in the group
        if (!d) {
            this.showAlignmentGuides(obj);
            this.syncActiveSelectionLabels(obj);
            this.canvas.renderAll();
            return;
        }

        const L = snapV(obj.left ?? 0);
        const T = snapV(obj.top  ?? 0);
        const prev = (obj as any)._whPrevPos as { x: number; y: number } | undefined;

        if (d.kind === 'rack') {
            const dx = prev ? L - prev.x : 0;
            const dy = prev ? T - prev.y : 0;
            const rack = this.racks().find(r => r.id === d.id);
            if (rack && (dx !== 0 || dy !== 0)) {
                rack.binIds.forEach(binId => {
                    const binObj = this.findFabricByName(`bin-${binId}`);
                    if (binObj) {
                        binObj.set({
                            left: (binObj.left ?? 0) + dx,
                            top:  (binObj.top  ?? 0) + dy,
                        });
                        binObj.setCoords();
                    }
                });
            }
            // Sync floating label
            this.syncRackLabelPosition(d.id, L, T);
        } else if (d.kind === 'wall' || d.kind === 'dockdoor') {
            // Both use center origin — snap the logical START endpoint to grid
            const angle = obj.angle ?? 0;
            const isVert = Math.abs(angle % 180) === 90;
            const thick = d.kind === 'wall' ? WALL_DEFAULT.h : DOCK_DEFAULT.h;
            const renderLen = obj.width! * (obj.scaleX ?? 1);
            const halfLogical = (renderLen - thick) / 2;
            const cx = obj.left ?? 0;
            const cy = obj.top ?? 0;
            const startX = isVert ? cx : cx - halfLogical;
            const startY = isVert ? cy - halfLogical : cy;
            const snX = snapV(startX);
            const snY = snapV(startY);
            obj.set({
                left: isVert ? snX : snX + halfLogical,
                top:  isVert ? snY + halfLogical : snY,
            });
            // Sync dock door floating label
            if (d.kind === 'dockdoor') {
                const dockStartX = isVert ? snX : snX;
                const dockStartY = isVert ? snY : snY;
                this.syncDockLabelPosition(d.id, dockStartX, dockStartY, angle);
            }
        } else if (d.kind === 'bin') {
            const rack = this.racks().find(r => r.id === d.rackId);
            if (rack) {
                const bw = obj.getScaledWidth();
                const bh = obj.getScaledHeight();
                const PAD = BIN_PAD;
                obj.set({
                    left: Math.max(rack.x + PAD, Math.min(rack.x + rack.w - bw - PAD, obj.left ?? 0)),
                    top:  Math.max(rack.y + RACK_LABEL_H + PAD, Math.min(rack.y + RACK_LABEL_H + rack.h - bh - PAD, obj.top ?? 0)),
                });
            }
        }

        // Walls/dock doors already snapped above (center origin); everything else snaps left/top
        if (d.kind !== 'wall' && d.kind !== 'dockdoor') {
            obj.set({ left: snapV(obj.left ?? 0), top: snapV(obj.top ?? 0) });
        }
        (obj as any)._whPrevPos = { x: obj.left ?? 0, y: obj.top ?? 0 };

        // Show alignment guides
        this.showAlignmentGuides(obj);

        this.canvas.renderAll();
    }

    /** Shift-snap rotation to 90° increments */
    private onObjectRotating(e: any): void {
        const target = e.target as FabricObject;
        if (!target) return;
        if (e.e?.shiftKey) {
            const angle = target.angle ?? 0;
            target.angle = Math.round(angle / 90) * 90;
        }
    }

    /**
     * Counter-scale ALL children inside Groups during drag-resize so
     * text stays crisp and rounded corners / strokes don't distort.
     * Handles both single objects and multi-selection (ActiveSelection).
     * The full rebuild happens on object:modified (mouse release).
     */
    private onObjectScaling(e: any): void {
        const target = e.target as FabricObject;
        if (!target) return;

        const d = this.getWhData(target);

        const corner: string = e.transform?.corner ?? '';

        if (d) {
            // Single object scaling
            this.counterScaleSingle(target as Group, d, corner);
            // Keep floating label in sync while scaling
            if (d.kind === 'rack') {
                this.syncRackLabelPosition(d.id, target.left ?? 0, target.top ?? 0);
            }
        } else {
            // Multi-selection (ActiveSelection) — counter-scale each child
            const selSx = target.scaleX ?? 1;
            const selSy = target.scaleY ?? 1;
            if (Math.abs(selSx - 1) < 0.001 && Math.abs(selSy - 1) < 0.001) return;

            const objects = (target as Group).getObjects?.() ?? [];
            for (const obj of objects) {
                const cd = this.getWhData(obj);
                if (!cd || cd.kind === 'wall') continue;

                const group = obj as Group;
                const children = group.getObjects();
                const origRx = cd.kind === 'rack' ? 4 : cd.kind === 'bin' ? 2 : 3;
                const origStroke = cd.kind === 'bin' ? 1 : 1.5;

                // Counter-scale bg rect properties
                if (children[0]) {
                    children[0].set({
                        rx: origRx / selSx,
                        ry: origRx / selSy,
                        strokeWidth: origStroke / Math.max(selSx, selSy),
                    });
                }
                // Counter-scale text and other children
                for (let i = 1; i < children.length; i++) {
                    children[i].set({ scaleX: 1 / selSx, scaleY: 1 / selSy });
                }
                (group as any).dirty = true;
            }
        }

        // Show alignment guides during scaling (same as during move)
        this.showAlignmentGuides(target);

        this.canvas.requestRenderAll();
    }

    /** Counter-scale a single Group element during scaling */
    private counterScaleSingle(group: Group, d: FabricWhData, corner: string = ''): void {
        if (d.kind === 'wall' || d.kind === 'dockdoor') return;

        let sx = group.scaleX ?? 1;
        let sy = group.scaleY ?? 1;

        // Clamp rack so it can't shrink smaller than its bins (edge-based)
        if (d.kind === 'rack') {
            const rack = this.racks().find(r => r.id === d.id);
            if (rack && rack.binIds.length > 0) {
                const bounds = this.getBinAbsoluteBounds(rack);
                if (bounds) {
                    const PAD = BIN_PAD;
                    const isFromTop   = corner === 'mt' || corner === 'tl' || corner === 'tr';
                    const isFromLeft  = corner === 'ml' || corner === 'tl' || corner === 'bl';

                    // Fixed edges come from the data model (the edge that doesn't move)
                    const fixedRight  = rack.x + rack.w;
                    const fixedBottom = rack.y + rack.h;

                    // Current edges from Fabric
                    let newLeft   = group.left ?? rack.x;
                    let newTop    = group.top  ?? rack.y;
                    let newRight  = isFromLeft  ? fixedRight  : newLeft + group.width!  * sx;
                    let newBottom = isFromTop   ? fixedBottom : newTop  + group.height! * sy;

                    // Clamp so all bins stay inside
                    if (newLeft   > bounds.minX - PAD) newLeft   = bounds.minX - PAD;
                    if (newTop    > bounds.minY - PAD) newTop    = bounds.minY - PAD;
                    if (newRight  < bounds.maxX + PAD) newRight  = bounds.maxX + PAD;
                    if (newBottom < bounds.maxY + PAD) newBottom = bounds.maxY + PAD;

                    sx = (newRight  - newLeft) / group.width!;
                    sy = (newBottom - newTop)  / group.height!;

                    group.set({ left: newLeft, top: newTop });
                    group.scaleX = sx;
                    group.scaleY = sy;
                }
            }
        }

        // Clamp bin so it can't exceed its parent rack from any edge
        if (d.kind === 'bin' && d.rackId) {
            const rack = this.racks().find(r => r.id === d.rackId);
            if (rack) {
                const PAD = BIN_PAD;
                const rL = rack.x + PAD;
                const rT = rack.y + RACK_LABEL_H + PAD;
                const rR = rack.x + rack.w - PAD;
                const rB = rack.y + RACK_LABEL_H + rack.h - PAD;

                let binL = group.left ?? 0;
                let binT = group.top ?? 0;
                let binR = binL + group.width! * sx;
                let binB = binT + group.height! * sy;

                if (binL < rL) { binL = rL; group.set({ left: rL }); }
                if (binT < rT) { binT = rT; group.set({ top: rT }); }
                if (binR > rR) binR = rR;
                if (binB > rB) binB = rB;

                sx = Math.max(0.1, (binR - binL) / group.width!);
                sy = Math.max(0.1, (binB - binT) / group.height!);
                group.scaleX = sx;
                group.scaleY = sy;
            }
        }

        if (Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001) return;

        const children = group.getObjects();

        // Background rect (index 0): counter-scale rounded corners and stroke
        const bgRect = children[0];
        if (bgRect) {
            const origRx = d.kind === 'zonearea' ? 6 : d.kind === 'rack' ? 4 : d.kind === 'bin' ? 2 : 3;
            const origStroke = d.kind === 'zonearea' ? 2 : d.kind === 'bin' ? 1 : 1.5;
            bgRect.set({
                rx: origRx / sx,
                ry: origRx / sy,
                strokeWidth: origStroke / Math.max(sx, sy),
            });
            // Counter-scale dash array for zone areas
            if (d.kind === 'zonearea') {
                const scale = Math.max(sx, sy);
                (bgRect as any).strokeDashArray = [10 / scale, 6 / scale];
            }
        }

        // Text and other children (index 1+): counter-scale to keep crisp
        for (let i = 1; i < children.length; i++) {
            children[i].set({ scaleX: 1 / sx, scaleY: 1 / sy });
        }

        (group as any).dirty = true;
    }

    private onObjectModified(e: any): void {
        this.clearGuides();

        const target = e.target as FabricObject;
        if (!target) return;

        const d = this.getWhData(target);
        if (d) {
            // Single object
            this.applySingleModified(target, d);
        } else {
            // Multi-selection (ActiveSelection):
            // Collect IDs, then defer discard + rebuild so Fabric finishes
            // its internal event processing before we modify the selection.
            const items: { kind: string; id: string; rackId?: string }[] = [];
            const objects = (target as Group).getObjects?.() ?? [];
            for (const obj of objects) {
                const cd = this.getWhData(obj);
                if (cd) items.push({ kind: cd.kind, id: cd.id, rackId: cd.rackId });
            }

            queueMicrotask(() => {
                // Discard decomposes the ActiveSelection → absolute coords
                this.canvas.discardActiveObject();

                // Process each object with correct absolute position/scale
                for (const item of items) {
                    const prefix = item.kind === 'dockdoor' ? 'dock' : item.kind === 'zonearea' ? 'zonearea' : item.kind;
                    const obj = this.findFabricByName(`${prefix}-${item.id}`);
                    if (!obj) continue;
                    const cd = this.getWhData(obj);
                    if (!cd) continue;
                    this.applySingleModified(obj, cd);
                }

                this.pushHistory();
                this.canvas.renderAll();
            });
            return;
        }

        this.pushHistory();
        this.canvas.renderAll();
    }

    /** Apply modified state (move/resize) to a single element */
    private applySingleModified(obj: FabricObject, d: FabricWhData): void {
        const L = snapV(obj.left ?? 0);
        const T = snapV(obj.top  ?? 0);
        // Use child rect dimensions (index 0) to avoid stroke-width accumulation
        const children = (obj as Group).getObjects?.();
        const bgRect = children?.[0];
        const W = snapV(bgRect ? bgRect.width! * (obj.scaleX ?? 1) : obj.getScaledWidth());
        const H = snapV(bgRect ? bgRect.height! * (obj.scaleY ?? 1) : obj.getScaledHeight());

        const wasScaled = Math.abs((obj.scaleX ?? 1) - 1) > 0.001
                       || Math.abs((obj.scaleY ?? 1) - 1) > 0.001;

        if (d.kind === 'rack') {
            const rack = this.racks().find(r => r.id === d.id);
            let rackW = W;
            let rackH = Math.max(20, H);
            // Enforce minimum size based on contained bins
            if (rack && rack.binIds.length > 0) {
                const bounds = this.getBinAbsoluteBounds(rack);
                if (bounds) {
                    const PAD = BIN_PAD;
                    rackW = Math.max(rackW, bounds.maxX + PAD - L);
                    rackH = Math.max(rackH, bounds.maxY + PAD - T);
                    // Also ensure rack doesn't start below/right of bins
                    // (handled by clamping L/T isn't needed here since we snap)
                }
            }
            this.racks.update(rs => rs.map(r =>
                r.id === d.id ? { ...r, x: L, y: T, w: rackW, h: rackH } : r
            ));
            const updatedRack = this.racks().find(r => r.id === d.id)!;

            if (wasScaled) {
                queueMicrotask(() => {
                    this.removeFabricByName(`racklabel-${d.id}`);
                    this.removeFabricByName(`rack-${d.id}`);
                    const newGroup = this.buildRackFabric(updatedRack);
                    this.canvas.add(newGroup);
                    // Bring bins above the rebuilt rack so they remain visible
                    updatedRack.binIds.forEach(binId => {
                        this.clampBinToRack(binId, updatedRack);
                        const binObj = this.findFabricByName(`bin-${binId}`);
                        if (binObj) this.canvas.bringObjectToFront(binObj);
                    });
                    this.bringWallsAndDocksToFront();
                    this.canvas.renderAll();
                });
            } else {
                obj.set({ left: L, top: T });
                obj.setCoords();
                this.syncRackLabelPosition(d.id, L, T);
                updatedRack.binIds.forEach(binId => this.clampBinToRack(binId, updatedRack));
            }
        } else if (d.kind === 'bin') {
            const rack = d.rackId ? this.racks().find(r => r.id === d.rackId) : null;
            let bL = L, bT = T, bW = W, bH = H;
            if (rack) {
                const PAD = BIN_PAD;
                const rL = rack.x + PAD;
                const rT = rack.y + RACK_LABEL_H + PAD;
                const rR = rack.x + rack.w - PAD;
                const rB = rack.y + RACK_LABEL_H + rack.h - PAD;
                bL = Math.max(rL, bL);
                bT = Math.max(rT, bT);
                bW = Math.min(bW, rR - bL);
                bH = Math.min(bH, rB - bT);
            }

            this.bins.update(bs => bs.map(b =>
                b.id === d.id ? { ...b, x: bL, y: bT, w: bW, h: bH } : b
            ));
            if (wasScaled) {
                queueMicrotask(() => {
                    this.removeFabricByName(`bin-${d.id}`);
                    const bin = this.bins().find(b => b.id === d.id);
                    if (bin) this.canvas.add(this.buildBinFabric(bin));
                    this.bringWallsAndDocksToFront();
                    this.canvas.renderAll();
                });
            } else {
                obj.set({ left: bL, top: bT });
                obj.setCoords();
            }
        } else if (d.kind === 'wall') {
            const wallAngle = obj.angle ?? 0;
            // Subtract the render extension to get the logical wall length
            const renderW = obj.width! * (obj.scaleX ?? 1);
            const wallW = snapV(renderW - WALL_DEFAULT.h);
            // obj uses center origin — convert to grid start point
            const cx = snapV(obj.left ?? 0);
            const cy = snapV(obj.top ?? 0);
            const isVert = Math.abs(wallAngle % 180) === 90;
            const wallX = isVert ? cx : snapV(cx - wallW / 2);
            const wallY = isVert ? snapV(cy - wallW / 2) : cy;
            this.walls.update(ws => ws.map(w =>
                w.id === d.id ? { ...w, x: wallX, y: wallY, w: wallW, h: WALL_DEFAULT.h, angle: wallAngle } : w
            ));
            if (wasScaled) {
                queueMicrotask(() => {
                    this.removeFabricByName(`wall-${d.id}`);
                    this.canvas.add(this.buildWallFabric(this.walls().find(w => w.id === d.id)!));
                    this.canvas.renderAll();
                });
            } else {
                obj.setCoords();
            }
        } else if (d.kind === 'dockdoor') {
            const dockAngle = obj.angle ?? 0;
            const renderW = obj.width! * (obj.scaleX ?? 1);
            const dockW = snapV(renderW - DOCK_DEFAULT.h);
            const cx = snapV(obj.left ?? 0);
            const cy = snapV(obj.top ?? 0);
            const isVert = Math.abs(dockAngle % 180) === 90;
            const dockX = isVert ? cx : snapV(cx - dockW / 2);
            const dockY = isVert ? snapV(cy - dockW / 2) : cy;
            this.dockDoors.update(ds => ds.map(dd =>
                dd.id === d.id ? { ...dd, x: dockX, y: dockY, w: dockW, h: DOCK_DEFAULT.h, angle: dockAngle } : dd
            ));
            if (wasScaled) {
                queueMicrotask(() => {
                    this.removeFabricByName(`docklabel-${d.id}`);
                    this.removeFabricByName(`dock-${d.id}`);
                    const door = this.dockDoors().find(dd => dd.id === d.id)!;
                    this.canvas.add(this.buildDockFabric(door));
                    this.canvas.renderAll();
                });
            } else {
                obj.setCoords();
                this.syncDockLabelPosition(d.id, dockX, dockY, dockAngle);
            }
        } else if (d.kind === 'zonearea') {
            const zaW = snapV(W);
            const zaH = snapV(H);
            this.zoneAreas.update(zas => zas.map(za =>
                za.id === d.id ? { ...za, x: L, y: T, w: zaW, h: zaH } : za
            ));
            if (wasScaled) {
                queueMicrotask(() => {
                    this.removeFabricByName(`zonearea-${d.id}`);
                    const za = this.zoneAreas().find(z => z.id === d.id);
                    if (za) {
                        const newGroup = this.buildZoneAreaFabric(za);
                        this.canvas.add(newGroup);
                        this.canvas.sendObjectToBack(newGroup);
                        this.gridObjects.forEach(o => this.canvas.sendObjectToBack(o));
                        this.bringWallsAndDocksToFront();
                    }
                    this.canvas.renderAll();
                });
            } else {
                obj.set({ left: L, top: T });
                obj.setCoords();
            }
        }
    }

    private onSelectionChanged(e: any): void {
        const obj = (e.selected?.[0]) as FabricObject | undefined;
        if (!obj) return;
        const d = this.getWhData(obj);
        if (!d) return;

        (obj as any)._whPrevPos = { x: snapV(obj.left ?? 0), y: snapV(obj.top ?? 0) };

        this.ngZone.run(() => {
            if (d.kind === 'rack') {
                this.selectedRackId.set(d.id);
                this.selectedBinId.set(null);
            } else if (d.kind === 'bin') {
                this.selectedBinId.set(d.id);
                this.selectedRackId.set(null);
            } else {
                this.selectedRackId.set(null);
                this.selectedBinId.set(null);
            }
        });
    }

    private onSelectionCleared(): void {
        this.ngZone.run(() => {
            this.selectedRackId.set(null);
            this.selectedBinId.set(null);
        });
    }

    private onWheel(e: any): void {
        const we = e.e as WheelEvent;
        we.preventDefault();
        let z = this.canvas.getZoom();
        z *= (we.deltaY > 0 ? 0.95 : 1.05);
        z = Math.max(0.15, Math.min(4, z));
        this.canvas.zoomToPoint(new Point(we.offsetX, we.offsetY), z);
        this.ngZone.run(() => this.zoom.set(z));
        if (this.rulerVisible()) this.drawRulers();
    }

    // ─── DB Sync helper ─────────────────────────────────────────────────────

    private async dbSync(label: string, fn: () => Promise<void>): Promise<void> {
        this.syncing.set(true);
        this.syncError.set(null);
        try {
            await fn();
        } catch (err: any) {
            const msg = `Error al sincronizar ${label}: ${err?.message ?? err}`;
            console.error(msg, err);
            this.syncError.set(msg);
            this.ngZone.run(() => this.syncFailed$.next(msg));
        } finally {
            this.syncing.set(false);
        }
    }

    private rackToLocationPayload(rack: WRack): any {
        const zoneName = rack.zoneId
            ? (this.zones().find(z => z.id === rack.zoneId)?.name ?? 'DESIGNER')
            : 'DESIGNER';
        return {
            zone: rack.zoneId ? zoneName : (rack.category ? zoneName : 'DESIGNER'),
            category: rack.category || 'REGULAR',
            type: rack.type || 'Floor-F',
            area: rack.area || this.layoutName() || 'ALMACEN',
            row: rack.row || '1',
            bay: rack.bay || '1',
            level: rack.level || 'A',
            storage_name: rack.storageName || rack.label,
            custom_name: rack.customName ?? true,
            content: rack.content || '',
            active: rack.active,
        };
    }

    // ─── CRUD: Rack ───────────────────────────────────────────────────────────

    createRack(x: number, y: number, w = RACK_DEFAULT.w, h = RACK_DEFAULT.h): WRack {
        const rack: WRack = {
            id: uid('rack'), label: this.nextRackLabel(),
            x, y, w, h, active: true, binIds: [],
        };
        this.racks.update(rs => [...rs, rack]);
        this.canvas.add(this.buildRackFabric(rack));
        this.bringWallsAndDocksToFront();
        this.canvas.renderAll();

        // Sync to Supabase
        this.dbSync('crear rack', async () => {
            const result = await this.supabase.createLocation(this.rackToLocationPayload(rack));
            if (result?.id) {
                this.racks.update(rs => rs.map(r =>
                    r.id === rack.id ? { ...r, linkedId: result.id } : r
                ));
            }
        });

        return rack;
    }

    updateRack(id: string, patch: Partial<WRack>): void {
        this.racks.update(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r));
        const rack = this.racks().find(r => r.id === id);
        if (rack) this.syncRackToCanvas(rack);

        // Sync to Supabase
        if (rack?.linkedId) {
            this.dbSync('actualizar rack', async () => {
                const payload: any = {};
                if (patch.label !== undefined || patch.storageName !== undefined)
                    payload.storage_name = patch.storageName ?? patch.label;
                if (patch.active !== undefined) payload.active = patch.active;
                if (patch.zoneId !== undefined) {
                    const zoneName = patch.zoneId
                        ? (this.zones().find(z => z.id === patch.zoneId)?.name ?? 'DESIGNER')
                        : 'DESIGNER';
                    payload.zone = zoneName;
                }
                if (patch.category !== undefined) payload.category = patch.category;
                if (patch.type !== undefined) payload.type = patch.type;
                if (patch.area !== undefined) payload.area = patch.area;
                if (patch.row !== undefined) payload.row = patch.row;
                if (patch.bay !== undefined) payload.bay = patch.bay;
                if (patch.level !== undefined) payload.level = patch.level;
                if (patch.customName !== undefined) payload.custom_name = patch.customName;
                if (patch.content !== undefined) payload.content = patch.content;
                if (Object.keys(payload).length > 0) {
                    await this.supabase.updateLocation(rack.linkedId!, payload);
                }
            });
        }
    }

    deleteRack(id: string): void {
        const rack = this.racks().find(r => r.id === id);
        if (!rack) return;
        this.pushHistory();

        // Collect linkedIds of bins to delete from DB
        const binLinkedIds = rack.binIds
            .map(binId => this.bins().find(b => b.id === binId)?.linkedId)
            .filter((lid): lid is string => !!lid);
        const rackLinkedId = rack.linkedId;

        rack.binIds.forEach(binId => this.removeFabricByName(`bin-${binId}`));
        this.removeFabricByName(`racklabel-${id}`);
        this.removeFabricByName(`rack-${id}`);
        this.racks.update(rs => rs.filter(r => r.id !== id));
        this.bins.update(bs => bs.filter(b => b.rackId !== id));
        this.selectedRackId.set(null);
        this.canvas.renderAll();

        // Sync to Supabase
        if (rackLinkedId) {
            this.dbSync('eliminar rack', async () => {
                for (const blid of binLinkedIds) {
                    await this.supabase.deleteBin(blid).catch(() => {});
                }
                await this.supabase.deleteLocation(rackLinkedId);
            });
        }
    }

    // ─── CRUD: Bin ────────────────────────────────────────────────────────────

    createBin(rackId: string, x: number, y: number, w = BIN_DEFAULT.w, h = BIN_DEFAULT.h): WBin | null {
        const rack = this.racks().find(r => r.id === rackId);
        if (!rack) return null;

        // Clamp size and position within rack with uniform padding
        const PAD = BIN_PAD;
        const rL = rack.x + PAD;
        const rT = rack.y + RACK_LABEL_H + PAD;
        const rR = rack.x + rack.w - PAD;
        const rB = rack.y + RACK_LABEL_H + rack.h - PAD;
        const cw = snapV(Math.min(w, rR - rL));
        const ch = snapV(Math.min(h, rB - rT));
        const cx = snapV(Math.max(rL, Math.min(rR - cw, x)));
        const cy = snapV(Math.max(rT, Math.min(rB - ch, y)));

        const bin: WBin = {
            id: uid('bin'), rackId,
            label: this.nextBinLabel(),
            status: 'available', active: true,
            x: cx, y: cy, w: cw, h: ch,
        };

        this.bins.update(bs => [...bs, bin]);
        this.racks.update(rs => rs.map(r =>
            r.id === rackId ? { ...r, binIds: [...r.binIds, bin.id] } : r
        ));
        this.canvas.add(this.buildBinFabric(bin));
        this.bringWallsAndDocksToFront();
        this.canvas.renderAll();

        // Sync to Supabase
        if (rack.linkedId) {
            this.dbSync('crear bin', async () => {
                const result = await this.supabase.createBin({
                    location_id: rack.linkedId,
                    bin_name: bin.label,
                    capacity: null,
                    current_stock: 0,
                    active: bin.active,
                });
                if (result?.id) {
                    this.bins.update(bs => bs.map(b =>
                        b.id === bin.id ? { ...b, linkedId: result.id } : b
                    ));
                }
            });
        }

        return bin;
    }

    updateBin(id: string, patch: Partial<WBin>): void {
        this.bins.update(bs => bs.map(b => b.id === id ? { ...b, ...patch } : b));
        const bin = this.bins().find(b => b.id === id);
        if (bin) this.syncBinToCanvas(bin);

        // Sync to Supabase
        if (bin?.linkedId) {
            this.dbSync('actualizar bin', async () => {
                const payload: any = {};
                if (patch.label !== undefined) payload.bin_name = patch.label;
                if (patch.active !== undefined) payload.active = patch.active;
                if (Object.keys(payload).length > 0) {
                    await this.supabase.updateBin(bin.linkedId!, payload);
                }
            });
        }
    }

    deleteBin(id: string): void {
        const bin = this.bins().find(b => b.id === id);
        if (!bin) return;
        this.pushHistory();
        const binLinkedId = bin.linkedId;

        this.removeFabricByName(`bin-${id}`);
        this.bins.update(bs => bs.filter(b => b.id !== id));
        this.racks.update(rs => rs.map(r =>
            r.id === bin.rackId
                ? { ...r, binIds: r.binIds.filter(bid => bid !== id) }
                : r
        ));
        this.selectedBinId.set(null);
        this.canvas.renderAll();

        // Sync to Supabase
        if (binLinkedId) {
            this.dbSync('eliminar bin', async () => {
                await this.supabase.deleteBin(binLinkedId);
            });
        }
    }

    // ─── CRUD: Wall ───────────────────────────────────────────────────────────

    createWall(x: number, y: number, w = WALL_DEFAULT.w, h = WALL_DEFAULT.h, angle = 0): WWall {
        const wall: WWall = { id: uid('wall'), x, y, w, h, angle };
        this.walls.update(ws => [...ws, wall]);
        this.canvas.add(this.buildWallFabric(wall));
        this.canvas.renderAll();
        return wall;
    }

    deleteWall(id: string): void {
        this.pushHistory();
        this.removeFabricByName(`wall-${id}`);
        this.walls.update(ws => ws.filter(w => w.id !== id));
        this.canvas.renderAll();
    }

    // ─── CRUD: DockDoor ───────────────────────────────────────────────────────

    createDockDoor(x: number, y: number, w = DOCK_DEFAULT.w, h = DOCK_DEFAULT.h, angle = 0): WDockDoor {
        const n = this.dockDoors().length + 1;
        const door: WDockDoor = { id: uid('dock'), label: `Dock ${n}`, x, y, w, h, angle };
        this.dockDoors.update(ds => [...ds, door]);
        this.canvas.add(this.buildDockFabric(door));
        this.canvas.renderAll();
        return door;
    }

    deleteDockDoor(id: string): void {
        this.pushHistory();
        this.removeFabricByName(`docklabel-${id}`);
        this.removeFabricByName(`dock-${id}`);
        this.dockDoors.update(ds => ds.filter(d => d.id !== id));
        this.canvas.renderAll();
    }

    // ─── Zones ────────────────────────────────────────────────────────────────

    addZone(name: string, color: string): WZone {
        const zone: WZone = { id: uid('zone'), name, color: color.replace('#', '') };
        this.zones.update(zs => [...zs, zone]);
        return zone;
    }

    updateZone(id: string, patch: Partial<WZone>): void {
        this.zones.update(zs => zs.map(z => z.id === id ? { ...z, ...patch } : z));
        this.racks().filter(r => r.zoneId === id).forEach(r => this.syncRackToCanvas(r));
    }

    deleteZone(id: string): void {
        this.zones.update(zs => zs.filter(z => z.id !== id));
        this.racks.update(rs => rs.map(r => r.zoneId === id ? { ...r, zoneId: undefined } : r));
        this.racks().filter(r => !r.zoneId).forEach(r => this.syncRackToCanvas(r));
        // Also unassign zone areas that used this zone
        this.zoneAreas.update(zas => zas.map(za =>
            za.zoneId === id ? { ...za, zoneId: undefined } : za
        ));
        this.zoneAreas().filter(za => !za.zoneId).forEach(za => this.syncZoneAreaToCanvas(za));
    }

    // ─── CRUD: ZoneArea ──────────────────────────────────────────────────────

    createZoneArea(x: number, y: number, w: number, h: number): WZoneArea {
        const za: WZoneArea = { id: uid('za'), x, y, w, h };
        this.zoneAreas.update(zas => [...zas, za]);
        this.syncZoneAreaToCanvas(za);
        return za;
    }

    assignZoneToArea(areaId: string, zoneId: string | undefined): void {
        this.pushHistory();
        this.zoneAreas.update(zas => zas.map(za =>
            za.id === areaId ? { ...za, zoneId } : za
        ));
        const za = this.zoneAreas().find(z => z.id === areaId);
        if (za) this.syncZoneAreaToCanvas(za);
        this.saveLayout();
    }

    deleteZoneArea(id: string): void {
        this.pushHistory();
        this.removeFabricByName(`zonearea-${id}`);
        this.zoneAreas.update(zas => zas.filter(za => za.id !== id));
        this.canvas.renderAll();
    }

    private syncZoneAreaToCanvas(za: WZoneArea): void {
        this.removeFabricByName(`zonearea-${za.id}`);
        const fab = this.buildZoneAreaFabric(za);
        this.canvas.add(fab);
        // Zone areas behind everything (except grid)
        this.canvas.sendObjectToBack(fab);
        this.gridObjects.forEach(o => this.canvas.sendObjectToBack(o));
        this.bringWallsAndDocksToFront();
        this.canvas.renderAll();
    }

    // ─── Group Generator ──────────────────────────────────────────────────────

    generateRackGroup(params: WRackGroupParams): void {
        this.pushHistory();

        const newRacks: WRack[] = [];
        const newBins: WBin[] = [];
        // Map: local rackId → array of bins created for it
        const rackBinsMap = new Map<string, WBin[]>();

        for (let i = 0; i < params.count; i++) {
            const rx = params.axis === 'x'
                ? params.startX + i * (params.rackW + params.gap)
                : params.startX;
            const ry = params.axis === 'y'
                ? params.startY + i * (params.rackH + params.gap)
                : params.startY;

            const rackNum   = params.startIndex + i;
            const rackLabel = `${params.prefix}-${String(rackNum).padStart(3, '0')}`;
            const rackId    = uid('rack');

            const rack: WRack = {
                id: rackId, label: rackLabel,
                x: rx, y: ry, w: params.rackW, h: params.rackH,
                zoneId: params.zoneId, active: true, binIds: [],
            };

            const rackLocalBins: WBin[] = [];

            if (params.binsPerRack > 0) {
                const PAD  = BIN_PAD;
                const binH = Math.max(20, params.rackH - PAD * 2);
                const totalBinW = params.rackW - PAD * (params.binsPerRack + 1);
                const binW = Math.max(20, Math.floor(totalBinW / params.binsPerRack));

                for (let j = 0; j < params.binsPerRack; j++) {
                    const bx = rx + PAD + j * (binW + PAD);
                    if (bx + binW > rx + params.rackW - PAD) break;

                    const binLabel = `${params.binPrefix}-${String(rackNum).padStart(3, '0')}-${String(j + 1).padStart(2, '0')}`;
                    const bin: WBin = {
                        id: uid('bin'), rackId,
                        label: binLabel, status: 'available', active: true,
                        x: bx, y: ry + RACK_LABEL_H + PAD, w: binW, h: binH,
                    };
                    rack.binIds.push(bin.id);
                    rackLocalBins.push(bin);
                    newBins.push(bin);
                }
            }

            newRacks.push(rack);
            rackBinsMap.set(rackId, rackLocalBins);
        }

        // Batch update signals
        this.racks.update(rs => [...rs, ...newRacks]);
        this.bins.update(bs => [...bs, ...newBins]);

        // Add Fabric objects
        newRacks.forEach(r => this.canvas.add(this.buildRackFabric(r)));
        newBins.forEach(b => this.canvas.add(this.buildBinFabric(b)));
        this.bringWallsAndDocksToFront();

        this.canvas.renderAll();
        this.saveLayout();

        // Sync to Supabase — create locations, then bulk-create bins
        this.dbSync('generar serie', async () => {
            for (const rack of newRacks) {
                const locResult = await this.supabase.createLocation(this.rackToLocationPayload(rack));
                if (locResult?.id) {
                    this.racks.update(rs => rs.map(r =>
                        r.id === rack.id ? { ...r, linkedId: locResult.id } : r
                    ));

                    // Create bins for this rack
                    const rackBins = rackBinsMap.get(rack.id) ?? [];
                    if (rackBins.length > 0) {
                        const binPayloads = rackBins.map(b => ({
                            location_id: locResult.id,
                            bin_name: b.label,
                            capacity: null,
                            current_stock: 0,
                            active: true,
                        }));
                        const binResults = await this.supabase.createBins(binPayloads);
                        if (binResults?.length) {
                            this.bins.update(bs => bs.map(b => {
                                const idx = rackBins.findIndex(rb => rb.id === b.id);
                                if (idx >= 0 && binResults[idx]?.id) {
                                    return { ...b, linkedId: binResults[idx].id };
                                }
                                return b;
                            }));
                        }
                    }
                }
            }
            this.saveLayout();
        });
    }

    // ─── Selected element helpers ─────────────────────────────────────────────

    deleteSelected(): void {
        const objects = this.canvas.getActiveObjects();
        if (!objects.length) return;

        this.pushHistory();
        this.canvas.discardActiveObject();

        for (const obj of objects) {
            const d = this.getWhData(obj);
            if (!d) continue;

            if (d.kind === 'rack')          this.deleteRack(d.id);
            else if (d.kind === 'bin')      this.deleteBin(d.id);
            else if (d.kind === 'wall')     this.deleteWall(d.id);
            else if (d.kind === 'dockdoor') this.deleteDockDoor(d.id);
            else if (d.kind === 'zonearea') this.deleteZoneArea(d.id);
        }
    }

    getSelectedRack(): WRack | null {
        const id = this.selectedRackId();
        return id ? (this.racks().find(r => r.id === id) ?? null) : null;
    }

    getSelectedBin(): WBin | null {
        const id = this.selectedBinId();
        return id ? (this.bins().find(b => b.id === id) ?? null) : null;
    }

    // ─── Undo / Redo ──────────────────────────────────────────────────────────

    undo(): void {
        if (!this.undoStack.length) return;
        // Save current state to redo stack
        this.redoStack.push(this.currentSnapshot());
        const snap = this.undoStack.pop()!;
        this.canUndo.set(this.undoStack.length > 0);
        this.canRedo.set(true);
        this.restoreSnapshot(snap);
    }

    redo(): void {
        if (!this.redoStack.length) return;
        // Save current state to undo stack
        this.undoStack.push(this.currentSnapshot());
        const snap = this.redoStack.pop()!;
        this.canUndo.set(true);
        this.canRedo.set(this.redoStack.length > 0);
        this.restoreSnapshot(snap);
    }

    pushHistoryPublic(): void { this.pushHistory(); }

    private pushHistory(): void {
        this.undoStack.push(this.currentSnapshot());
        if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
        // New action invalidates redo stack
        this.redoStack.length = 0;
        this.canUndo.set(true);
        this.canRedo.set(false);
    }

    private currentSnapshot(): WHistorySnapshot {
        return cloneDeep({
            racks: this.racks(), bins: this.bins(),
            walls: this.walls(), dockDoors: this.dockDoors(),
            zoneAreas: this.zoneAreas(),
        });
    }

    private restoreSnapshot(snap: WHistorySnapshot): void {
        this.canvas.clear();
        (this.canvas as any).backgroundColor = '#f0f2f5';

        this.walls.set(snap.walls);
        this.dockDoors.set(snap.dockDoors);
        this.racks.set(snap.racks);
        this.bins.set(snap.bins);
        this.zoneAreas.set(snap.zoneAreas ?? []);

        // Zone areas first (behind everything)
        (snap.zoneAreas ?? []).forEach(za => {
            this.canvas.add(this.buildZoneAreaFabric(za));
        });
        snap.racks.forEach(r    => this.canvas.add(this.buildRackFabric(r)));
        snap.bins.forEach(b     => this.canvas.add(this.buildBinFabric(b)));
        snap.walls.forEach(w    => this.canvas.add(this.buildWallFabric(w)));
        snap.dockDoors.forEach(d => this.canvas.add(this.buildDockFabric(d)));

        // Redraw grid if it was visible (canvas.clear() removes everything)
        if (this.gridVisible()) {
            this.drawGrid();
        }

        this.canvas.renderAll();
    }

    // ─── Viewport ─────────────────────────────────────────────────────────────

    zoomIn(): void {
        const w = (this.canvas as any).width  as number;
        const h = (this.canvas as any).height as number;
        const z = Math.min(4, this.canvas.getZoom() * 1.2);
        this.canvas.zoomToPoint(new Point(w / 2, h / 2), z);
        this.zoom.set(z);
        if (this.rulerVisible()) this.drawRulers();
    }

    zoomOut(): void {
        const w = (this.canvas as any).width  as number;
        const h = (this.canvas as any).height as number;
        const z = Math.max(0.15, this.canvas.getZoom() / 1.2);
        this.canvas.zoomToPoint(new Point(w / 2, h / 2), z);
        this.zoom.set(z);
        if (this.rulerVisible()) this.drawRulers();
    }

    resetView(): void {
        this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        this.zoom.set(1);
        this.canvas.renderAll();
        if (this.rulerVisible()) this.drawRulers();
    }

    // ─── Persistence ──────────────────────────────────────────────────────────

    private buildLayoutData(): WLayout {
        return {
            version: 2, name: this.layoutName(),
            zones: this.zones(), zoneAreas: this.zoneAreas(),
            racks: this.racks(), bins: this.bins(),
            walls: this.walls(), dockDoors: this.dockDoors(),
        };
    }

    saveLayout(): void {
        const layout = this.buildLayoutData();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));

        // Also persist to Supabase
        this.dbSync('guardar layout', async () => {
            await this.supabase.saveWarehouseLayout(layout.name, layout);
        });
    }

    loadFromStorage(): void {
        // Try local storage first (instant)
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            try {
                const data = JSON.parse(raw) as WLayout;
                if (data.version === 2) {
                    this.applyLayout(data);
                }
            } catch { /* ignore */ }
        }

        // Then try to load from Supabase (async, overrides local if newer)
        this.loadFromSupabase();
    }

    private async loadFromSupabase(): Promise<void> {
        try {
            const layouts = await this.supabase.getWarehouseLayouts();
            if (!layouts?.length) return;

            // Load the most recent layout
            const latest = await this.supabase.getWarehouseLayout(layouts[0].id);
            if (!latest?.layout_data) return;

            const data = latest.layout_data as WLayout;
            if (data.version !== 2) return;

            this.ngZone.run(() => {
                this.applyLayout(data);
                // Also update local storage
                localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            });
        } catch (err) {
            console.warn('No se pudo cargar layout desde Supabase, usando local:', err);
        }
    }

    private applyLayout(data: WLayout): void {
        this.layoutName.set(data.name ?? 'Mi Almacén');
        this.zones.set(data.zones ?? []);
        this.restoreSnapshot({
            racks: data.racks ?? [],
            bins:  data.bins  ?? [],
            walls: data.walls ?? [],
            dockDoors: data.dockDoors ?? [],
            zoneAreas: data.zoneAreas ?? [],
        });
    }

    clearCanvas(): void {
        this.pushHistory();

        // Collect linked IDs before clearing
        const binLinkedIds = this.bins().map(b => b.linkedId).filter((id): id is string => !!id);
        const rackLinkedIds = this.racks().map(r => r.linkedId).filter((id): id is string => !!id);

        this.canvas.clear();
        (this.canvas as any).backgroundColor = '#f0f2f5';
        this.racks.set([]);
        this.bins.set([]);
        this.walls.set([]);
        this.dockDoors.set([]);
        this.zoneAreas.set([]);
        if (this.gridVisible()) this.drawGrid();
        this.canvas.renderAll();

        // Sync to Supabase — delete bins first (FK), then locations
        if (binLinkedIds.length > 0 || rackLinkedIds.length > 0) {
            this.dbSync('limpiar canvas', async () => {
                for (const bid of binLinkedIds) {
                    await this.supabase.deleteBin(bid).catch(() => {});
                }
                for (const lid of rackLinkedIds) {
                    await this.supabase.deleteLocation(lid).catch(() => {});
                }
            });
        }
    }

    // ─── Fabric builders ──────────────────────────────────────────────────────

    private buildRackFabric(rack: WRack): Group {
        const fill   = this.resolveRackColor(rack);
        const stroke = this.darken(fill);

        const rect = new Rect({
            left: 0, top: 0, width: rack.w, height: rack.h,
            fill, stroke, strokeWidth: 2,
            rx: 4, ry: 4, originX: 'left', originY: 'top',
        });

        const group = new Group([rect], {
            left: rack.x, top: rack.y,
            lockRotation: true,
            lockScalingFlip: true,
            hasControls: true, hasBorders: true,
            objectCaching: false,
        });
        group.setControlsVisibility({ mtr: false });
        this.setWhData(group, { kind: 'rack', id: rack.id });
        (group as any).name = `rack-${rack.id}`;
        (group as any)._whPrevPos = { x: rack.x, y: rack.y };

        // Floating label (separate from group so selection border only wraps the rect)
        const label = this.buildRackLabel(rack);
        queueMicrotask(() => {
            this.canvas.add(label);
        });

        return group;
    }

    private buildRackLabel(rack: WRack): FabricText {
        const fill = this.resolveRackColor(rack);
        const label = new FabricText(rack.label, {
            left: rack.x + 2, top: rack.y - RACK_LABEL_OFFSET_Y,
            fontSize: 11,
            fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
            fontWeight: 'bold',
            fill: this.textColor(fill),
            originX: 'left', originY: 'top',
            selectable: false, evented: true,
            hoverCursor: 'text',
        });
        (label as any).name = `racklabel-${rack.id}`;
        (label as any)._isRackLabel = true;
        return label;
    }

    private syncRackLabelPosition(rackId: string, x: number, y: number): void {
        const label = this.findFabricByName(`racklabel-${rackId}`);
        if (label) {
            label.set({ left: x + 2, top: y - RACK_LABEL_OFFSET_Y });
            label.setCoords();
        }
    }

    /** Sync floating labels for all racks inside an ActiveSelection during drag */
    /** Sync floating labels for all racks inside an ActiveSelection during drag */
    private syncActiveSelectionLabels(activeSelection: FabricObject): void {
        const sel = activeSelection as any;
        if (!sel.getObjects) return;
        for (const child of sel.getObjects() as FabricObject[]) {
            const cd = this.getWhData(child);
            if (!cd || cd.kind !== 'rack') continue;
            // getBoundingRect returns screen coords — convert back to canvas coords
            const br = child.getBoundingRect();
            const zoom = this.canvas.getZoom();
            const vpt = this.canvas.viewportTransform!;
            const absLeft = (br.left - vpt[4]) / zoom;
            const absTop  = (br.top  - vpt[5]) / zoom;
            this.syncRackLabelPosition(cd.id, absLeft, absTop);
        }
    }

    private buildBinFabric(bin: WBin): Group {
        const fillMap: Record<string, string> = {
            available: '#fff9c4', occupied: '#c8e6c9',
            blocked: '#ffcdd2', maintenance: '#ffe0b2',
        };
        const fill = fillMap[bin.status] ?? '#fff9c4';

        const rect = new Rect({
            left: 0, top: 0, width: bin.w, height: bin.h,
            fill, stroke: '#f9a825', strokeWidth: 2,
            rx: 2, ry: 2, originX: 'left', originY: 'top',
        });

        const text = new FabricText(bin.label, {
            left: 3, top: 3, fontSize: 9,
            fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
            fill: '#5d4037',
            originX: 'left', originY: 'top',
            selectable: false, evented: false,
        });

        const items: FabricObject[] = [rect, text];

        // Capacity bar
        if (bin.capacity && bin.capacity > 0) {
            const ratio = Math.min(1, Math.max(0, (bin.currentStock ?? 0) / bin.capacity));
            const barH = 4;
            const barW = bin.w - 6;
            const barY = bin.h - barH - 2;
            const barBg = new Rect({
                left: 3, top: barY, width: barW, height: barH,
                fill: '#e0e0e0', rx: 1, ry: 1,
                originX: 'left', originY: 'top',
                selectable: false, evented: false,
            });
            const barColor = ratio < 0.5 ? '#4caf50' : ratio < 0.8 ? '#ff9800' : '#f44336';
            const barFill = new Rect({
                left: 3, top: barY, width: Math.max(1, barW * ratio), height: barH,
                fill: barColor, rx: 1, ry: 1,
                originX: 'left', originY: 'top',
                selectable: false, evented: false,
            });
            items.push(barBg, barFill);
        }

        const group = new Group(items, {
            left: bin.x, top: bin.y,
            lockRotation: true,
            lockScalingFlip: true,
            hasControls: true, hasBorders: true,
            objectCaching: false,
        });
        group.setControlsVisibility({ mtr: false });
        this.setWhData(group, { kind: 'bin', id: bin.id, rackId: bin.rackId });
        (group as any).name = `bin-${bin.id}`;
        return group;
    }

    private buildWallFabric(wall: WWall): Rect {
        const angle = wall.angle ?? 0;
        const isVert = Math.abs(angle % 180) === 90;
        // Extend by half-thickness on each end so perpendicular walls overlap at corners
        const ext = WALL_DEFAULT.h;   // half on each side = full h added to length
        const renderW = wall.w + ext;
        const cx = isVert ? wall.x : wall.x + wall.w / 2;
        const cy = isVert ? wall.y + wall.w / 2 : wall.y;
        const r = new Rect({
            left: cx, top: cy,
            originX: 'center', originY: 'center',
            width: renderW, height: WALL_DEFAULT.h,
            fill: '#9e9e9e', stroke: '#757575', strokeWidth: 0,
            angle,
            lockScalingFlip: true,
            lockScalingY: true,
            hasControls: true, hasBorders: true,
        });
        r.setControlsVisibility({
            mt: false, mb: false, tl: false, tr: false, bl: false, br: false,
            ml: true, mr: true, mtr: true,
        });
        this.setWhData(r, { kind: 'wall', id: wall.id });
        (r as any).name = `wall-${wall.id}`;
        return r;
    }

    private buildDockFabric(door: WDockDoor): Rect {
        const angle = door.angle ?? 0;
        const isVert = Math.abs(angle % 180) === 90;
        const ext = DOCK_DEFAULT.h;
        const renderW = door.w + ext;
        const cx = isVert ? door.x : door.x + door.w / 2;
        const cy = isVert ? door.y + door.w / 2 : door.y;
        const r = new Rect({
            left: cx, top: cy,
            originX: 'center', originY: 'center',
            width: renderW, height: DOCK_DEFAULT.h,
            fill: '#e65100', stroke: '#bf360c', strokeWidth: 0,
            angle,
            lockScalingFlip: true,
            lockScalingY: true,
            hasControls: true, hasBorders: true,
        });
        r.setControlsVisibility({
            mt: false, mb: false, tl: false, tr: false, bl: false, br: false,
            ml: true, mr: true, mtr: true,
        });
        this.setWhData(r, { kind: 'dockdoor', id: door.id });
        (r as any).name = `dock-${door.id}`;

        // Floating label
        const label = this.buildDockLabel(door);
        queueMicrotask(() => this.canvas.add(label));

        return r;
    }

    private buildDockLabel(door: WDockDoor): FabricText {
        const angle = door.angle ?? 0;
        const isVert = Math.abs(angle % 180) === 90;
        const lx = isVert ? door.x + DOCK_DEFAULT.h / 2 + 4 : door.x + 2;
        const ly = isVert ? door.y + 2 : door.y - 22;
        const label = new FabricText(door.label, {
            left: lx, top: ly,
            fontSize: 10,
            fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
            fontWeight: 'bold',
            fill: '#bf360c',
            originX: 'left', originY: 'top',
            selectable: false, evented: true,
            hoverCursor: 'text',
        });
        (label as any).name = `docklabel-${door.id}`;
        (label as any)._isDockLabel = true;
        return label;
    }

    private syncDockLabelPosition(dockId: string, x: number, y: number, angle: number): void {
        const label = this.findFabricByName(`docklabel-${dockId}`);
        if (!label) return;
        const isVert = Math.abs(angle % 180) === 90;
        label.set({
            left: isVert ? x + DOCK_DEFAULT.h / 2 + 4 : x + 2,
            top:  isVert ? y + 2 : y - 22,
        });
        label.setCoords();
    }

    // ─── Zone Area Fabric ──────────────────────────────────────────────────────

    private buildZoneAreaFabric(za: WZoneArea): Group {
        const zone = za.zoneId ? this.zones().find(z => z.id === za.zoneId) : null;
        const fillColor = zone ? `#${zone.color.replace('#', '')}` : 'transparent';
        const strokeColor = zone ? this.darken(`#${zone.color.replace('#', '')}`) : '#9ca3af';

        const rect = new Rect({
            left: 0, top: 0,
            width: za.w, height: za.h,
            fill: zone ? fillColor + '20' : 'rgba(156,163,175,0.05)',
            stroke: strokeColor,
            strokeWidth: 2,
            strokeDashArray: [10, 6],
            rx: 6, ry: 6,
            originX: 'left', originY: 'top',
        });

        const items: FabricObject[] = [rect];

        // Centered label inside the group
        if (zone) {
            const label = new FabricText(zone.name, {
                left: za.w / 2, top: za.h / 2,
                fontSize: 14,
                fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
                fontWeight: 'bold',
                fill: this.darken(`#${zone.color.replace('#', '')}`) + '90',
                originX: 'center', originY: 'center',
                selectable: false, evented: false,
            });
            items.push(label as any);
        }

        const group = new Group(items, {
            left: za.x, top: za.y,
            lockRotation: true,
            lockScalingFlip: true,
            hasControls: true, hasBorders: true,
            objectCaching: false,
        });
        group.setControlsVisibility({ mtr: false });
        this.setWhData(group, { kind: 'zonearea', id: za.id });
        (group as any).name = `zonearea-${za.id}`;
        (group as any)._whPrevPos = { x: za.x, y: za.y };
        return group;
    }


    // ─── Canvas sync ──────────────────────────────────────────────────────────

    private syncRackToCanvas(rack: WRack): void {
        const group = this.findFabricByName(`rack-${rack.id}`) as Group | null;
        if (!group) return;

        const fill   = this.resolveRackColor(rack);
        const stroke = this.darken(fill);
        const items  = group.getObjects();
        const rectObj = items[0] as Rect;

        if (rectObj) rectObj.set({ fill, stroke });

        // Update floating label
        const label = this.findFabricByName(`racklabel-${rack.id}`);
        if (label) (label as FabricText).set({ text: rack.label, fill: this.textColor(fill) });

        (group as any).dirty = true;
        this.canvas.renderAll();
    }

    private syncBinToCanvas(bin: WBin): void {
        // Rebuild the entire group to handle capacity bar changes
        this.removeFabricByName(`bin-${bin.id}`);
        this.canvas.add(this.buildBinFabric(bin));
        this.bringWallsAndDocksToFront();
        this.canvas.renderAll();
    }

    /**
     * Compute the minimum width & height a rack needs to fully contain its bins.
     * Uses live Fabric canvas positions (not the data model) so it stays correct
     * even when the rack has been moved but not yet committed.
     * rackX/rackY allow overriding the rack origin (useful during scaling when
     * the group's left/top may differ from the data model).
     */
    /** Get the absolute bounding box of all bins inside a rack */
    private getBinAbsoluteBounds(rack: WRack): { minX: number; minY: number; maxX: number; maxY: number } | null {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let found = false;
        for (const binId of rack.binIds) {
            const binObj = this.findFabricByName(`bin-${binId}`);
            if (!binObj) continue;
            found = true;
            const bx = binObj.left ?? 0;
            const by = binObj.top ?? 0;
            minX = Math.min(minX, bx);
            minY = Math.min(minY, by);
            maxX = Math.max(maxX, bx + binObj.getScaledWidth());
            maxY = Math.max(maxY, by + binObj.getScaledHeight());
        }
        return found ? { minX, minY, maxX, maxY } : null;
    }



    private clampBinToRack(binId: string, rack: WRack): void {
        const obj = this.findFabricByName(`bin-${binId}`);
        if (!obj) return;

        // Uniform padding on all sides inside the rack rect
        const PAD = BIN_PAD;
        const rTop  = rack.y + RACK_LABEL_H + PAD;
        const rBot  = rack.y + RACK_LABEL_H + rack.h - PAD;
        const rLeft = rack.x + PAD;
        const rRight = rack.x + rack.w - PAD;

        // Clamp bin SIZE
        const maxW = rRight - rLeft;
        const maxH = rBot - rTop;
        let bw = obj.getScaledWidth();
        let bh = obj.getScaledHeight();

        if (bw > maxW || bh > maxH) {
            bw = Math.min(bw, maxW);
            bh = Math.min(bh, maxH);
            const sx = bw / obj.width!;
            const sy = bh / obj.height!;
            obj.set({ scaleX: sx, scaleY: sy });
            this.bins.update(bs => bs.map(b =>
                b.id === binId ? { ...b, w: bw, h: bh } : b
            ));
        }

        // Clamp bin POSITION — uniform padding on all sides
        obj.set({
            left: Math.max(rLeft, Math.min(rRight - bw, obj.left ?? 0)),
            top:  Math.max(rTop,  Math.min(rBot - bh,   obj.top  ?? 0)),
        });
        obj.setCoords();
    }

    /** Ensure walls & dock doors always render above racks/bins/zones */
    private bringWallsAndDocksToFront(): void {
        const objs = this.canvas.getObjects();
        for (const o of objs) {
            const d = this.getWhData(o);
            if (d?.kind === 'wall' || d?.kind === 'dockdoor' || (o as any)._isDockLabel) {
                this.canvas.bringObjectToFront(o);
            }
        }
    }

    private removeFabricByName(name: string): void {
        const obj = this.findFabricByName(name);
        if (obj) this.canvas.remove(obj);
    }

    private findFabricByName(name: string): FabricObject | null {
        return this.canvas.getObjects().find(o => (o as any).name === name) ?? null;
    }

    private findRackAtPoint(x: number, y: number): WRack | null {
        return this.racks().find(r =>
            x >= r.x && x <= r.x + r.w
            && y >= r.y + RACK_LABEL_H && y <= r.y + RACK_LABEL_H + r.h
        ) ?? null;
    }

    private findWallAtPoint(x: number, y: number): WWall | null {
        const tolerance = WALL_DEFAULT.h * 2; // generous hit area
        return this.walls().find(w => {
            const angle = w.angle ?? 0;
            const isVert = Math.abs(angle % 180) === 90;
            if (isVert) {
                return Math.abs(x - w.x) <= tolerance
                    && y >= w.y && y <= w.y + w.w;
            } else {
                return Math.abs(y - w.y) <= tolerance
                    && x >= w.x && x <= w.x + w.w;
            }
        }) ?? null;
    }

    private getWhData(obj: FabricObject): FabricWhData | null {
        return (obj as any)._whData ?? null;
    }

    private setWhData(obj: FabricObject, data: FabricWhData): void {
        (obj as any)._whData = data;
    }

    // ─── Color helpers ────────────────────────────────────────────────────────

    private resolveRackColor(rack: WRack): string {
        if (rack.zoneId) {
            const zone = this.zones().find(z => z.id === rack.zoneId);
            if (zone) return '#' + zone.color.replace('#', '');
        }
        return '#c8e6c9';
    }

    private darken(hex: string): string {
        const h = hex.replace('#', '');
        const r = Math.max(0, Math.round(parseInt(h.slice(0, 2), 16) * 0.65));
        const g = Math.max(0, Math.round(parseInt(h.slice(2, 4), 16) * 0.65));
        const b = Math.max(0, Math.round(parseInt(h.slice(4, 6), 16) * 0.65));
        return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
    }

    private textColor(bgHex: string): string {
        const h = bgHex.replace('#', '');
        const lum = (0.299 * parseInt(h.slice(0,2),16) +
                     0.587 * parseInt(h.slice(2,4),16) +
                     0.114 * parseInt(h.slice(4,6),16)) / 255;
        return lum > 0.5 ? '#1b5e20' : '#e8f5e9';
    }

    // ─── Label counters ───────────────────────────────────────────────────────

    private nextRackLabel(): string {
        const maxIdx = this.racks().reduce((max, r) => {
            const m = r.label.match(/LOC-(\d+)/);
            return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 0);
        return `LOC-${String(maxIdx + 1).padStart(3, '0')}`;
    }

    private nextBinLabel(): string {
        const maxIdx = this.bins().reduce((max, b) => {
            const m = b.label.match(/BIN-(\d+)/);
            return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 0);
        return `BIN-${String(maxIdx + 1).padStart(3, '0')}`;
    }

    // ─── Copy / Paste ─────────────────────────────────────────────────────────

    copy(): void {
        const active = this.canvas.getActiveObjects();
        if (!active.length) return;

        const copiedRacks: WRack[] = [];
        const copiedBins: WBin[] = [];
        const copiedWalls: WWall[] = [];
        const copiedDocks: WDockDoor[] = [];

        for (const obj of active) {
            const d = this.getWhData(obj);
            if (!d) continue;
            if (d.kind === 'rack') {
                const rack = this.racks().find(r => r.id === d.id);
                if (rack) {
                    copiedRacks.push(cloneDeep(rack));
                    // Also copy child bins
                    rack.binIds.forEach(bid => {
                        const bin = this.bins().find(b => b.id === bid);
                        if (bin) copiedBins.push(cloneDeep(bin));
                    });
                }
            } else if (d.kind === 'bin') {
                // Only copy standalone-selected bins (not already included via rack)
                if (!copiedBins.find(b => b.id === d.id)) {
                    const bin = this.bins().find(b => b.id === d.id);
                    if (bin) copiedBins.push(cloneDeep(bin));
                }
            } else if (d.kind === 'wall') {
                const wall = this.walls().find(w => w.id === d.id);
                if (wall) copiedWalls.push(cloneDeep(wall));
            } else if (d.kind === 'dockdoor') {
                const dock = this.dockDoors().find(dd => dd.id === d.id);
                if (dock) copiedDocks.push(cloneDeep(dock));
            }
        }

        if (copiedRacks.length || copiedBins.length || copiedWalls.length || copiedDocks.length) {
            this.clipboard = { racks: copiedRacks, bins: copiedBins, walls: copiedWalls, docks: copiedDocks };
        }
    }

    paste(): void {
        if (!this.clipboard) return;
        this.pushHistory();

        const OFFSET = 40; // px offset so paste doesn't overlap
        const idMap = new Map<string, string>(); // old id → new id

        const newRacks: WRack[] = [];
        const newBins: WBin[] = [];

        // Paste racks — assign consecutive labels
        for (const src of this.clipboard.racks) {
            const newId = uid('rack');
            idMap.set(src.id, newId);
            const rack: WRack = {
                ...cloneDeep(src),
                id: newId,
                label: this.nextRackLabel(),
                x: src.x + OFFSET, y: src.y + OFFSET,
                linkedId: undefined, // don't copy DB link
                binIds: [],
            };
            // Temporarily add to signal so nextRackLabel() increments for the next one
            this.racks.update(rs => [...rs, rack]);
            newRacks.push(rack);
        }
        // Remove the temporarily added racks (they'll be batch-added below)
        if (newRacks.length) {
            const newIds = new Set(newRacks.map(r => r.id));
            this.racks.update(rs => rs.filter(r => !newIds.has(r.id)));
        }

        // Paste bins — assign consecutive labels
        for (const src of this.clipboard.bins) {
            const newRackId = idMap.get(src.rackId);
            // If rack was also copied, bin goes into the new rack;
            // otherwise it's a standalone bin copy staying in its original rack
            const targetRackId = newRackId ?? src.rackId;

            const newBinId = uid('bin');
            const bin: WBin = {
                ...cloneDeep(src),
                id: newBinId,
                label: this.nextBinLabel(),
                rackId: targetRackId,
                x: src.x + OFFSET, y: src.y + OFFSET,
                linkedId: undefined,
            };

            // Clamp standalone bins within their parent rack
            if (!newRackId) {
                const rack = this.racks().find(r => r.id === targetRackId);
                if (rack) {
                    const PAD = BIN_PAD;
                    const rL = rack.x + PAD, rT = rack.y + RACK_LABEL_H + PAD;
                    const rR = rack.x + rack.w - PAD, rB = rack.y + RACK_LABEL_H + rack.h - PAD;
                    bin.x = Math.max(rL, Math.min(rR - bin.w, bin.x));
                    bin.y = Math.max(rT, Math.min(rB - bin.h, bin.y));
                }
            }

            // Temporarily add to signal so nextBinLabel() increments
            this.bins.update(bs => [...bs, bin]);
            newBins.push(bin);

            if (newRackId) {
                const rack = newRacks.find(r => r.id === newRackId);
                if (rack) rack.binIds.push(newBinId);
            } else {
                // Add to the existing rack's binIds
                this.racks.update(rs => rs.map(r =>
                    r.id === targetRackId ? { ...r, binIds: [...r.binIds, newBinId] } : r
                ));
            }
        }
        // Remove temporarily added bins (they'll be batch-added below)
        if (newBins.length) {
            const newIds = new Set(newBins.map(b => b.id));
            this.bins.update(bs => bs.filter(b => !newIds.has(b.id)));
            // Also revert standalone bin additions to rack binIds
            const standaloneBinIds = new Set(
                this.clipboard.bins
                    .filter(src => !idMap.has(src.rackId))
                    .map(src => src.rackId)
            );
            if (standaloneBinIds.size) {
                this.racks.update(rs => rs.map(r =>
                    standaloneBinIds.has(r.id)
                        ? { ...r, binIds: r.binIds.filter(bid => !newIds.has(bid)) }
                        : r
                ));
            }
        }

        // Paste walls
        const newWalls: WWall[] = this.clipboard.walls.map(src => ({
            ...cloneDeep(src),
            id: uid('wall'),
            x: src.x + OFFSET, y: src.y + OFFSET,
        }));

        // Paste dock doors
        const newDocks: WDockDoor[] = this.clipboard.docks.map(src => ({
            ...cloneDeep(src),
            id: uid('dock'),
            x: src.x + OFFSET, y: src.y + OFFSET,
        }));

        // Batch update signals
        if (newRacks.length) this.racks.update(rs => [...rs, ...newRacks]);
        if (newBins.length)  this.bins.update(bs => [...bs, ...newBins]);
        if (newWalls.length) this.walls.update(ws => [...ws, ...newWalls]);
        if (newDocks.length) this.dockDoors.update(ds => [...ds, ...newDocks]);

        // Add standalone pasted bins to their existing parent rack's binIds
        const standalonePastedBins = newBins.filter(b => !idMap.has(b.rackId) || idMap.get(b.rackId) !== b.rackId);
        for (const bin of newBins) {
            if (!idMap.has(bin.rackId)) {
                // This is a standalone bin — add to existing rack
                this.racks.update(rs => rs.map(r =>
                    r.id === bin.rackId && !r.binIds.includes(bin.id)
                        ? { ...r, binIds: [...r.binIds, bin.id] }
                        : r
                ));
            }
        }

        // Add fabric objects
        newRacks.forEach(r => this.canvas.add(this.buildRackFabric(r)));
        newBins.forEach(b  => this.canvas.add(this.buildBinFabric(b)));
        newWalls.forEach(w => this.canvas.add(this.buildWallFabric(w)));
        newDocks.forEach(d => this.canvas.add(this.buildDockFabric(d)));

        this.canvas.renderAll();

        // Sync pasted racks/bins to Supabase
        if (newRacks.length) {
            this.dbSync('pegar elementos', async () => {
                for (const rack of newRacks) {
                    const locResult = await this.supabase.createLocation(this.rackToLocationPayload(rack));
                    if (locResult?.id) {
                        this.racks.update(rs => rs.map(r =>
                            r.id === rack.id ? { ...r, linkedId: locResult.id } : r
                        ));
                        const rackBins = newBins.filter(b => b.rackId === rack.id);
                        if (rackBins.length) {
                            const binPayloads = rackBins.map(b => ({
                                location_id: locResult.id,
                                bin_name: b.label,
                                capacity: null,
                                current_stock: 0,
                                active: b.active,
                            }));
                            const binResults = await this.supabase.createBins(binPayloads);
                            if (binResults?.length) {
                                this.bins.update(bs => bs.map(b => {
                                    const idx = rackBins.findIndex(rb => rb.id === b.id);
                                    if (idx >= 0 && binResults[idx]?.id) {
                                        return { ...b, linkedId: binResults[idx].id };
                                    }
                                    return b;
                                }));
                            }
                        }
                    }
                }
                this.saveLayout();
            });
        }
    }

    hasClipboard(): boolean {
        return this.clipboard !== null;
    }

    // ─── Alignment Guides ────────────────────────────────────────────────────

    private clearGuides(): void {
        this.guideLines.forEach(l => this.canvas.remove(l));
        this.guideLines = [];
    }

    private addGuideLine(x1: number, y1: number, x2: number, y2: number): void {
        const line = new Line([x1, y1, x2, y2], {
            stroke: '#f43f5e', strokeWidth: 1, strokeDashArray: [4, 3],
            selectable: false, evented: false, opacity: 0.8,
            excludeFromExport: true,
        } as any);
        (line as any)._isGuide = true;
        this.guideLines.push(line);
        this.canvas.add(line);
    }

    /** Get bounding edges (left, top, right, bottom, centerX, centerY) for any object,
     *  accounting for center-origin walls */
    private getObjEdges(obj: FabricObject): { l: number; t: number; r: number; b: number; cx: number; cy: number } {
        const d = this.getWhData(obj);
        if (d?.kind === 'wall' || d?.kind === 'dockdoor') {
            // Both use originX/Y = center and may be rotated
            const angle = obj.angle ?? 0;
            const isVert = Math.abs(angle % 180) === 90;
            const thick = d.kind === 'wall' ? WALL_DEFAULT.h : DOCK_DEFAULT.h;
            const renderLen = obj.width! * (obj.scaleX ?? 1);
            const halfLen = (renderLen - thick) / 2;
            const halfH = thick / 2;
            const cx = obj.left ?? 0;
            const cy = obj.top ?? 0;
            if (isVert) {
                return { l: cx - halfH, t: cy - halfLen, r: cx + halfH, b: cy + halfLen, cx, cy };
            } else {
                return { l: cx - halfLen, t: cy - halfH, r: cx + halfLen, b: cy + halfH, cx, cy };
            }
        }
        const l = obj.left ?? 0;
        const t = obj.top ?? 0;
        const w = obj.getScaledWidth();
        const h = obj.getScaledHeight();
        return { l, t, r: l + w, b: t + h, cx: l + w / 2, cy: t + h / 2 };
    }

    private showAlignmentGuides(movingObj: FabricObject): void {
        this.clearGuides();

        const m = this.getObjEdges(movingObj);

        const canvasW = 5000;
        const canvasH = 5000;

        // Collect IDs of objects being moved (for multi-selection exclusion)
        const movingIds = new Set<string>();
        const movingD = this.getWhData(movingObj);
        if (movingD) {
            movingIds.add(movingD.id);
        } else {
            const children = (movingObj as Group).getObjects?.() ?? [];
            for (const c of children) {
                const cd = this.getWhData(c);
                if (cd) movingIds.add(cd.id);
            }
        }

        for (const obj of this.canvas.getObjects()) {
            if (obj === movingObj) continue;
            const d = this.getWhData(obj);
            if (!d) continue;
            if ((obj as any)._isGuide) continue;
            if (movingIds.has(d.id)) continue;

            const o = this.getObjEdges(obj);

            // Vertical alignment (left, center, right)
            if (Math.abs(m.l - o.l) < ALIGN_THRESHOLD) this.addGuideLine(o.l, -canvasH, o.l, canvasH);
            if (Math.abs(m.cx - o.cx) < ALIGN_THRESHOLD) this.addGuideLine(o.cx, -canvasH, o.cx, canvasH);
            if (Math.abs(m.r - o.r) < ALIGN_THRESHOLD) this.addGuideLine(o.r, -canvasH, o.r, canvasH);
            if (Math.abs(m.l - o.r) < ALIGN_THRESHOLD) this.addGuideLine(o.r, -canvasH, o.r, canvasH);
            if (Math.abs(m.r - o.l) < ALIGN_THRESHOLD) this.addGuideLine(o.l, -canvasH, o.l, canvasH);

            // Horizontal alignment (top, center, bottom)
            if (Math.abs(m.t - o.t) < ALIGN_THRESHOLD) this.addGuideLine(-canvasW, o.t, canvasW, o.t);
            if (Math.abs(m.cy - o.cy) < ALIGN_THRESHOLD) this.addGuideLine(-canvasW, o.cy, canvasW, o.cy);
            if (Math.abs(m.b - o.b) < ALIGN_THRESHOLD) this.addGuideLine(-canvasW, o.b, canvasW, o.b);
            if (Math.abs(m.t - o.b) < ALIGN_THRESHOLD) this.addGuideLine(-canvasW, o.b, canvasW, o.b);
            if (Math.abs(m.b - o.t) < ALIGN_THRESHOLD) this.addGuideLine(-canvasW, o.t, canvasW, o.t);
        }
    }

    // ─── Grid ────────────────────────────────────────────────────────────────

    toggleGrid(): void {
        const show = !this.gridVisible();
        this.gridVisible.set(show);
        if (show) {
            this.drawGrid();
        } else {
            this.removeGrid();
        }
    }

    private drawGrid(): void {
        this.removeGrid();
        const size = 4000; // large enough for panning
        for (let x = -size; x <= size; x += SNAP_GRID) {
            const line = new Line([x, -size, x, size], {
                stroke: GRID_COLOR, strokeWidth: 0.5, opacity: GRID_OPACITY,
                selectable: false, evented: false, excludeFromExport: true,
            } as any);
            (line as any)._isGrid = true;
            this.gridObjects.push(line);
            this.canvas.add(line);
        }
        for (let y = -size; y <= size; y += SNAP_GRID) {
            const line = new Line([-size, y, size, y], {
                stroke: GRID_COLOR, strokeWidth: 0.5, opacity: GRID_OPACITY,
                selectable: false, evented: false, excludeFromExport: true,
            } as any);
            (line as any)._isGrid = true;
            this.gridObjects.push(line);
            this.canvas.add(line);
        }
        // Send grid to back
        this.gridObjects.forEach(o => this.canvas.sendObjectToBack(o));
        this.canvas.renderAll();
    }

    private removeGrid(): void {
        this.gridObjects.forEach(o => this.canvas.remove(o));
        this.gridObjects = [];
        this.canvas.renderAll();
    }

    // ─── Export ──────────────────────────────────────────────────────────────

    exportAsImage(): void {
        // Temporarily hide guides and grid for clean export
        const hadGrid = this.gridVisible();
        if (hadGrid) this.removeGrid();
        this.clearGuides();

        const dataUrl = this.canvas.toDataURL({
            format: 'png',
            quality: 1,
            multiplier: 2, // 2x resolution
        } as any);

        // Restore grid
        if (hadGrid) this.drawGrid();

        // Download
        const link = document.createElement('a');
        link.download = `${this.layoutName() || 'warehouse-layout'}.png`;
        link.href = dataUrl;
        link.click();
    }

    // ─── Search & Focus ─────────────────────────────────────────────────────

    search(query: string): void {
        this.searchQuery.set(query);
        if (!query.trim()) {
            this.searchResults.set([]);
            return;
        }
        const q = query.toLowerCase();
        const results: { kind: string; id: string; label: string }[] = [];

        this.racks().forEach(r => {
            if (r.label.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)) {
                results.push({ kind: 'rack', id: r.id, label: r.label });
            }
        });
        this.bins().forEach(b => {
            if (b.label.toLowerCase().includes(q) || (b.sku ?? '').toLowerCase().includes(q) || b.id.toLowerCase().includes(q)) {
                results.push({ kind: 'bin', id: b.id, label: b.label });
            }
        });
        this.walls().forEach(w => {
            if ((w.label ?? '').toLowerCase().includes(q)) {
                results.push({ kind: 'wall', id: w.id, label: w.label ?? w.id });
            }
        });
        this.dockDoors().forEach(d => {
            if (d.label.toLowerCase().includes(q)) {
                results.push({ kind: 'dockdoor', id: d.id, label: d.label });
            }
        });

        this.searchResults.set(results);
    }

    focusElement(kind: string, id: string): void {
        const prefix = kind === 'dockdoor' ? 'dock' : kind;
        const obj = this.findFabricByName(`${prefix}-${id}`);
        if (!obj) return;

        // Center viewport on the object
        const oL = obj.left ?? 0;
        const oT = obj.top ?? 0;
        const oW = obj.getScaledWidth();
        const oH = obj.getScaledHeight();
        const cx = oL + oW / 2;
        const cy = oT + oH / 2;

        const canvasW = (this.canvas as any).width as number;
        const canvasH = (this.canvas as any).height as number;
        const zoom = this.canvas.getZoom();

        const vpX = canvasW / 2 - cx * zoom;
        const vpY = canvasH / 2 - cy * zoom;
        this.canvas.setViewportTransform([zoom, 0, 0, zoom, vpX, vpY]);

        // Select the object
        this.canvas.setActiveObject(obj);
        this.canvas.renderAll();

        // Clear search
        this.searchQuery.set('');
        this.searchResults.set([]);
    }

    // ─── Rulers ─────────────────────────────────────────────────────────────

    toggleRuler(): void {
        const show = !this.rulerVisible();
        this.rulerVisible.set(show);
        if (show) this.drawRulers();
        else this.hideRulers();
    }

    setRulerCanvases(hCanvas: HTMLCanvasElement, vCanvas: HTMLCanvasElement): void {
        this.rulerHCanvas = hCanvas;
        this.rulerVCanvas = vCanvas;
        if (this.rulerVisible()) this.drawRulers();
    }

    drawRulers(): void {
        if (!this.rulerHCanvas || !this.rulerVCanvas) return;
        const vt = this.canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0];
        const zoom = vt[0];
        const panX = vt[4];
        const panY = vt[5];

        this.drawHorizontalRuler(zoom, panX);
        this.drawVerticalRuler(zoom, panY);
    }

    private drawHorizontalRuler(zoom: number, panX: number): void {
        const c = this.rulerHCanvas;
        if (!c) return;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        const w = c.width;
        const h = c.height;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = RULER_BG;
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = RULER_LINE;
        ctx.fillStyle = RULER_TEXT;
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';

        // Determine step based on zoom
        const step = this.rulerStep(zoom);

        const startWorld = -panX / zoom;
        const endWorld = (w - panX) / zoom;
        const first = Math.floor(startWorld / step) * step;

        for (let wx = first; wx <= endWorld; wx += step) {
            const sx = wx * zoom + panX;
            if (sx < 0 || sx > w) continue;
            const isMajor = Math.abs(wx % (step * 5)) < 0.01;
            ctx.beginPath();
            ctx.moveTo(sx, h);
            ctx.lineTo(sx, isMajor ? h - 14 : h - 7);
            ctx.stroke();
            if (isMajor) {
                ctx.fillText(String(Math.round(wx)), sx, 10);
            }
        }

        // Bottom line
        ctx.beginPath();
        ctx.moveTo(0, h - 0.5);
        ctx.lineTo(w, h - 0.5);
        ctx.stroke();
    }

    private drawVerticalRuler(zoom: number, panY: number): void {
        const c = this.rulerVCanvas;
        if (!c) return;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        const w = c.width;
        const h = c.height;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = RULER_BG;
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = RULER_LINE;
        ctx.fillStyle = RULER_TEXT;
        ctx.font = '9px monospace';

        const step = this.rulerStep(zoom);

        const startWorld = -panY / zoom;
        const endWorld = (h - panY) / zoom;
        const first = Math.floor(startWorld / step) * step;

        for (let wy = first; wy <= endWorld; wy += step) {
            const sy = wy * zoom + panY;
            if (sy < 0 || sy > h) continue;
            const isMajor = Math.abs(wy % (step * 5)) < 0.01;
            ctx.beginPath();
            ctx.moveTo(w, sy);
            ctx.lineTo(isMajor ? w - 14 : w - 7, sy);
            ctx.stroke();
            if (isMajor) {
                ctx.save();
                ctx.translate(10, sy);
                ctx.rotate(-Math.PI / 2);
                ctx.textAlign = 'center';
                ctx.fillText(String(Math.round(wy)), 0, 0);
                ctx.restore();
            }
        }

        // Right line
        ctx.beginPath();
        ctx.moveTo(w - 0.5, 0);
        ctx.lineTo(w - 0.5, h);
        ctx.stroke();
    }

    private rulerStep(zoom: number): number {
        if (zoom >= 2) return 10;
        if (zoom >= 1) return 20;
        if (zoom >= 0.5) return 50;
        return 100;
    }

    private hideRulers(): void {
        if (this.rulerHCanvas) {
            const ctx = this.rulerHCanvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, this.rulerHCanvas.width, this.rulerHCanvas.height);
        }
        if (this.rulerVCanvas) {
            const ctx = this.rulerVCanvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, this.rulerVCanvas.width, this.rulerVCanvas.height);
        }
    }

    // ─── Bin Capacity Visual ────────────────────────────────────────────────

    /** Redraws a bin with capacity bar — call after updating bin capacity/stock */
    refreshBinCapacityVisual(binId: string): void {
        const bin = this.bins().find(b => b.id === binId);
        if (bin) this.syncBinToCanvas(bin);
    }

    // ─── Destroy ──────────────────────────────────────────────────────────────

    destroy(): void {
        this.clearGuides();
        this.removeGrid();
        this.resizeObserver?.disconnect();
        try { this.canvas?.dispose(); } catch { /* ignore */ }
        this.rackDblClick$.complete();
        this.binDblClick$.complete();
        this.syncFailed$.complete();
        this.rackGroupArea$.complete();
    }

    ngOnDestroy(): void {
        this.destroy();
    }
}
