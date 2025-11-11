/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { Chrome } from "@point_of_sale/app/pos_app";

patch(Chrome.prototype, {
    setup() {
        super.setup();
        this.onBeforeUnload = this.onBeforeUnload.bind(this);
        window.addEventListener('beforeunload', this.onBeforeUnload);
    },

    onWillUnmount() {
        window.removeEventListener('beforeunload', this.onBeforeUnload);
        super.onWillUnmount();
    },

    // ⬇️ SECCIÓN CORREGIDA: Ya NO es async
    onBeforeUnload(e) {
        const isOffline = this.pos && this.pos.isCurrentlyOffline;

        if (isOffline && this.pos && this.pos._saveLog) {
            try {
                // CORREGIDO: Usar la función correcta para obtener las órdenes
                const orderCount = this.pos.get_order_list()?.length || 0;
                
                // Llamada "fire-and-forget": No usamos await
                this.pos._saveLog(
                    'attempted_reload_close', 
                    `El usuario ha intentado recargar o cerrar la ventana (evento beforeunload) estando OFFLINE. Órdenes pendientes: ${orderCount}.`
                );
            } catch (err) {
                console.error("Error al iniciar log de 'beforeunload'", err);
            }
        }

        if (!isOffline) {
            return;
        }
        
        // Muestra la advertencia del navegador
        e.preventDefault();
    },
    // ⬆️ FIN SECCIÓN CORREGIDA
});