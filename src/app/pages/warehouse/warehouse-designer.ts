import {
    Component, OnDestroy, HostListener,
    afterNextRender, viewChild, ElementRef,
    signal, inject, ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { ButtonModule }      from 'primeng/button';
import { TooltipModule }     from 'primeng/tooltip';
import { InputTextModule }   from 'primeng/inputtext';
import { DropdownModule }    from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { ToastModule }       from 'primeng/toast';
import { DialogModule }      from 'primeng/dialog';
import { ColorPickerModule } from 'primeng/colorpicker';
import { MessageService }    from 'primeng/api';

import { SelectButtonModule } from 'primeng/selectbutton';

import { WarehouseCanvasService } from './warehouse-canvas.service';
import { WRack, WBin, WZoneArea, WRackGroupParams, WTool } from '../../types/warehouse';
import { LocationGeneratorParams, Location } from '../../types/location';
import { Bin } from '../../types/bin';
import { LocationService } from '../service/location.service';
import { BinService } from '../service/bin.service';
import { LocationForm } from '../locations/location-form';
import { BinForm } from '../bins/bin-form';

@Component({
    selector: 'app-warehouse-designer',
    templateUrl: './warehouse-designer.html',
    standalone: true,
    imports: [
        CommonModule, FormsModule,
        ButtonModule, TooltipModule, InputTextModule, DropdownModule,
        InputNumberModule, InputSwitchModule, ToastModule, DialogModule,
        ColorPickerModule, SelectButtonModule, LocationForm, BinForm
    ],
    providers: [WarehouseCanvasService, MessageService, LocationService, BinService],
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [`
        :host { display: flex; flex-direction: column; height: 100%; }
        .dw-wrap { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

        /* Top bar */
        .dw-topbar {
            display: flex; align-items: center; gap: 8px; padding: 6px 12px;
            background: var(--surface-0, #fff);
            border-bottom: 1px solid var(--surface-200, #e2e8f0);
            min-height: 48px; flex-shrink: 0;
        }
        .dw-breadcrumb { display: flex; align-items: center; gap: 6px; font-size: 0.84rem; color: var(--text-color-secondary, #64748b); }
        .dw-bc-active  { font-weight: 600; color: var(--text-color, #1e293b); }
        .dw-spacer     { flex: 1; }

        /* Main */
        .dw-main { display: flex; flex: 1; min-height: 0; overflow: hidden; }

        /* Left toolbar */
        .dw-toolbar {
            display: flex; flex-direction: column; gap: 2px; padding: 8px 6px;
            background: var(--surface-0, #fff); border-right: 1px solid var(--surface-200, #e2e8f0);
            align-items: center; width: 52px; flex-shrink: 0;
        }
        .dw-tool {
            width: 38px; height: 38px; border-radius: 8px; border: 1px solid transparent;
            background: transparent; cursor: pointer; display: flex; align-items: center;
            justify-content: center; color: var(--text-color-secondary, #64748b); font-size: 1rem;
            transition: background 0.12s, color 0.12s;
        }
        .dw-tool:hover  { background: var(--surface-100, #f1f5f9); color: var(--text-color, #1e293b); }
        .dw-tool.active { background: #e8f0fe; color: #1a4fa0; border-color: #b3c6f5; }
        .dw-tool-sep    { width: 28px; height: 1px; background: var(--surface-200, #e2e8f0); margin: 3px 0; }

        /* Canvas */
        .dw-canvas-wrap { flex: 1; min-width: 0; overflow: hidden; position: relative; }
        .dw-canvas-wrap canvas { display: block; }

        /* Bottom bar */
        .dw-bottombar {
            display: flex; align-items: center; padding: 5px 14px;
            background: var(--surface-0, #fff); border-top: 1px solid var(--surface-200, #e2e8f0);
            gap: 8px; min-height: 36px; flex-shrink: 0;
        }
        .dw-stat    { font-size: 0.75rem; color: var(--text-color-secondary, #64748b); font-weight: 600; }
        .dw-zoom    { display: flex; align-items: center; gap: 4px; }
        .dw-zoom-pct { font-size: 0.8rem; font-weight: 600; min-width: 46px; text-align: center; }

        /* Shared buttons */
        .dw-btn {
            display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px;
            border-radius: 7px; border: 1px solid var(--surface-300, #cbd5e1);
            background: var(--surface-0, #fff); cursor: pointer; font-size: 0.82rem;
            color: var(--text-color, #1e293b); white-space: nowrap;
        }
        .dw-btn:hover     { background: var(--surface-50, #f8f9fa); }
        .dw-btn:disabled  { opacity: 0.45; cursor: not-allowed; }
        .dw-btn:disabled:hover { background: var(--surface-0, #fff); }
        .dw-btn.primary   { background: #1a4fa0; color: #fff; border-color: #1a4fa0; }
        .dw-btn.primary:hover { background: #163f82; }
        .dw-btn.active    { background: #e8f0fe; border-color: #b3c6f5; }
        .dw-btn.danger    { color: #ef4444; border-color: #fca5a5; }
        .dw-btn.danger:hover { background: #fef2f2; }
        .dw-btn-icon      { width: 30px; height: 30px; padding: 0; justify-content: center; border-radius: 7px; }
        .w-full { width: 100%; }

        /* Dialogs */
        .dlg-field { margin-bottom: 12px; }
        .dlg-field label {
            display: block; font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
            letter-spacing: 0.04em; color: var(--text-color-secondary, #64748b); margin-bottom: 4px;
        }
        .dlg-grid    { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .dlg-divider { height: 1px; background: var(--surface-200); margin: 8px 0; }

        /* Status chip */
        .stat-chip {
            display: inline-flex; align-items: center; gap: 4px;
            font-size: 0.78rem; padding: 2px 8px; border-radius: 12px; font-weight: 600;
        }
        .stat-chip.available   { background: #fefce8; color: #854d0e; border: 1px solid #fde68a; }
        .stat-chip.occupied    { background: #f0fdf4; color: #166534; border: 1px solid #86efac; }
        .stat-chip.blocked     { background: #fef2f2; color: #991b1b; border: 1px solid #fca5a5; }
        .stat-chip.maintenance { background: #fff7ed; color: #9a3412; border: 1px solid #fdba74; }

        /* Zone list */
        .zone-list  { display: flex; flex-direction: column; gap: 8px; max-height: 340px; overflow-y: auto; }
        .zone-item  {
            display: flex; align-items: center; gap: 8px; padding: 8px 10px;
            background: var(--surface-50); border: 1px solid var(--surface-100); border-radius: 8px;
        }
        .zone-swatch { width: 16px; height: 16px; border-radius: 3px; flex-shrink: 0; }
        .zone-name   { font-size: 0.88rem; font-weight: 600; flex: 1; }

        /* Hint bar inside canvas */
        .dw-hint {
            position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%);
            background: rgba(0,0,0,0.55); color: #fff; font-size: 0.75rem;
            padding: 4px 12px; border-radius: 20px; pointer-events: none;
            white-space: nowrap;
        }

        /* Bigger color picker preview */
        ::ng-deep .p-colorpicker-preview {
            width: 36px !important;
            height: 36px !important;
        }
    `]
})
export class WarehouseDesigner implements OnDestroy {

    // ── View queries ─────────────────────────────────────────────────────────
    private canvasEl   = viewChild.required<ElementRef<HTMLCanvasElement>>('canvasEl');
    private canvasWrap = viewChild.required<ElementRef<HTMLDivElement>>('canvasWrap');

    // ── Injected services ────────────────────────────────────────────────────
    readonly cs  = inject(WarehouseCanvasService);
    private  msg = inject(MessageService);
    private  router = inject(Router);

    readonly Math = Math; // exposed for template

    // ── Dialog: Edit Rack (Full Location Form) ──────────────────────────
    showLocationFormDlg = signal(false);
    popupLocationData: Partial<Location> | null = null;
    editingRack: WRack | null = null;

    // ── Dialog: Edit Bin ─────────────────────────────────────────────────────
    showBinDlg = signal(false);
    editingBin: WBin | null = null;
    popupBinData: Bin | null = null;
    popupBinLocationId: string = '';
    popupBinLocationName: string = '';

    // ── Dialog: Zone Manager ─────────────────────────────────────────────────
    showZoneDlg  = signal(false);
    newZoneName  = '';
    newZoneColor = 'bbdefb';

    // ── Dialog: Zone Area Assignment ──────────────────────────────────────────
    showZoneAreaDlg = signal(false);
    editingZoneArea: WZoneArea | null = null;
    selectedZoneId: string | undefined = undefined;

    // ── Search ────────────────────────────────────────────────────────────────
    showSearch = signal(false);
    searchText = '';

    // ── Ruler elements ────────────────────────────────────────────────────────
    private rulerH = viewChild<ElementRef<HTMLCanvasElement>>('rulerH');
    private rulerV = viewChild<ElementRef<HTMLCanvasElement>>('rulerV');

    // ── Dialog: Rack Group Generator (Location Generator popup) ──────────────
    showGroupDlg = signal(false);
    isFixedGen = false; // true when opened from sidebar without drawing
    private drawnArea: { x: number; y: number; w: number; h: number } | null = null;

    // Location Generator params (replicating LocationGenerator form)
    genParams: LocationGeneratorParams = {
        zone: '-', category: '', type: '', area: '',
        rowMin: 1, rowMax: 1, bayMin: 1, bayMax: 1,
        levelMin: 'A', levelMax: 'A', content: '',
    };
    genStorageNameFormat = '{Area}-{Row}-{Bay}-{Level}';
    genGenerating = false;

    // Bin sub-dialog after generation
    showGenBinDlg = false;
    genBinMode: 'single' | 'bulk' = 'bulk';
    genBinModeOptions = [
        { label: 'Single', value: 'single' },
        { label: 'Bulk', value: 'bulk' },
    ];
    genBinSaving = false;
    genBinName = '';
    genBinCapacity: number | undefined = undefined;
    genBinActive = true;
    genBulkPrefix = 'BIN';
    genBulkStart = 1;
    genBulkEnd = 10;
    genBulkCapacity: number | undefined = undefined;
    genBulkActive = true;
    genBulkNameFormat = '{Prefix}-{Number}';
    genBulkTokens = ['{Prefix}', '{Number}'];
    genLocationIds: string[] = [];

    private locationSvc = inject(LocationService);
    private binSvc = inject(BinService);

    // ── Options ──────────────────────────────────────────────────────────────
    readonly axisOptions     = [{ label: 'Horizontal (X)', value: 'x' }, { label: 'Vertical (Y)', value: 'y' }];
    readonly priorityOptions = [1,2,3,4,5,6,7,8,9,10].map(n => ({ label: String(n), value: n }));
    readonly statusOptions   = [
        { label: 'Available',    value: 'available' },
        { label: 'Occupied',     value: 'occupied' },
        { label: 'Blocked',      value: 'blocked' },
        { label: 'Maintenance',  value: 'maintenance' },
    ];

    // ── Location field options (shared with location-form) ─────────────────
    readonly categoryOptions = [
        { label: 'REGULAR',    value: 'REGULAR' },
        { label: 'HURT',       value: 'HURT' },
        { label: 'PICKING',    value: 'PICKING' },
        { label: 'REPOSITORY', value: 'REPOSITORY' },
        { label: 'FLOW',       value: 'FLOW' },
        { label: 'BLOCKED',    value: 'BLOCKED' },
    ];
    readonly typeOptions = [
        { label: 'Floor-F',     value: 'Floor-F' },
        { label: 'Low-L',       value: 'Low-L' },
        { label: 'Mid-M',       value: 'Mid-M' },
        { label: 'Top-T',       value: 'Top-T' },
        { label: 'Special-S',   value: 'Special-S' },
        { label: 'Toxicity-TX', value: 'Toxicity-TX' },
    ];
    readonly levelOptions = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => ({ label: l, value: l }));
    readonly availableTokens = ['{Zone}', '{Area}', '{Row}', '{Bay}', '{Level}', '{Category}', '{Type}'];

    readonly tools: { id: WTool; label: string; icon: string; sep?: boolean }[] = [
        { id: 'select',    label: 'Select  (V)',                    icon: 'pi pi-arrow-up-right' },
        { id: 'pan',       label: 'Pan / Hand  (H)',                icon: 'pi pi-arrows-alt' },
        { id: 'zone',      label: 'Zone Area  (Z)',                  icon: 'pi pi-stop',        sep: true },
        { id: 'rackgroup', label: 'Location Group  (G)',            icon: 'pi pi-objects-column' },
        { id: 'rack',      label: 'Location  (R)',                  icon: 'pi pi-map-marker' },
        { id: 'bin',       label: 'Bin  (B) — inside a Location',  icon: 'pi pi-box' },
        { id: 'wall',      label: 'Wall  (W)',                      icon: 'pi pi-minus',       sep: true },
        { id: 'dockdoor',  label: 'Dock Door  (D)',                 icon: 'pi pi-sign-in' },
    ];

    private subs = new Subscription();

    constructor() {
        // Canvas init after first render (SSR-safe)
        afterNextRender(() => {
            this.cs.initCanvas(
                this.canvasEl().nativeElement,
                this.canvasWrap().nativeElement
            );
            // Setup ruler canvases if present
            const rH = this.rulerH();
            const rV = this.rulerV();
            if (rH && rV) {
                this.cs.setRulerCanvases(rH.nativeElement, rV.nativeElement);
            }
        });

        // Subscribe to double-click events from service
        this.subs.add(
            this.cs.rackDblClick$.subscribe(rack => {
                this.editingRack = { ...rack };
                this.popupLocationData = {
                    id: rack.linkedId,
                    zone: rack.zoneId ? this.cs.zones().find(z => z.id === rack.zoneId)?.name : '-',
                    area: rack.area,
                    row: rack.row ? String(rack.row) : '',
                    bay: rack.bay ? String(rack.bay) : '',
                    level: rack.level,
                    category: rack.category,
                    type: rack.type,
                    storageName: rack.storageName,
                    customName: rack.customName ?? !!(rack.storageName || rack.label),
                    content: rack.content,
                    active: rack.active !== false
                };
                this.showLocationFormDlg.set(true);
            })
        );
        this.subs.add(
            this.cs.binDblClick$.subscribe(bin => {
                const rack = this.cs.racks().find(r => r.id === bin.rackId);
                this.editingBin = { ...bin };
                
                this.popupBinLocationId = rack?.linkedId || rack?.id || '';
                this.popupBinLocationName = rack?.label || rack?.storageName || rack?.id || '';
                
                this.popupBinData = {
                    id: bin.linkedId,
                    locationId: this.popupBinLocationId,
                    binName: bin.label || '',
                    capacity: bin.capacity,
                    currentStock: bin.currentStock,
                    active: bin.active !== false
                };
                
                this.showBinDlg.set(true);
            })
        );
        this.subs.add(
            this.cs.syncFailed$.subscribe(errorMsg => {
                this.msg.add({
                    severity: 'error', summary: 'Sync error',
                    detail: errorMsg, life: 5000,
                });
            })
        );
        this.subs.add(
            this.cs.rackGroupArea$.subscribe(area => {
                this.openGroupFromArea(area);
            })
        );
        this.subs.add(
            this.cs.zoneAreaDblClick$.subscribe(za => {
                this.editingZoneArea = za;
                this.selectedZoneId = za.zoneId;
                this.showZoneAreaDlg.set(true);
            })
        );
    }

    ngOnDestroy(): void {
        this.subs.unsubscribe();
        this.cs.destroy();
    }

    // ── Keyboard shortcuts ───────────────────────────────────────────────────

    onToolClick(tool: WTool): void {
        if (tool === 'rackgroup') {
            this.isFixedGen = true;
            this.drawnArea = null;
            // Reset generator params to default when opening fixed
            this.genParams = {
                zone: '-', category: '', type: '', area: '',
                rowMin: 1, rowMax: 1, bayMin: 1, bayMax: 1,
                levelMin: 'A', levelMax: 'A', content: '',
            };
            this.genStorageNameFormat = '{Area}-{Row}-{Bay}-{Level}';
            this.showGroupDlg.set(true);
        } else {
            this.cs.setTool(tool);
        }
    }

    @HostListener('document:keydown', ['$event'])
    onKeyDown(e: KeyboardEvent): void {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

        if (e.code === 'Space') { e.preventDefault(); this.cs.setSpaceDown(true); return; }
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyZ') { e.preventDefault(); this.cs.redo(); return; }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); this.cs.undo(); return; }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); this.cs.redo(); return; }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC') { e.preventDefault(); this.cs.copy(); this.msg.add({ severity: 'info', summary: 'Copied', detail: 'Elements copied to clipboard', life: 1500 }); return; }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') { e.preventDefault(); this.cs.paste(); return; }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF') { e.preventDefault(); this.showSearch.set(!this.showSearch()); return; }
        if (e.code === 'Escape')  { this.cs.setTool('select'); return; }
        if (e.code === 'Delete' || e.code === 'Backspace') { this.cs.deleteSelected(); return; }

        if (!e.ctrlKey && !e.metaKey) {
            const map: Record<string, WTool> = {
                v: 'select', h: 'pan', r: 'rack', g: 'rackgroup', b: 'bin', z: 'zone', w: 'wall', d: 'dockdoor',
            };
            const t = map[e.key.toLowerCase()];
            if (t) {
                if (t === 'rackgroup') {
                    this.showGroupDlg.set(true);
                } else {
                    this.cs.setTool(t);
                }
            }
        }
    }

    @HostListener('document:keyup', ['$event'])
    onKeyUp(e: KeyboardEvent): void {
        if (e.code === 'Space') this.cs.setSpaceDown(false);
    }

    onLocationFormSaved(loc: Location): void {
        this.showLocationFormDlg.set(false);
        if (this.editingRack) {
            const z = this.cs.zones().find(z => z.name === loc.zone);
            this.cs.updateRack(this.editingRack.id, {
                linkedId: loc.id,
                label: loc.storageName || loc.id,
                zoneId: z ? z.id : undefined,
                area: loc.area,
                row: loc.row,
                bay: loc.bay,
                level: loc.level,
                category: loc.category,
                type: loc.type,
                storageName: loc.storageName,
                customName: loc.customName,
                content: loc.content,
                active: loc.active
            });
            this.editingRack = null;
            this.msg.add({ severity: 'success', summary: 'Synced', detail: 'Location saved and linked to layout.', life: 2500 });
        }
    }

    onLocationFormCancelled(): void {
        this.showLocationFormDlg.set(false);
        this.editingRack = null;
    }

    deleteRackFromDlg(): void {
        if (!this.editingRack) return;
        this.cs.deleteRack(this.editingRack.id);
        this.showLocationFormDlg.set(false);
        this.editingRack = null;
        this.msg.add({ severity: 'info', summary: 'Deleted', detail: 'Location removed from layout', life: 2500 });
    }

    // ── Bin dialog ───────────────────────────────────────────────────────────

    onBinFormSaved(result: any): void {
        this.showBinDlg.set(false);
        if (!this.editingBin) return;

        if (Array.isArray(result)) {
            // BULK: Update the clicked bin with the first one, add the rest dynamically
            if (result.length > 0) {
                const firstBin = result[0];
                this.cs.updateBin(this.editingBin.id, {
                    linkedId: firstBin.id,
                    label: firstBin.binName,
                    capacity: firstBin.capacity,
                    currentStock: firstBin.currentStock,
                    active: firstBin.active
                });

                // For the remaining bins generated in bulk, randomly place them inside the same rack
                const rack = this.cs.racks().find(r => r.id === this.editingBin!.rackId);
                if (rack) {
                    for (let i = 1; i < result.length; i++) {
                        const b = result[i];
                        // Just generate a slightly offset position for visual representation
                        const padding = 2;
                        const binW = this.editingBin.w;
                        const binH = this.editingBin.h;
                        // Avoid overflowing rack ideally, but for now just place them in the rack bounding box
                        const offsetX = (i * (binW + padding)) % (rack.w - binW * 2);
                        const offsetY = Math.floor((i * (binW + padding)) / (rack.w - binW * 2)) * (binH + padding);
                        
                        const newBin: WBin = {
                            id: crypto.randomUUID(),
                            rackId: rack.id,
                            linkedId: b.id,
                            x: padding + offsetX,
                            y: padding + offsetY,
                            w: binW,
                            h: binH,
                            label: b.binName,
                            status: 'available',
                            capacity: b.capacity,
                            currentStock: b.currentStock,
                            active: b.active
                        };
                        this.cs.bins.update(bins => [...bins, newBin]);
                    }
                }
                this.msg.add({ severity: 'success', summary: 'Bulk Generated', detail: `${result.length} bins added to layout.`, life: 3000 });
            }
        } else {
            // SINGLE
            this.cs.updateBin(this.editingBin.id, {
                linkedId: result.id,
                label: result.binName,
                capacity: result.capacity,
                currentStock: result.currentStock,
                active: result.active
            });
            this.msg.add({ severity: 'success', summary: 'Synced', detail: 'Bin saved and linked.', life: 2500 });
        }
        this.editingBin = null;
    }

    deleteBinFromDlg(): void {
        if (!this.editingBin) return;
        this.cs.deleteBin(this.editingBin.id);
        this.showBinDlg.set(false);
        this.editingBin = null;
        this.msg.add({ severity: 'info', summary: 'Deleted', detail: 'Bin removed from layout', life: 2500 });
    }

    // ── Zone manager ─────────────────────────────────────────────────────────

    addZone(): void {
        const name = this.newZoneName.trim();
        if (!name) return;
        this.cs.addZone(name, this.newZoneColor);
        this.newZoneName = '';
        this.newZoneColor = 'bbdefb';
    }

    deleteZone(id: string): void {
        this.cs.deleteZone(id);
    }

    // ── Zone area assignment ──────────────────────────────────────────────────

    /** Create a new zone and auto-select it in the zone area dialog */
    addZoneAndSelect(): void {
        const name = this.newZoneName.trim();
        if (!name) return;
        const zone = this.cs.addZone(name, this.newZoneColor);
        this.selectedZoneId = zone.id;
        this.newZoneName = '';
        this.newZoneColor = 'bbdefb';
    }

    saveZoneAreaAssignment(): void {
        if (!this.editingZoneArea) return;
        this.cs.assignZoneToArea(this.editingZoneArea.id, this.selectedZoneId);
        this.showZoneAreaDlg.set(false);
        this.msg.add({ severity: 'success', summary: 'Zone assigned', detail: 'Zone area updated', life: 2500 });
    }

    deleteZoneAreaFromDlg(): void {
        if (!this.editingZoneArea) return;
        this.cs.deleteZoneArea(this.editingZoneArea.id);
        this.showZoneAreaDlg.set(false);
        this.msg.add({ severity: 'info', summary: 'Deleted', detail: 'Zone area deleted', life: 2500 });
    }

    // ── Group generator (Location Generator popup) ─────────────────────────

    /** Open group dialog pre-filled from a drawn area on the canvas */
    private openGroupFromArea(area: { x: number; y: number; w: number; h: number }): void {
        this.isFixedGen = false;
        this.drawnArea = area;
        // Reset generator params
        this.genParams = {
            zone: '-', category: '', type: '', area: '',
            rowMin: 1, rowMax: 1, bayMin: 1, bayMax: 1,
            levelMin: 'A', levelMax: 'A', content: '',
        };
        this.genStorageNameFormat = '{Area}-{Row}-{Bay}-{Level}';
        this.showGroupDlg.set(true);
    }

    // Computed-like getters for the generator summary
    get genTotalLocations(): number {
        const rows = Math.max(0, this.genParams.rowMax - this.genParams.rowMin + 1);
        const bays = Math.max(0, this.genParams.bayMax - this.genParams.bayMin + 1);
        const levels = this.genTotalLevels;
        return rows * bays * levels;
    }
    get genTotalRows(): number { return Math.max(0, this.genParams.rowMax - this.genParams.rowMin + 1); }
    get genTotalBays(): number { return Math.max(0, this.genParams.bayMax - this.genParams.bayMin + 1); }
    get genTotalLevels(): number {
        return Math.max(0, this.genParams.levelMax.charCodeAt(0) - this.genParams.levelMin.charCodeAt(0) + 1);
    }

    get genStorageNamePreview(): string {
        let r = this.genStorageNameFormat;
        r = r.replace(/\{Zone\}/g, this.genParams.zone || '');
        r = r.replace(/\{Area\}/g, this.genParams.area || '');
        r = r.replace(/\{Row\}/g, this.genParams.rowMin?.toString() || '');
        r = r.replace(/\{Bay\}/g, this.genParams.bayMin?.toString() || '');
        r = r.replace(/\{Level\}/g, this.genParams.levelMin || '');
        r = r.replace(/\{Category\}/g, this.genParams.category || '');
        r = r.replace(/\{Type\}/g, this.genParams.type || '');
        return r;
    }

    get genBulkTotal(): number { return Math.max(0, this.genBulkEnd - this.genBulkStart + 1); }
    get genBulkPreview(): string {
        const num = this.genBulkStart?.toString().padStart(3, '0') ?? '001';
        return this.genBulkNameFormat
            .replace(/\{Prefix\}/g, this.genBulkPrefix || '')
            .replace(/\{Number\}/g, num);
    }

    insertGenToken(token: string): void {
        this.genStorageNameFormat += token;
    }

    insertGenBulkToken(token: string): void {
        this.genBulkNameFormat += token;
    }

    private validateGenParams(): boolean {
        if (!this.genParams.category) {
            this.msg.add({ severity: 'warn', summary: 'Validation', detail: 'Category is required' });
            return false;
        }
        if (!this.genParams.type) {
            this.msg.add({ severity: 'warn', summary: 'Validation', detail: 'Type is required' });
            return false;
        }
        if (!this.genParams.area) {
            this.msg.add({ severity: 'warn', summary: 'Validation', detail: 'Area is required' });
            return false;
        }
        if (this.genParams.rowMin > this.genParams.rowMax) {
            this.msg.add({ severity: 'warn', summary: 'Validation', detail: 'Row Min cannot be greater than Row Max' });
            return false;
        }
        if (this.genParams.bayMin > this.genParams.bayMax) {
            this.msg.add({ severity: 'warn', summary: 'Validation', detail: 'Bay Min cannot be greater than Bay Max' });
            return false;
        }
        if (this.genParams.levelMin.charCodeAt(0) > this.genParams.levelMax.charCodeAt(0)) {
            this.msg.add({ severity: 'warn', summary: 'Validation', detail: 'Level Min cannot be greater than Level Max' });
            return false;
        }
        if (this.genTotalLocations > 1000) {
            this.msg.add({ severity: 'warn', summary: 'Validation', detail: 'Cannot generate more than 1,000 locations at once' });
            return false;
        }
        return true;
    }

    /** Generate locations in DB + create racks on canvas distributed in drawn area */
    async generateGroupLocations(): Promise<void> {
        if (!this.validateGenParams()) return;
        this.genGenerating = true;
        try {
            const generated = await this.locationSvc.generateLocations({
                ...this.genParams,
                storageNameFormat: this.genStorageNameFormat,
            });
            if (!generated?.length) {
                this.msg.add({ severity: 'error', summary: 'Error', detail: 'Could not generate locations' });
                return;
            }
            // Create locations on canvas distributed in the drawn area (if any)
            if (this.drawnArea) {
                this.createRacksFromLocations(generated);
            }
            this.showGroupDlg.set(false);
            this.msg.add({
                severity: 'success', summary: 'Locations created',
                detail: this.drawnArea 
                    ? `${generated.length} locations generated and drawn on the canvas`
                    : `${generated.length} locations generated in the database`,
                life: 3000,
            });
        } catch {
            this.msg.add({ severity: 'error', summary: 'Error', detail: 'Error generating locations' });
        } finally {
            this.genGenerating = false;
        }
    }

    /** Generate locations + open bin sub-dialog */
    async generateGroupAndAddBins(): Promise<void> {
        if (!this.validateGenParams()) return;
        this.genGenerating = true;
        try {
            const generated = await this.locationSvc.generateLocations({
                ...this.genParams,
                storageNameFormat: this.genStorageNameFormat,
            });
            if (!generated?.length) {
                this.msg.add({ severity: 'error', summary: 'Error', detail: 'Could not generate locations' });
                return;
            }
            if (this.drawnArea) {
                this.createRacksFromLocations(generated);
            }
            this.genLocationIds = generated.map(l => l.id!);
            this.showGroupDlg.set(false);
            // Open bin sub-dialog
            this.genBinMode = 'bulk';
            this.genBinName = '';
            this.genBinCapacity = undefined;
            this.genBinActive = true;
            this.genBulkPrefix = 'BIN';
            this.genBulkStart = 1;
            this.genBulkEnd = 10;
            this.genBulkCapacity = undefined;
            this.genBulkActive = true;
            this.genBulkNameFormat = '{Prefix}-{Number}';
            this.showGenBinDlg = true;
        } catch {
            this.msg.add({ severity: 'error', summary: 'Error', detail: 'Error generating locations' });
        } finally {
            this.genGenerating = false;
        }
    }

    async saveGenBins(): Promise<void> {
        this.genBinSaving = true;
        try {
            if (this.genBinMode === 'bulk') {
                if (!this.genBulkPrefix?.trim()) {
                    this.msg.add({ severity: 'warn', summary: 'Validation', detail: 'Prefix is required' });
                    return;
                }
                await this.binSvc.generateBinsForLocations(this.genLocationIds, {
                    prefix: this.genBulkPrefix,
                    startNumber: this.genBulkStart,
                    endNumber: this.genBulkEnd,
                    nameFormat: this.genBulkNameFormat,
                    capacity: this.genBulkCapacity,
                    active: this.genBulkActive,
                });
                this.msg.add({
                    severity: 'success', summary: 'Bins created',
                    detail: `${this.genBulkTotal * this.genLocationIds.length} bins created`, life: 3000,
                });
            } else {
                if (!this.genBinName?.trim()) {
                    this.msg.add({ severity: 'warn', summary: 'Validation', detail: 'Bin name is required' });
                    return;
                }
                await this.binSvc.generateBinsForLocations(this.genLocationIds, {
                    prefix: this.genBinName,
                    startNumber: 1,
                    endNumber: 1,
                    nameFormat: '{Prefix}',
                    capacity: this.genBinCapacity,
                    active: this.genBinActive,
                });
                this.msg.add({
                    severity: 'success', summary: 'Bins created',
                    detail: `Bin "${this.genBinName}" created in ${this.genLocationIds.length} locations`, life: 3000,
                });
            }
        } catch {
            this.msg.add({ severity: 'error', summary: 'Error', detail: 'Error creating bins' });
        } finally {
            this.genBinSaving = false;
            this.showGenBinDlg = false;
        }
    }

    /** Distribute racks on the canvas within the drawn area from generated locations */
    private createRacksFromLocations(locations: Location[]): void {
        const area = this.drawnArea ?? { x: 60, y: 60, w: 800, h: 600 };
        const count = locations.length;
        const gap = 20;

        // Calculate grid: try to make it roughly rectangular
        const cols = Math.max(1, Math.ceil(Math.sqrt(count * (area.w / area.h))));
        const rows = Math.max(1, Math.ceil(count / cols));

        const rackW = Math.max(60, Math.floor((area.w - gap * (cols + 1)) / cols));
        const rackH = Math.max(50, Math.floor((area.h - gap * (rows + 1)) / rows));

        const params: WRackGroupParams = {
            count,
            axis: 'x', // we handle 2D grid manually below
            rackW, rackH, gap,
            startX: Math.round(area.x + gap),
            startY: Math.round(area.y + gap),
            prefix: this.genParams.area || 'LOC',
            startIndex: this.genParams.rowMin || 1,
            binsPerRack: 0,
            binPrefix: 'BIN',
            zoneId: undefined,
        };

        // Use custom 2D placement: override labels from generated locations
        this.cs.pushHistoryPublic();
        const newRacks: WRack[] = [];
        for (let i = 0; i < count; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const rx = params.startX + col * (rackW + gap);
            const ry = params.startY + row * (rackH + gap);
            const loc = locations[i];

            const rack = this.cs.createRack(rx, ry, rackW, rackH);
            // Link rack to DB location and set label
            this.cs.updateRack(rack.id, {
                label: loc.storageName || loc.area + '-' + loc.row + '-' + loc.bay + '-' + loc.level,
                linkedId: loc.id,
                category: loc.category,
                type: loc.type,
                area: loc.area,
                row: loc.row,
                bay: loc.bay,
                level: loc.level,
                storageName: loc.storageName,
                customName: loc.customName,
                content: loc.content,
                active: loc.active,
            });
            newRacks.push(rack);
        }

        this.cs.saveLayout();
        this.drawnArea = null;
    }

    // ── Layout ───────────────────────────────────────────────────────────────

    saveLayout(): void {
        this.cs.saveLayout();
        this.msg.add({ severity: 'success', summary: 'Saved', detail: 'Layout saved locally. Locations and bins are already synced with the database.', life: 3000 });
    }

    loadLayout(): void {
        this.cs.loadFromStorage();
        this.msg.add({ severity: 'info', summary: 'Loaded', detail: 'Layout loaded from saved data.', life: 3000 });
    }

    goBack(): void {
        this.router.navigate(['/locations']);
    }

    // ── Status label helper ──────────────────────────────────────────────────

    statusLabel(s: string): string {
        const m: Record<string, string> = {
            available: 'Available', occupied: 'Occupied',
            blocked: 'Blocked', maintenance: 'Maintenance',
        };
        return m[s] ?? s;
    }

    toolHint(tool: WTool): string {
        const m: Record<string, string> = {
            pan:       'Click and drag to pan across the layout',
            rack:      'Draw a Location — drag to set size',
            rackgroup: 'Draw an area — locations will be distributed inside',
            bin:       'Draw a Bin inside an existing Location',
            zone:      'Draw a Zone Area — double-click to assign a zone',
            wall:      'Draw a Wall',
            dockdoor:  'Draw a Dock Door',
        };
        return m[tool] ?? '';
    }

    // ── Search ────────────────────────────────────────────────────────────────

    onSearchInput(query: string): void {
        this.searchText = query;
        this.cs.search(query);
    }

    focusResult(kind: string, id: string): void {
        this.cs.focusElement(kind, id);
        this.showSearch.set(false);
        this.searchText = '';
    }

    // ── Export ────────────────────────────────────────────────────────────────

    exportImage(): void {
        this.cs.exportAsImage();
        this.msg.add({ severity: 'success', summary: 'Exported', detail: 'Image downloaded', life: 2500 });
    }
}
