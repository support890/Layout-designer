import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { FormsModule } from '@angular/forms';
import { MenuModule } from 'primeng/menu';
import { ConfirmationService, MessageService } from 'primeng/api';

import { Bin } from '../../types/bin';
import { Location } from '../../types/location';
import { BinService } from '../service/bin.service';
import { LocationService } from '../service/location.service';
import { BinForm } from './bin-form';

@Component({
    selector: 'app-bin-list',
    templateUrl: './bin-list.html',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        TableModule,
        ButtonModule,
        InputTextModule,
        TagModule,
        DialogModule,
        ConfirmDialogModule,
        ToastModule,
        TooltipModule,
        IconFieldModule,
        InputIconModule,
        FormsModule,
        InputNumberModule,
        InputSwitchModule,
        SelectButtonModule,
        BinForm,
        MenuModule
    ],
    providers: [ConfirmationService, MessageService]
})
export class BinList implements OnInit {
    bins: Bin[] = [];
    filteredBins: Bin[] = [];
    location: Location | undefined;
    locationId: string = '';
    searchValue: string = '';
    menuItems: any[] = [];

    showBinFormDialog: boolean = false;
    showBinGeneratorDialog: boolean = false;
    editingBin: Bin | null = null;

    // New Bin dialog
    showNewBinDialog: boolean = false;
    binDialogMode: 'single' | 'bulk' = 'single';
    binModeOptions = [
        { label: 'Individual', value: 'single' },
        { label: 'Masivo', value: 'bulk' }
    ];
    newBin: Bin = this.emptyBin();
    savingBin: boolean = false;

    // Bulk
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

    private emptyBin(locationId: string = ''): Bin {
        return { locationId, binName: '', capacity: undefined, currentStock: 0, active: true };
    }

    constructor(
        private binService: BinService,
        private locationService: LocationService,
        private router: Router,
        private route: ActivatedRoute,
        private confirmationService: ConfirmationService,
        private messageService: MessageService
    ) { }

    ngOnInit(): void {
        this.route.params.subscribe(params => {
            if (params['locationId']) {
                this.locationId = params['locationId'];
                this.loadLocation();
                this.loadBins();
            }
        });
    }

    async loadLocation(): Promise<void> {
        this.location = await this.locationService.getLocationById(this.locationId);
        if (!this.location) {
            this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: 'Location not found'
            });
            this.goBack();
        }
    }

    async loadBins(): Promise<void> {
        this.bins = await this.binService.getBinsByLocation(this.locationId);
        this.filteredBins = [...this.bins];
    }

    onSearch(): void {
        if (!this.searchValue) {
            this.filteredBins = [...this.bins];
            return;
        }

        const searchLower = this.searchValue.toLowerCase();
        this.filteredBins = this.bins.filter(bin =>
            bin.binName?.toLowerCase().includes(searchLower)
        );
    }

    clearSearch(): void {
        this.searchValue = '';
        this.filteredBins = [...this.bins];
    }

    openNewBinDialog(): void {
        this.newBin = this.emptyBin(this.locationId);
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
                this.messageService.add({ severity: 'success', summary: 'Éxito', detail: `Bin "${created.binName}" creado correctamente`, life: 3000 });
                this.closeNewBinDialog();
                await this.loadBins();
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
                locationId: this.locationId,
                prefix: this.bulkPrefix,
                startNumber: this.bulkStartNumber,
                endNumber: this.bulkEndNumber,
                nameFormat: this.bulkNameFormat,
                capacity: this.bulkCapacity,
                active: this.bulkActive
            });
            this.messageService.add({ severity: 'success', summary: 'Éxito', detail: `${generated.length} bins creados correctamente`, life: 3000 });
            this.closeNewBinDialog();
            await this.loadBins();
        } catch {
            this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Error al crear los bins', life: 3000 });
        } finally {
            this.savingBin = false;
        }
    }

    openGenerator(): void {
        this.showBinGeneratorDialog = true;
    }

    editBin(bin: Bin): void {
        this.editingBin = { ...bin };
        this.showBinFormDialog = true;
    }

    deleteBin(bin: Bin): void {
        this.confirmationService.confirm({
            message: `¿Está seguro que desea eliminar el bin "${bin.binName}"?`,
            header: 'Confirmar Eliminación',
            icon: 'pi pi-exclamation-triangle',
            acceptLabel: 'Sí, eliminar',
            rejectLabel: 'Cancelar',
            accept: async () => {
                await this.binService.deleteBin(bin.id!);
                await this.loadBins();
                this.messageService.add({
                    severity: 'success',
                    summary: 'Eliminado',
                    detail: 'Bin eliminado correctamente',
                    life: 3000
                });
            }
        });
    }

    goBack(): void {
        this.router.navigate(['/locations']);
    }

    getMenuItems(bin: Bin): any[] {
        return [
            {
                label: 'Editar',
                icon: 'pi pi-pencil',
                command: () => this.editBin(bin)
            },
            {
                label: 'Eliminar',
                icon: 'pi pi-trash',
                command: () => this.deleteBin(bin)
            }
        ];
    }
}
