import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { SelectButtonModule } from 'primeng/selectbutton';
import { InputSwitchModule } from 'primeng/inputswitch';
import { MessageService } from 'primeng/api';

import { LocationGeneratorParams, Location } from '../../types/location';
import { LocationService } from '../service/location.service';
import { BinService } from '../service/bin.service';

@Component({
    selector: 'app-location-generator',
    templateUrl: './location-generator.html',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        FormsModule,
        CardModule,
        ButtonModule,
        InputTextModule,
        DropdownModule,
        InputNumberModule,
        ToastModule,
        TooltipModule,
        DialogModule,
        SelectButtonModule,
        InputSwitchModule
    ],
    providers: [MessageService]
})
export class LocationGenerator {

    // Bin dialog
    showBinDialog: boolean = false;
    generatedLocationIds: string[] = [];
    binDialogMode: 'single' | 'bulk' = 'bulk';
    binModeOptions = [
        { label: 'Individual', value: 'single' },
        { label: 'Masivo', value: 'bulk' }
    ];
    savingBin: boolean = false;

    // Single bin
    newBinName: string = '';
    newBinCapacity: number | undefined = undefined;
    newBinActive: boolean = true;

    // Bulk bin
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
    generatorParams: LocationGeneratorParams = {
        zone: '-',
        category: '',
        type: '',
        area: '',
        rowMin: 1,
        rowMax: 1,
        bayMin: 1,
        bayMax: 1,
        levelMin: 'A',
        levelMax: 'A',
        content: ''
    };

    // Opciones para dropdowns
    categoryOptions = [
        { label: 'REGULAR', value: 'REGULAR' },
        { label: 'HURT', value: 'HURT' },
        { label: 'PICKING', value: 'PICKING' },
        { label: 'REPOSITORY', value: 'REPOSITORY' },
        { label: 'FLOW', value: 'FLOW' },
        { label: 'BLOCKED', value: 'BLOCKED' }
    ];

    typeOptions = [
        { label: 'Floor-F', value: 'Floor-F' },
        { label: 'Low-L', value: 'Low-L' },
        { label: 'Mid-M', value: 'Mid-M' },
        { label: 'Top-T', value: 'Top-T' },
        { label: 'Special-S', value: 'Special-S' },
        { label: 'Toxicity-TX', value: 'Toxicity-TX' }
    ];

    levelOptions = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => ({ label: l, value: l }));

    storageNameFormat: string = '{Area}-{Row}-{Bay}-{Level}';
    availableTokens = ['{Zone}', '{Area}', '{Row}', '{Bay}', '{Level}', '{Category}', '{Type}'];

    insertToken(token: string): void {
        this.storageNameFormat += token;
    }

    get storageNamePreview(): string {
        let result = this.storageNameFormat;
        result = result.replace(/\{Zone\}/g, this.generatorParams.zone || '');
        result = result.replace(/\{Area\}/g, this.generatorParams.area || '');
        result = result.replace(/\{Row\}/g, this.generatorParams.rowMin?.toString() || '');
        result = result.replace(/\{Bay\}/g, this.generatorParams.bayMin?.toString() || '');
        result = result.replace(/\{Level\}/g, this.generatorParams.levelMin || '');
        result = result.replace(/\{Category\}/g, this.generatorParams.category || '');
        result = result.replace(/\{Type\}/g, this.generatorParams.type || '');
        return result;
    }

    zones: string[] = [];
    newZoneName: string = '';
    showAddZone: boolean = false;

    get zoneOptions() {
        return this.zones.map(z => ({ label: z, value: z }));
    }

    addZone(): void {
        const name = this.newZoneName.trim();
        if (name && !this.zones.includes(name)) {
            this.zones.push(name);
            this.generatorParams.zone = name;
        }
        this.newZoneName = '';
        this.showAddZone = false;
    }

    cancelAddZone(): void {
        this.newZoneName = '';
        this.showAddZone = false;
    }

    constructor(
        private locationService: LocationService,
        private binService: BinService,
        private router: Router,
        private messageService: MessageService
    ) { }

    get totalLocations(): number {
        const rows = (this.generatorParams.rowMax - this.generatorParams.rowMin + 1);
        const bays = (this.generatorParams.bayMax - this.generatorParams.bayMin + 1);
        const levels = this.totalLevels;
        return rows * bays * levels;
    }

    get totalRows(): number {
        return this.generatorParams.rowMax - this.generatorParams.rowMin + 1;
    }

    get totalBays(): number {
        return this.generatorParams.bayMax - this.generatorParams.bayMin + 1;
    }

    get totalLevels(): number {
        return this.generatorParams.levelMax.charCodeAt(0) - this.generatorParams.levelMin.charCodeAt(0) + 1;
    }

    async generateAndAddBins(): Promise<void> {
        if (!this.validateParams()) return;
        try {
            const generated = await this.locationService.generateLocations({
                ...this.generatorParams,
                storageNameFormat: this.storageNameFormat
            });
            if (generated && generated.length > 0) {
                this.generatedLocationIds = generated.map((l: Location) => l.id!);
                this.binDialogMode = 'bulk';
                this.newBinName = '';
                this.newBinCapacity = undefined;
                this.newBinActive = true;
                this.bulkPrefix = 'BIN';
                this.bulkStartNumber = 1;
                this.bulkEndNumber = 10;
                this.bulkCapacity = undefined;
                this.bulkActive = true;
                this.bulkNameFormat = '{Prefix}-{Number}';
                this.showBinDialog = true;
            } else {
                this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Could not generate locations' });
            }
        } catch {
            this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Error generating locations' });
        }
    }

    async saveBinsForLocations(): Promise<void> {
        if (this.binDialogMode === 'bulk') {
            if (!this.bulkPrefix?.trim()) {
                this.messageService.add({ severity: 'warn', summary: 'Validación', detail: 'El prefijo es requerido' });
                return;
            }
            if (this.bulkStartNumber > this.bulkEndNumber) {
                this.messageService.add({ severity: 'warn', summary: 'Validación', detail: 'El número inicial no puede ser mayor que el final' });
                return;
            }
            this.savingBin = true;
            try {
                const created = await this.binService.generateBinsForLocations(this.generatedLocationIds, {
                    prefix: this.bulkPrefix,
                    startNumber: this.bulkStartNumber,
                    endNumber: this.bulkEndNumber,
                    nameFormat: this.bulkNameFormat,
                    capacity: this.bulkCapacity,
                    active: this.bulkActive
                });
                this.generatedLocationIds.forEach(id =>
                    this.locationService.updateBinQty(id, this.bulkTotal)
                );
                this.messageService.add({
                    severity: 'success', summary: 'Éxito',
                    detail: `${created.length} bins created in ${this.generatedLocationIds.length} locations`
                });
                setTimeout(() => this.goBack(), 1500);
            } catch {
                this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Error al crear los bins' });
            } finally {
                this.savingBin = false;
            }
        } else {
            if (!this.newBinName?.trim()) {
                this.messageService.add({ severity: 'warn', summary: 'Validación', detail: 'El nombre del bin es requerido' });
                return;
            }
            this.savingBin = true;
            try {
                const payload = this.generatedLocationIds.map(id => ({
                    location_id: id,
                    bin_name: this.newBinName,
                    capacity: this.newBinCapacity ?? null,
                    current_stock: 0,
                    active: this.newBinActive
                }));
                const created = await this.binService.generateBinsForLocations(this.generatedLocationIds, {
                    prefix: this.newBinName,
                    startNumber: 1,
                    endNumber: 1,
                    nameFormat: '{Prefix}',
                    capacity: this.newBinCapacity,
                    active: this.newBinActive
                });
                this.generatedLocationIds.forEach(id =>
                    this.locationService.updateBinQty(id, 1)
                );
                this.messageService.add({
                    severity: 'success', summary: 'Éxito',
                    detail: `Bin "${this.newBinName}" created in ${created.length} locations`
                });
                setTimeout(() => this.goBack(), 1500);
            } catch {
                this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Error al crear los bins' });
            } finally {
                this.savingBin = false;
            }
        }
    }

    closeBinDialog(): void {
        this.showBinDialog = false;
        this.goBack();
    }

    async generateLocations(): Promise<void> {
        if (!this.validateParams()) {
            return;
        }

        try {
            const generated = await this.locationService.generateLocations({
            ...this.generatorParams,
            storageNameFormat: this.storageNameFormat
        });

            if (generated && generated.length > 0) {
                this.messageService.add({
                    severity: 'success',
                    summary: 'Éxito',
                    detail: `${generated.length} locations created successfully`
                });

                setTimeout(() => this.goBack(), 1500);
            } else {
                this.messageService.add({
                    severity: 'error',
                    summary: 'Error',
                    detail: 'Could not generate locations'
                });
            }
        } catch (error) {
            this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: 'Error generating locations'
            });
        }
    }

    validateParams(): boolean {
        if (!this.generatorParams.category) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Validación',
                detail: 'El campo Category es requerido'
            });
            return false;
        }

        if (!this.generatorParams.type) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Validación',
                detail: 'El campo Type es requerido'
            });
            return false;
        }

        if (!this.generatorParams.area) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Validación',
                detail: 'El campo Area es requerido'
            });
            return false;
        }

        if (this.generatorParams.rowMin > this.generatorParams.rowMax) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Validación',
                detail: 'Row Min no puede ser mayor que Row Max'
            });
            return false;
        }

        if (this.generatorParams.bayMin > this.generatorParams.bayMax) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Validación',
                detail: 'Bay Min no puede ser mayor que Bay Max'
            });
            return false;
        }

        if (this.generatorParams.levelMin.charCodeAt(0) > this.generatorParams.levelMax.charCodeAt(0)) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Validación',
                detail: 'Level Min no puede ser mayor que Level Max'
            });
            return false;
        }

        if (this.totalLocations > 1000) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Validación',
                detail: 'Cannot generate more than 1000 locations at once'
            });
            return false;
        }

        return true;
    }

    goBack(): void {
        this.router.navigate(['/locations']);
    }
}
