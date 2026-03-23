import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { FormsModule } from '@angular/forms';
import { MenuModule } from 'primeng/menu';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TooltipModule as PTooltipModule } from 'primeng/tooltip';
import { ConfirmationService, MessageService } from 'primeng/api';

import { Location } from '../../types/location';
import { Bin } from '../../types/bin';
import { LocationService } from '../service/location.service';
import { BinService } from '../service/bin.service';

@Component({
    selector: 'app-location-list',
    templateUrl: './location-list.html',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        TableModule,
        ButtonModule,
        InputTextModule,
        TagModule,
        ConfirmDialogModule,
        ToastModule,
        TooltipModule,
        IconFieldModule,
        InputIconModule,
        FormsModule,
        MenuModule,
        DialogModule,
        InputNumberModule,
        InputSwitchModule,
        SelectButtonModule,
        PTooltipModule
    ],
    providers: [ConfirmationService, MessageService]
})
export class LocationList implements OnInit {
    locations: Location[] = [];
    filteredLocations: Location[] = [];
    searchValue: string = '';
    menuItems: any[] = [];

    // New Bin dialog
    showNewBinDialog: boolean = false;
    binDialogMode: 'single' | 'bulk' = 'single';
    binModeOptions = [
        { label: 'Individual', value: 'single' },
        { label: 'Masivo', value: 'bulk' }
    ];
    selectedLocation: Location | null = null;
    newBin: Bin = this.emptyBin();
    savingBin: boolean = false;

    // Bulk bin creation
    bulkPrefix: string = 'BIN';
    bulkStartNumber: number = 1;
    bulkEndNumber: number = 10;
    bulkCapacity: number | undefined = undefined;
    bulkActive: boolean = true;
    bulkNameFormat: string = '{Prefix}-{Number}';
    bulkTokens = ['{Prefix}', '{Number}'];

    get bulkTotal(): number {
        return Math.max(0, this.bulkEndNumber - this.bulkStartNumber + 1);
    }

    get bulkPreview(): string {
        const num = this.bulkStartNumber?.toString().padStart(3, '0') ?? '001';
        return this.bulkNameFormat
            .replace(/\{Prefix\}/g, this.bulkPrefix || '')
            .replace(/\{Number\}/g, num);
    }

    insertBulkToken(token: string): void {
        this.bulkNameFormat += token;
    }

    constructor(
        private locationService: LocationService,
        private binService: BinService,
        private router: Router,
        private confirmationService: ConfirmationService,
        private messageService: MessageService
    ) {}

    async ngOnInit(): Promise<void> {
        await this.locationService.loadLocations();
        this.loadLocations();
    }

    loadLocations(): void {
        this.locations = this.locationService.getAllLocations();
        this.filteredLocations = [...this.locations];
    }

    onSearch(): void {
        if (!this.searchValue) {
            this.filteredLocations = [...this.locations];
            return;
        }

        const searchLower = this.searchValue.toLowerCase();
        this.filteredLocations = this.locations.filter(location =>
            location.storageName?.toLowerCase().includes(searchLower) ||
            location.zone?.toLowerCase().includes(searchLower) ||
            location.category?.toLowerCase().includes(searchLower) ||
            location.type?.toLowerCase().includes(searchLower) ||
            location.content?.toLowerCase().includes(searchLower) ||
            location.area?.toLowerCase().includes(searchLower)
        );
    }

    clearSearch(): void {
        this.searchValue = '';
        this.filteredLocations = [...this.locations];
    }

    createNewLocation(): void {
        this.router.navigate(['/locations/new']);
    }

    openGenerator(): void {
        this.router.navigate(['/locations/generator']);
    }

    openDesigner(): void {
        this.router.navigate(['/almacen/disenador']);
    }

    editLocation(locationId: string): void {
        this.router.navigate(['/locations/edit', locationId]);
    }

    viewBins(locationId: string): void {
        this.router.navigate(['/locations', locationId, 'bins']);
    }

    deleteLocation(location: Location): void {
        this.confirmationService.confirm({
            message: `Are you sure you want to delete location "${location.storageName}"?`,
            header: 'Confirmar Eliminación',
            icon: 'pi pi-exclamation-triangle',
            acceptLabel: 'Sí, eliminar',
            rejectLabel: 'Cancelar',
            accept: async () => {
                const success = await this.locationService.deleteLocation(location.id!);
                if (success) {
                    this.loadLocations();
                    this.messageService.add({
                        severity: 'success',
                        summary: 'Eliminado',
                        detail: 'Location deleted successfully',
                        life: 3000
                    });
                } else {
                    this.messageService.add({
                        severity: 'error',
                        summary: 'Error',
                        detail: 'Could not delete location',
                        life: 3000
                    });
                }
            }
        });
    }

    // New Bin dialog methods
    openNewBinDialog(location: Location): void {
        this.selectedLocation = location;
        this.newBin = this.emptyBin(location.id!);
        this.binDialogMode = 'single';
        this.bulkPrefix = 'BIN';
        this.bulkStartNumber = 1;
        this.bulkEndNumber = 10;
        this.bulkCapacity = undefined;
        this.bulkActive = true;
        this.bulkNameFormat = '{Prefix}-{Number}';
        this.showNewBinDialog = true;
    }

    closeNewBinDialog(): void {
        this.showNewBinDialog = false;
        this.selectedLocation = null;
        this.newBin = this.emptyBin();
    }

    async saveBin(): Promise<void> {
        if (this.binDialogMode === 'bulk') {
            await this.saveBulkBins();
        } else {
            await this.saveSingleBin();
        }
    }

    private async saveSingleBin(): Promise<void> {
        if (!this.newBin.binName?.trim()) {
            this.messageService.add({ severity: 'warn', summary: 'Validación', detail: 'El nombre del bin es requerido' });
            return;
        }
        this.savingBin = true;
        try {
            const created = await this.binService.createBin(this.newBin);
            if (created) {
                const currentQty = this.selectedLocation!.binQty || 0;
                this.locationService.updateBinQty(this.selectedLocation!.id!, currentQty + 1);
                this.messageService.add({ severity: 'success', summary: 'Éxito', detail: `Bin "${created.binName}" creado correctamente`, life: 3000 });
                this.closeNewBinDialog();
                this.loadLocations();
            } else {
                this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudo crear el bin', life: 3000 });
            }
        } catch {
            this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Error al crear el bin', life: 3000 });
        } finally {
            this.savingBin = false;
        }
    }

    private async saveBulkBins(): Promise<void> {
        if (!this.bulkPrefix?.trim()) {
            this.messageService.add({ severity: 'warn', summary: 'Validación', detail: 'El prefijo es requerido' });
            return;
        }
        if (this.bulkStartNumber > this.bulkEndNumber) {
            this.messageService.add({ severity: 'warn', summary: 'Validación', detail: 'El número inicial no puede ser mayor que el final' });
            return;
        }
        if (this.bulkTotal > 500) {
            this.messageService.add({ severity: 'warn', summary: 'Validación', detail: 'No se pueden crear más de 500 bins a la vez' });
            return;
        }
        this.savingBin = true;
        try {
            const generated = await this.binService.generateBinsWithFormat({
                locationId: this.selectedLocation!.id!,
                prefix: this.bulkPrefix,
                startNumber: this.bulkStartNumber,
                endNumber: this.bulkEndNumber,
                nameFormat: this.bulkNameFormat,
                capacity: this.bulkCapacity,
                active: this.bulkActive
            });
            const currentQty = this.selectedLocation!.binQty || 0;
            this.locationService.updateBinQty(this.selectedLocation!.id!, currentQty + generated.length);
            this.messageService.add({ severity: 'success', summary: 'Éxito', detail: `${generated.length} bins creados correctamente`, life: 3000 });
            this.closeNewBinDialog();
            this.loadLocations();
        } catch {
            this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Error al crear los bins', life: 3000 });
        } finally {
            this.savingBin = false;
        }
    }

    getCategoryClass(category: string): string {
        const classes: any = {
            'Priority C': 'success',
            'No Priority': 'danger',
            'Priority A': 'info',
            'Priority B': 'warning'
        };
        return classes[category] || 'secondary';
    }

    getTypeClass(type: string): string {
        const classes: any = {
            'REGULAR': 'success',
            'HURT': 'danger',
            'STAGED': 'info'
        };
        return classes[type] || 'secondary';
    }

    getMenuItems(location: Location): any[] {
        return [
            {
                label: 'Nuevo Bin',
                icon: 'pi pi-plus-circle',
                command: () => this.openNewBinDialog(location)
            },
            {
                separator: true
            },
            {
                label: 'Editar',
                icon: 'pi pi-pencil',
                command: () => this.editLocation(location.id!)
            },
            {
                label: 'Eliminar',
                icon: 'pi pi-trash',
                command: () => this.deleteLocation(location)
            }
        ];
    }

    private emptyBin(locationId: string = ''): Bin {
        return {
            locationId,
            binName: '',
            capacity: undefined,
            currentStock: 0,
            active: true
        };
    }
}
