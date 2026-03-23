import { Component, OnInit, Input, Output, EventEmitter, SimpleChanges, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { DropdownModule } from 'primeng/dropdown';
import { InputSwitchModule } from 'primeng/inputswitch';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';

import { Location } from '../../types/location';
import { LocationService } from '../service/location.service';
import { BinGenerator } from '../bins/bin-generator';

@Component({
    selector: 'app-location-form',
    templateUrl: './location-form.html',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        FormsModule,
        CardModule,
        ButtonModule,
        InputTextModule,
        DropdownModule,
        InputSwitchModule,
        ToastModule,
        TooltipModule,
        BinGenerator
    ],
    providers: [MessageService]
})
export class LocationForm implements OnInit {
    location: Location = {
        zone: '-',
        category: '',
        type: '',
        area: '',
        row: '',
        bay: '',
        level: '',
        storageName: '',
        customName: false,
        binQty: 0,
        active: true
    };

    isEditMode: boolean = false;
    locationId: string = '';

    @Input() popupMode: boolean = false;
    @Input() popupLocation: Partial<Location> | null = null;
    @Output() saved = new EventEmitter<Location>();
    @Output() cancelled = new EventEmitter<void>();

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

    zones: string[] = [];
    newZoneName: string = '';
    showAddZone: boolean = false;

    storageNameFormat: string = 'UBX-{Area}/{Row}-{Bay}-{Level}';
    availableTokens = ['{Zone}', '{Area}', '{Row}', '{Bay}', '{Level}', '{Category}', '{Type}'];
    levelOptions = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => ({ label: l, value: l }));

    // Bin dialog
    showBinDialog: boolean = false;
    newlyCreatedLocationId: string = '';

    insertToken(token: string): void {
        this.storageNameFormat += token;
        this.generateStorageName();
    }

    get zoneOptions() {
        return this.zones.map(z => ({ label: z, value: z }));
    }

    addZone(): void {
        const name = this.newZoneName.trim();
        if (name && !this.zones.includes(name)) {
            this.zones.push(name);
            this.location.zone = name;
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
        private router: Router,
        private route: ActivatedRoute,
        private messageService: MessageService
    ) { }

    ngOnInit(): void {
        if (!this.popupMode) {
            this.route.params.subscribe(params => {
                if (params['id']) {
                    this.isEditMode = true;
                    this.locationId = params['id'];
                    this.loadLocation(this.locationId);
                }
            });
        }
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (this.popupMode && changes['popupLocation'] && this.popupLocation) {
            this.location = { ...this.location, ...this.popupLocation };
            if (this.popupLocation.id) {
                this.isEditMode = true;
                this.locationId = this.popupLocation.id;
                this.loadLocation(this.locationId);
            } else {
                this.isEditMode = false;
                this.locationId = '';
            }
        }
    }

    async loadLocation(id: string): Promise<void> {
        const location = await this.locationService.getLocationById(id);
        if (location) {
            this.location = { ...location };
        } else {
            this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Location not found' });
            this.goBack();
        }
    }

    generateStorageName(): void {
        if (!this.location.customName) {
            let result = this.storageNameFormat;
            result = result.replace(/\{Zone\}/g, this.location.zone ?? '');
            result = result.replace(/\{Area\}/g, this.location.area?.toString() ?? '');
            result = result.replace(/\{Row\}/g, this.location.row?.toString() ?? '');
            result = result.replace(/\{Bay\}/g, this.location.bay?.toString() ?? '');
            result = result.replace(/\{Level\}/g, this.location.level?.toString() ?? '');
            result = result.replace(/\{Category\}/g, this.location.category ?? '');
            result = result.replace(/\{Type\}/g, this.location.type ?? '');
            this.location.storageName = result;
        }
    }

    onTypeChange(): void { this.generateStorageName(); }
    onRowChange(): void {
        const val = Number(this.location.row);
        if (!isNaN(val)) {
            if (val < 0) this.location.row = '0';
            else if (val > 1000000) this.location.row = '1000000';
        }
        this.generateStorageName();
    }
    onBayChange(): void {
        const val = Number(this.location.bay);
        if (!isNaN(val)) {
            if (val < 0) this.location.bay = '0';
            else if (val > 1000000) this.location.bay = '1000000';
        }
        this.generateStorageName();
    }
    onLevelChange(): void { this.generateStorageName(); }
    onAreaChange(): void { this.generateStorageName(); }
    onZoneChange(): void { this.generateStorageName(); }
    onCategoryChange(): void { this.generateStorageName(); }
    onFormatChange(): void { this.generateStorageName(); }
    onCustomNameChange(): void {
        if (!this.location.customName) this.generateStorageName();
    }

    async saveLocation(): Promise<void> {
        if (!this.validateLocation()) return;
        try {
            if (this.isEditMode) {
                const result = await this.locationService.updateLocation(this.locationId, this.location);
                if (result) {
                    this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Location updated successfully' });
                    Object.assign(this.location, result);
                } else throw new Error('Error al actualizar');
            } else {
                const result = await this.locationService.createLocation(this.location);
                if (result) {
                    this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Location created successfully' });
                    Object.assign(this.location, result);
                } else throw new Error('Error al crear');
            }
            if (this.popupMode) {
                this.saved.emit(this.location);
            } else {
                setTimeout(() => this.goBack(), 1000);
            }
        } catch (error) {
            this.messageService.add({
                severity: 'error', summary: 'Error',
                detail: error instanceof Error ? error.message : 'Error saving location'
            });
        }
    }

    async saveAndAddBins(): Promise<void> {
        if (!this.validateLocation()) return;
        try {
            const result = await this.locationService.createLocation(this.location);
            if (result) {
                this.newlyCreatedLocationId = result.id!;
                this.showBinDialog = true;
            } else throw new Error('Error creating location');
        } catch (error) {
            this.messageService.add({
                severity: 'error', summary: 'Error',
                detail: error instanceof Error ? error.message : 'Error saving location'
            });
        }
    }

    onBinDialogVisibilityChange(visible: boolean): void {
        this.showBinDialog = visible;
        if (!visible) this.goBack();
    }

    validateLocation(): boolean {
        if (!this.location.category) {
            this.messageService.add({ severity: 'warn', summary: 'Validación', detail: 'El campo Category es requerido' });
            return false;
        }
        if (!this.location.type) {
            this.messageService.add({ severity: 'warn', summary: 'Validación', detail: 'El campo Type es requerido' });
            return false;
        }
        const { area, row, bay, level } = this.location;
        if (!area || !row || !bay || !level) {
            this.messageService.add({ severity: 'warn', summary: 'Validación', detail: 'Los campos Area, Row, Bay y Level son requeridos' });
            return false;
        }
        const rowNum = Number(this.location.row);
        if (isNaN(rowNum) || rowNum < 0 || rowNum > 1000000) {
            this.messageService.add({ severity: 'warn', summary: 'Validación', detail: 'Row debe ser un número entre 0 y 1,000,000' });
            return false;
        }
        const bayNum = Number(this.location.bay);
        if (isNaN(bayNum) || bayNum < 0 || bayNum > 1000000) {
            this.messageService.add({ severity: 'warn', summary: 'Validación', detail: 'Bay debe ser un número entre 0 y 1,000,000' });
            return false;
        }
        if (!this.location.level || !/^[A-Z]+$/.test(String(this.location.level).toUpperCase())) {
            this.messageService.add({ severity: 'warn', summary: 'Validación', detail: 'Level debe contener solo letras (A-Z)' });
            return false;
        }
        if (!this.location.storageName) {
            this.messageService.add({ severity: 'warn', summary: 'Validación', detail: 'El campo Storage Name es requerido' });
            return false;
        }
        return true;
    }

    goBack(): void {
        if (this.popupMode) {
            this.cancelled.emit();
        } else {
            this.router.navigate(['/locations']);
        }
    }

}
