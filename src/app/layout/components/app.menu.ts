import { Component, ElementRef, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MenuItem } from 'primeng/api';
import { AppMenuitem } from './app.menuitem';

@Component({
    selector: '[app-menu]',
    standalone: true,
    imports: [CommonModule, AppMenuitem, RouterModule],
    template: `<div class="layout-menu-container" #menuContainer>
        <ul class="layout-menu">
            <ng-container *ngFor="let item of model; let i = index">
                <li app-menuitem *ngIf="!item.separator" [item]="item" [index]="i" [root]="true"></li>
                <li *ngIf="item.separator" class="menu-separator"></li>
            </ng-container>
        </ul>
    </div>`
})
export class AppMenu {
    el: ElementRef = inject(ElementRef);

    @ViewChild('menuContainer') menuContainer!: ElementRef;

    model: MenuItem[] = [
        {
            label: 'Productos',
            icon: 'pi pi-shopping-cart',
            items: [
                {
                    label: 'Gestión de Productos',
                    icon: 'pi pi-list',
                    routerLink: ['/productos']
                },
                {
                    label: 'Nuevo Producto',
                    icon: 'pi pi-plus-circle',
                    routerLink: ['/productos/nuevo']
                }
            ]
        },
        {
            label: 'Proveedores',
            icon: 'pi pi-building',
            items: [
                {
                    label: 'Gestión de Proveedores',
                    icon: 'pi pi-list',
                    routerLink: ['/proveedores']
                },
                {
                    label: 'Nuevo Proveedor',
                    icon: 'pi pi-plus-circle',
                    routerLink: ['/proveedores/nuevo']
                }
            ]
        },
        {
            label: 'Locations',
            icon: 'pi pi-map-marker',
            items: [
                {
                    label: 'Location Management',
                    icon: 'pi pi-list',
                    routerLink: ['/locations']
                },
                {
                    label: 'New Location',
                    icon: 'pi pi-plus-circle',
                    routerLink: ['/locations/new']
                },
                {
                    label: 'Layout Designer',
                    icon: 'pi pi-map',
                    routerLink: ['/almacen/disenador']
                }
            ]
        }
    ];
}
