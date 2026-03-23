import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupabaseService } from '../../services/supabase.service';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';

@Component({
  selector: 'app-supabase-test',
  standalone: true,
  imports: [CommonModule, CardModule, ButtonModule, TableModule, ToastModule],
  providers: [MessageService],
  template: `
    <p-toast />
    
    <div class="card">
      <h2 class="text-3xl font-bold text-surface-900 dark:text-surface-0 mb-4">
        Test de Conexión Supabase
      </h2>

      <div class="grid grid-cols-12 gap-4 mb-4">
        <div class="col-span-12 md:col-span-3">
          <p-button 
            label="Cargar Productos"
            icon="pi pi-shopping-cart"
            (onClick)="loadProducts()"
            styleClass="w-full">
          </p-button>
        </div>
        
        <div class="col-span-12 md:col-span-3">
          <p-button 
            label="Cargar Proveedores"
            icon="pi pi-users"
            (onClick)="loadSuppliers()"
            styleClass="w-full">
          </p-button>
        </div>

        <div class="col-span-12 md:col-span-3">
          <p-button 
            label="Load Locations"
            icon="pi pi-map-marker"
            (onClick)="loadLocations()"
            styleClass="w-full">
          </p-button>
        </div>

        <div class="col-span-12 md:col-span-3">
          <p-button 
            label="Crear Producto"
            icon="pi pi-plus"
            severity="success"
            (onClick)="createTestProduct()"
            styleClass="w-full">
          </p-button>
        </div>
      </div>

      <p-card *ngIf="data.length > 0">
        <p-table [value]="data" [tableStyle]="{'min-width': '50rem'}">
          <ng-template pTemplate="header">
            <tr>
              <th *ngFor="let col of columns">{{ col }}</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td *ngFor="let col of columns">{{ row[col] }}</td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>

      <p-card *ngIf="loading">
        <div class="text-center py-8">
          <i class="pi pi-spin pi-spinner text-4xl text-primary"></i>
          <p class="mt-4">Cargando datos...</p>
        </div>
      </p-card>
    </div>
  `
})
export class SupabaseTestComponent implements OnInit {
  data: any[] = [];
  columns: string[] = [];
  loading = false;

  constructor(
    private supabaseService: SupabaseService,
    private messageService: MessageService
  ) {}

  ngOnInit() {
    console.log('Supabase Service inicializado');
  }

  async loadProducts() {
    this.loading = true;
    try {
      this.data = await this.supabaseService.getProducts();
      this.columns = this.data.length > 0 ? Object.keys(this.data[0]) : [];
      
      this.messageService.add({
        severity: 'success',
        summary: 'Éxito',
        detail: `${this.data.length} productos cargados`
      });
    } catch (error: any) {
      console.error('Error:', error);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: error.message || 'Error al cargar productos'
      });
    } finally {
      this.loading = false;
    }
  }

  async loadSuppliers() {
    this.loading = true;
    try {
      this.data = await this.supabaseService.getSuppliers();
      this.columns = this.data.length > 0 ? Object.keys(this.data[0]) : [];
      
      this.messageService.add({
        severity: 'success',
        summary: 'Éxito',
        detail: `${this.data.length} proveedores cargados`
      });
    } catch (error: any) {
      console.error('Error:', error);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: error.message || 'Error al cargar proveedores'
      });
    } finally {
      this.loading = false;
    }
  }

  async loadLocations() {
    this.loading = true;
    try {
      this.data = await this.supabaseService.getLocations();
      this.columns = this.data.length > 0 ? Object.keys(this.data[0]) : [];
      
      this.messageService.add({
        severity: 'success',
        summary: 'Éxito',
        detail: `${this.data.length} locations loaded`
      });
    } catch (error: any) {
      console.error('Error:', error);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: error.message || 'Error loading locations'
      });
    } finally {
      this.loading = false;
    }
  }

  async createTestProduct() {
    this.loading = true;
    try {
      const newProduct = {
        name: 'Producto de Prueba',
        description: 'Creado desde Angular + Supabase',
        price: 99.99,
        stock: 10,
        active: true
      };

      const result = await this.supabaseService.createProduct(newProduct);
      
      this.messageService.add({
        severity: 'success',
        summary: 'Producto Creado',
        detail: `ID: ${result.id}`
      });

      // Recargar productos
      await this.loadProducts();
    } catch (error: any) {
      console.error('Error:', error);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: error.message || 'Error al crear producto'
      });
    } finally {
      this.loading = false;
    }
  }
}
