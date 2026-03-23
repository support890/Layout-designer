import { Component, EventEmitter, Input, OnInit, Output, SimpleChanges, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';

import { Bin, BinGeneratorParams } from '../../types/bin';
import { BinService } from '../service/bin.service';
import { SelectButtonModule } from 'primeng/selectbutton';

@Component({
    selector: 'app-bin-form',
    templateUrl: './bin-form.html',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        DialogModule,
        ButtonModule,
        InputTextModule,
        InputNumberModule,
        InputSwitchModule,
        SelectButtonModule,
        ToastModule
    ],
    providers: [MessageService]
})
export class BinForm implements OnInit, OnChanges {
    @Input() visible: boolean = false;
    @Input() locationId: string = '';
    @Input() locationName?: string = '';
    @Input() bin: Bin | null = null;
    @Input() popupMode: boolean = false;
    @Output() visibleChange = new EventEmitter<boolean>();
    @Output() onSave = new EventEmitter<any>();
    @Output() onCancel = new EventEmitter<void>();

    binData: Bin = this.emptyBin();

    isEditMode: boolean = false;
    saving: boolean = false;

    // Bulk / Single Mode
    binDialogMode: 'single' | 'bulk' = 'single';
    binModeOptions = [
        { label: 'Individual', value: 'single' },
        { label: 'Bulk', value: 'bulk' }
    ];

    // Bulk params
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
        private messageService: MessageService
    ) {}

    ngOnInit(): void {
        this.initializeData();
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['bin'] || changes['locationId'] || changes['visible']) {
            this.initializeData();
        }
    }

    private initializeData(): void {
        if (this.bin && Object.keys(this.bin).length > 0) {
            this.isEditMode = true;
            this.binDialogMode = 'single';
            this.binData = { ...this.bin };
            if (!this.binData.locationId) this.binData.locationId = this.locationId;
        } else {
            this.isEditMode = false;
            this.binData = this.emptyBin(this.locationId);
            this.binDialogMode = 'single';
        }
    }

    async saveBin(): Promise<void> {
        if (this.binDialogMode === 'bulk' && !this.isEditMode) {
            await this.saveBulkBins();
        } else {
            await this.saveSingleBin();
        }
    }

    private async saveSingleBin(): Promise<void> {
        if (!this.binData.binName?.trim()) {
            this.messageService.add({ severity: 'warn', summary: 'Validation', detail: 'Bin name is required' });
            return;
        }

        this.saving = true;
        try {
            if (this.isEditMode) {
                const updated = await this.binService.updateBin(this.binData.id!, this.binData);
                this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Bin updated successfully' });
                this.onSave.emit(updated || this.binData);
            } else {
                const created = await this.binService.createBin(this.binData);
                this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Bin created successfully' });
                this.onSave.emit(created || this.binData);
            }
            this.closeDialog();
        } catch (error) {
            this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Error saving bin' });
        } finally {
            this.saving = false;
        }
    }

    private async saveBulkBins(): Promise<void> {
        if (!this.bulkPrefix?.trim()) {
            this.messageService.add({ severity: 'warn', summary: 'Validation', detail: 'Prefix is required' });
            return;
        }
        if (this.bulkStartNumber > this.bulkEndNumber) {
            this.messageService.add({ severity: 'warn', summary: 'Validation', detail: 'Start number cannot be greater than end number' });
            return;
        }
        if (this.bulkTotal > 500) {
            this.messageService.add({ severity: 'warn', summary: 'Validation', detail: 'Cannot create more than 500 bins at once' });
            return;
        }
        
        this.saving = true;
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
            this.messageService.add({ severity: 'success', summary: 'Success', detail: `${generated.length} bins created successfully` });
            this.onSave.emit(generated);
            this.closeDialog();
        } catch (error) {
            this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Error creating bulk bins' });
        } finally {
            this.saving = false;
        }
    }

    closeDialog(): void {
        this.visible = false;
        this.visibleChange.emit(false);
        this.onCancel.emit();
    }
}
