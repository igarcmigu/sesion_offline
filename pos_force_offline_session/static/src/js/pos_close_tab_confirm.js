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

    onBeforeUnload(e) {
        const isOffline = this.pos && this.pos.isCurrentlyOffline;
        if (!isOffline) {
            return;
        }
        e.preventDefault();

    },
});