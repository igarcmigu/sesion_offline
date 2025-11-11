/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/store/pos_store";
import { Product } from "@point_of_sale/app/store/models"; 
import { ConnectionLostError } from "@web/core/network/rpc_service";
// NOTA: 'registry' ya no es necesario importarlo aquí.

// 🛑 GUARDIA GLOBAL Y ESTADO (V15)
// ¡GUARDIA 'POSPosStorePatchLoaded' ELIMINADA PARA PREVENIR EL ABORTO DE CARGA!
window.posOfflineDataHandler = window.posOfflineDataHandler || {};
console.log("🔥 [LOAD CHECK] pos_offline_data_handler.js ha iniciado la ejecución (V15: Guardia Eliminada).");


// =================================================================
// ⚙️ Dependencias y Configuración Inicial
// =================================================================
const DB_NAME = "OdooPOSMasterData";
const DB_VERSION = 3; 
const STORES = {
    PRODUCTS: "products",
    PARTNERS: "partners",
    TAXES: "taxes",
    UOMS: "uoms",
    UOM_CATEGORIES: "uom_categories",
};

// =================================================================
// 🛠️ Funciones Auxiliares de IndexedDB (NO TOCAR)
// =================================================================

let indexedDBInstance = null;
function getMasterIndexedDB() {
    return new Promise((resolve, reject) => {
        if (indexedDBInstance) { return resolve(indexedDBInstance); }
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = function(event) {
            const db = event.target.result;
            console.log(`[IDB UPGRADE] Creando/Actualizando DB: ${DB_NAME} a V${DB_VERSION}`);
            for (const storeName of Object.values(STORES)) {
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName, { keyPath: "id" });
                }
            }
        };
        request.onsuccess = function(event) {
            indexedDBInstance = event.target.result;
            console.log("✅ [IDB INIT] Base de datos de Maestros verificada.");
            resolve(indexedDBInstance);
        };
        request.onerror = function(event) {
            console.error("🔴 [IDB INIT] Error al abrir IndexedDB:", event.target.errorCode);
            reject(new Error("Error al inicializar IndexedDB"));
        };
    });
}

async function loadAllFromStore(storeName) {
    try {
        const db = await getMasterIndexedDB();
        const transaction = db.transaction(storeName, "readonly");
        const store = transaction.objectStore(storeName);
        
        return new Promise((resolve) => {
            const request = store.getAll();
            request.onsuccess = function(event) {
                const data = event.target.result || [];
                console.log(`✅ [IDB Load] Cargados ${data.length} registros de '${storeName}'.`);
                resolve(data);
            };
            request.onerror = function() {
                console.error(`🔴 [IDB Load] Error al cargar ${storeName}.`);
                resolve([]);
            };
        });
    } catch (e) {
        console.error(`🔴 [IDB Load] Error al acceder a la DB para ${storeName}.`, e);
        return [];
    }
}

async function saveAllToStore(storeName, data) {
    if (!data || data.length === 0) return Promise.resolve();

    try {
        const db = await getMasterIndexedDB();
        const transaction = db.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        
        await new Promise(resolve => {
            const clearRequest = store.clear();
            clearRequest.onsuccess = resolve;
            clearRequest.onerror = (e) => { console.error(`🔴 [IDB Save] Error al limpiar ${storeName}`, e); resolve(); };
        });

        for (const item of data) {
            if (item && item.id) {
                store.put(item);
            }
        }

        return new Promise((resolve, reject) => {
            transaction.oncomplete = resolve;
            transaction.onerror = function(event) {
                console.error(`🔴 [IDB Save] Fallo de transacción para ${storeName}.`, event.target.error);
                reject(event.target.error);
            };
        });

    } catch (e) {
        console.error(`🔴 [IDB Save] Fallo crítico en saveAllToStore para ${storeName}.`, e);
        return Promise.reject(e);
    }
}

// =================================================================
// 🛠️ Control de Modo
// =================================================================

/** Reutiliza el estado definido por el archivo de service_mock.js */
function isPatchingOfflineMode() {
    // Aseguramos que la función exista en el window global (cargada por rpc_patch.js)
    if (window.posOfflineDataHandler && typeof window.posOfflineDataHandler.isOfflineModeActive === 'boolean') {
        return window.posOfflineDataHandler.isOfflineModeActive;
    }
    // Fallback por si acaso (aunque no debería pasar si rpc_patch.js carga primero)
    if (typeof getUrlParameters !== 'undefined') {
        const urlParams = getUrlParameters();
        const forceOffline = urlParams.force_offline === '1';
        const isBrowserOffline = (typeof navigator !== 'undefined') && (navigator.onLine === false);
        return forceOffline || isBrowserOffline;
    }
    return false;
}

// =================================================================
// 🎯 PATCH 1: Product Model 
// =================================================================

function patchProductModelInStore(pos) {
    const ProductPrototype = Product ? Product.prototype : (pos?.models?.Product?.prototype);
    if (!ProductPrototype) { return; }
        
    if (ProductPrototype.getAddProductOptions && !ProductPrototype.getAddProductOptions._isPatched) {
        const originalGetAddProductOptions = ProductPrototype.getAddProductOptions;
        
        patch(ProductPrototype, {
            getAddProductOptions(options) {
                if (!this.pos) {
                    this.pos = pos;
                    console.warn("⚠️ [Product Fix] Inyectada referencia 'pos' faltante en el Producto para 'config'.");
                }
                const result = originalGetAddProductOptions.call(this, options);
                this.getAddProductOptions._isPatched = true;
                return result;
            },
        });
        console.log("✅ [ProductPatch] getAddProductOptions parcheado con inyección de 'pos'.");
    }

    if (!ProductPrototype.getFormattedUnitPrice || ProductPrototype.getFormattedUnitPrice._isPatched) { 
        // Ya parcheado o no aplicable
    } else {
        patch(ProductPrototype, {
            __OWL_DEBUG__: "pos_offline_session.ProductPatchRuntime",
            
            getFormattedUnitPrice(price) {
                const formatPrice = this.pos?.env?.utils?.formatPrice;
                if (formatPrice) {
                    this.getFormattedUnitPrice._isPatched = true; 
                    return formatPrice(price);
                }
                let actualPrice = typeof price === 'number' ? price : (this.get_price ? this.get_price() : this.list_price || 0);
                const currencySymbol = this.pos?.currency?.symbol || ' €';
                this.getFormattedUnitPrice._isPatched = true;
                return actualPrice.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + currencySymbol;
            },
        });
        console.log("✅ [ProductPatch] getFormattedUnitPrice aplicado correctamente.");
    }
}


// =================================================================
// 🎯 PATCH 2: PosStore - Lógica Central de Carga de Datos
// =================================================================

patch(PosStore.prototype, {
    __OWL_DEBUG__: "pos_offline_session.PosStoreDataHandlerPatchV15", // Versión V15

    async load_data_from_indexed_db() {
        const MOCK_CURRENCY = { id: 1, name: "EUR", symbol: "€", position: "after" };

        const [products, partners, taxes, uoms, uomCategories] = await Promise.all([
            loadAllFromStore(STORES.PRODUCTS),
            loadAllFromStore(STORES.PARTNERS),
            loadAllFromStore(STORES.TAXES),
            loadAllFromStore(STORES.UOMS), 
            loadAllFromStore(STORES.UOM_CATEGORIES),
        ]);

        this.config = this.config || {}; 
        
        // Mocks CRÍTICOS para que la interfaz sepa qué mostrar.
        this.config.id = 1;
        this.config.name = "Offline POS Config";
        this.config.currency_id = this.config.currency_id || [1, "EUR"];
        this.config.company_id = this.config.company_id || [1, "Offline Company"];
        this.config.payment_method_ids = this.config.payment_method_ids || [];
        this.config.pricelist_id = this.config.pricelist_id || [1, "Default Pricelist"];
        this.config.module_pos_hr = this.config.module_pos_hr || false; 
        this.config.default_fiscal_position_id = this.config.default_fiscal_position_id || false;
        this.config.iface_customer_facing_display = this.config.iface_customer_facing_display || false;
        this.config.current_session_id = this.config.current_session_id || 99999; 
        this.config.uom_id = this.config.uom_id || [1, "Unidades"]; 
        this.config.cash_control = this.config.cash_control || false;
        this.config.journal_id = this.config.journal_id || [1, "Diario de Caja Mock"]; 
        
        this.pos_session = this.pos_session || {};
        this.pos_session.id = this.pos_session.id || 99999; 
        this.pos_session.user_id = this.pos_session.user_id || [1, "Odoo User"];
        this.pos_session.name = this.pos_session.name || "Offline Session";
        this.pos_session.currency_id = this.pos_session.currency_id || MOCK_CURRENCY.id;

        this.currency = this.currency || MOCK_CURRENCY;
        
        this.taxes = taxes;
        this.partners = partners;
        this.products = products; 
        
        this.uoms = uoms;
        this.uom_categories = uomCategories;
        this.units_by_id = uoms.reduce((acc, u) => { 
            if (u && u.id) { acc[u.id] = u; } else { console.error("🔴 [UoM Load] Registro de UoM sin ID. Omitido."); }
            return acc; 
        }, {});

        if (this.db) {
            if (products.length > 0) { this.db.add_products(products); }
            if (partners.length > 0) { this.db.add_partners(partners); }
        }
        
        console.log("✅ Offline Data Loaded and Assigned from IndexedDB.");
    },

    // MÉTODO SETUP CORREGIDO (V15)
    async setup(...args) {
        console.log("🔥 [PRE-SETUP] Iniciando PosStore setup parcheado (V15 - DataHandler).");
        
        patchProductModelInStore(this);
        
        try {
            // Llama al setup de V11 (rpc_patch), que llama al setup de Odoo
            await super.setup(...args); 
            console.log("🔥 [POST-SETUP V15] Super setup (V11) finalizado.");
        } catch (e) {
            // Captura el error relanzado por V11
            if (isPatchingOfflineMode() && (e instanceof ConnectionLostError || (e && e.message && e.message.includes('Connection is offline')))) {
                console.warn("⚠️ [SETUP CATCH V15] Fallo de conexión capturado. Inicializando mocks mínimos y continuando a load_server_data.", e);
                
                // Mocks mínimos (Aunque V11 ya los puso, re-aseguramos)
                const MOCK_CURRENCY = { id: 1, name: "EUR", symbol: "€", position: "after" };
                this.config = this.config || { id: 1, name: "Offline POS Config" }; 
                this.pos_session = this.pos_session || { id: 99999, name: "Offline Session" };
                this.currency = this.currency || MOCK_CURRENCY;

                // Retornar resuelve la promesa del setup, permitiendo que el framework llame a load_server_data
                return; 
            }
            console.error("🔴 [SETUP CRÍTICO V15] Fallo catastrófico en la inicialización base.", e);
            throw e;
        }
    },
    
    async load_server_data() {
        if (isPatchingOfflineMode()) {
            console.warn("🟢 [IDB INTERCEPT V15] Modo Offline/Forzado. Interceptando carga del servidor.");
            
            try {
                // ESTA ES LA LÓGICA VITAL QUE FALTABA
                await this.load_data_from_indexed_db(); 
                
            } catch (error) {
                console.error("🔴 Error CRÍTICO al cargar datos de IndexedDB. Reintentando carga del servidor (fallará en offline).", error);
                return super.load_server_data(...arguments);
            }
            
            return Promise.resolve({}); 
        }

        try {
             return await super.load_server_data(...arguments);
        } catch (error) {
            if (error instanceof ConnectionLostError && isPatchingOfflineMode()) {
                console.warn("⚠️ [ConnectionLoss] Conexión perdida durante la carga. Forzando modo Offline. ERROR:", error.message);
                // Si falla por conexión en modo online, forzamos la recarga en modo offline.
                return this.load_server_data(); 
            }
            throw error; 
        }
    },

    async after_load_server_data() {
        await super.after_load_server_data(...arguments);

        if (isPatchingOfflineMode() && !this.get_order()) {
            this.add_new_order();
            console.log("✅ [Order Fix] Creada nueva orden para permitir el renderizado Offline.");
        }

        if (!isPatchingOfflineMode()) {
            console.log("💾 [IDB Save V15] Persistiendo datos recién cargados en IDB.");
            
            const cleanAndSerialize = (item) => {
                const rawData = item.export_as_JSON ? item.export_as_JSON() : item;
                if (!rawData || typeof rawData !== 'object' || !rawData.id) { return null; }
                delete rawData.pos; delete rawData.env; delete rawData._active; delete rawData.__parent; 
                try { return JSON.parse(JSON.stringify(rawData)); } 
                catch (e) {
                    console.error(`🔴 [IDB Serialización Fallida] Fallo de serialización para item con ID ${rawData.id}. Omitiendo.`, e);
                    return null;
                }
            };

            const productsToSave = Object.values(this.db.product_by_id || {}).map(cleanAndSerialize).filter(p => p !== null);
            const partnersToSave = Array.from(this.partners || []).map(cleanAndSerialize).filter(p => p !== null);
            const taxesToSave = Array.from(this.taxes || []).map(cleanAndSerialize).filter(t => t !== null);
            let uomCategoriesSource = Array.isArray(this.uom_categories) ? this.uom_categories : Object.values(this.uom_categories || {});
            const uomsToSave = Object.values(this.units_by_id || {}).map(cleanAndSerialize).filter(u => u !== null);
            const uomCategoriesToSave = Array.from(uomCategoriesSource).map(cleanAndSerialize).filter(c => c !== null);

            if (productsToSave.length > 0 || partnersToSave.length > 0 || taxesToSave.length > 0) {
                try {
                    await Promise.all([
                        saveAllToStore(STORES.PRODUCTS, productsToSave),
                        saveAllToStore(STORES.PARTNERS, partnersToSave),
                        saveAllToStore(STORES.TAXES, taxesToSave),
                        saveAllToStore(STORES.UOMS, uomsToSave), 
                        saveAllToStore(STORES.UOM_CATEGORIES, uomCategoriesToSave),
                    ]);
                    console.log(`✅ [IDB Save V15] Persistencia finalizada.`);
                } catch (error) {
                    console.error("🔴 [IDB Save V15] Fallo CRÍTICO al guardar.", error);
                }
            }
        }
    },
});

// Inicialización de la DB para garantizar que los stores existen
getMasterIndexedDB()
    .catch(e => console.error("🔴 [IDB INIT V15] Fallo al inicializar la base de datos.", e));