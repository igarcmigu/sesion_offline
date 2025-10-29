/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/store/pos_store";
// Se eliminó la importación problemática: import * as pos_utils from "@point_of_sale/utils"; 
import { Product } from "@point_of_sale/app/store/models"; 

// 🛑 GUARDIA GLOBAL CONTRA DOBLE CARGA
if (window.POSPosStorePatchLoaded) { return; }
window.POSPosStorePatchLoaded = true;

// =================================================================
// 🎯 CONFIGURACIÓN Y FUNCIONES CORE DE INDEXEDDB
// =================================================================

const MASTER_DB_NAME = "POS_MASTER_DATA";
const MASTER_DB_VERSION = 1;
const STORES = {
    PRODUCTS: 'products',
    PARTNERS: 'partners',
    TAXES: 'taxes',
};
let masterDBInstance = null;

function getMasterIndexedDB() {
    if (masterDBInstance) { return Promise.resolve(masterDBInstance); }
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(MASTER_DB_NAME, MASTER_DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            for (const storeName of Object.values(STORES)) {
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName, { keyPath: 'id' });
                }
            }
        };
        request.onsuccess = (e) => { masterDBInstance = e.target.result; resolve(masterDBInstance); };
        request.onerror = (e) => {
            console.error("🔴 Error al abrir IndexedDB de Maestros:", e.target.error);
            reject(e.target.error);
        };
    });
}

async function loadAllFromStore(storeName) {
    try {
        const db = await getMasterIndexedDB();
        const transaction = db.transaction(storeName, "readonly");
        const store = transaction.objectStore(storeName);

        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => {
                const records = request.result;
                console.log(`✅ [IndexedDB Load] Cargados ${records.length} registros de '${storeName}'.`);
                resolve(records);
            };
            request.onerror = (e) => {
                console.error(`🔴 [IndexedDB Load FALLO] Error al cargar registros de '${storeName}'.`, e.target.error);
                reject(e.target.error);
            };
        });
    } catch (e) {
        console.error(`🔴 [IndexedDB CRÍTICO] Fallo catastrófico durante loadAllFromStore en '${storeName}'.`, e);
        return [];
    }
}


async function saveAllToStore(storeName, records) {
    if (!records || records.length === 0) {
        console.warn(`[IndexedDB] No hay registros para guardar en el almacén '${storeName}'.`);
        return;
    }

    try {
        const db = await getMasterIndexedDB();
        const transaction = db.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        console.log(`[IndexedDB] Iniciando guardado de ${records.length} registros en '${storeName}'.`);

        // 1. Limpiar la tienda
        const clearRequest = store.clear();
        await new Promise(res => { 
            clearRequest.onsuccess = () => res(); 
            clearRequest.onerror = (e) => { 
                console.error(`[IndexedDB] Error al limpiar '${storeName}':`, e.target.error); 
                res(); 
            }; 
        });

        // 2. Insertar todos los registros
        let putPromises = [];
        records.forEach(record => {
            if (!record || !record.id) { console.error(`🔴 [IndexedDB] Registro omitido en '${storeName}' (sin 'id'):`, record); return; }
            const putRequest = store.put(record);
            putPromises.push(new Promise(res => { 
                putRequest.onsuccess = () => res(); 
                putRequest.onerror = (e) => { 
                    console.error(`🔴 [IndexedDB PUT FALLO] Error al guardar registro id ${record.id} en '${storeName}'.`, e.target.error); 
                    res(); 
                }; 
            }));
        });

        await Promise.all(putPromises);

        // 3. Esperar a que la transacción termine
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = (e) => { console.error(`🔴 [IndexedDB] Transacción fallida para '${storeName}'.`, e.target.error); reject(e.target.error); };
        });

    } catch (e) {
        console.error(`🔴 [IndexedDB CRÍTICO] Fallo catastrófico durante saveAllToStore en '${storeName}'.`, e);
        throw e;
    }
}


// =================================================================
// 🎯 FUNCIONES DE AYUDA Y MOCKING
// =================================================================

function parseParams(paramString) {
    const params = {};
    if (paramString) {
        paramString.split('&').forEach(part => {
            const [key, value] = part.split('=');
            if (key) {
                params[key] = decodeURIComponent(value || 'true');
            }
        });
    }
    return params;
}

function getUrlParameters() {
    if (typeof window === 'undefined' || !window.location) { return {}; }
    const searchParams = parseParams(window.location.search.substring(1));
    const hashParams = parseParams(window.location.hash.substring(1));
    return { ...searchParams, ...hashParams };
}

function patchRpcService(env) {
    const originalQuery = env.services.rpc.query;
    
    env.services.rpc.query = async function(route, args = {}) {
        const currentParams = getUrlParameters();
        const forceOffline = currentParams.force_offline === '1';
        
        if (!forceOffline) {
            return originalQuery.apply(this, arguments);
        }
        
        const model = args.model || (route.includes('/call_kw/') ? route.split('/call_kw/')[1].split('/')[0] : null);
        const method = args.method;
        
        if (model) {
            if (model === 'barcode.nomenclature' && method === 'read') { return Promise.resolve([]); }
            if (model === 'pos.session' && method === 'load_pos_data') { return Promise.resolve({}); }
            if (model === 'pos.order' && (method === 'create_from_ui' || method === 'search_read')) { 
                return originalQuery.apply(this, arguments);
            }
            console.warn(`🟢 RPC MOCK: Mockeado RPC secundario a ${model}/${method}.`);
            return Promise.resolve([]); 
        }
        
        return Promise.resolve({});
    };
}


// =================================================================
// 🎯 FUNCIÓN: Parchear el modelo Product (SOLUCIÓN CRÍTICA al error 'utils')
// =================================================================

/**
 * Parchea el método getFormattedUnitPrice del modelo Product para usar 
 * el formateador de moneda del PosStore.
 */
function patchProductModelInStore(pos) {
    // 1. Obtener prototipo
    const ProductPrototype = Product ? Product.prototype : (pos.models?.Product?.prototype);
    
    if (!ProductPrototype) {
        console.error("🔴 [ProductPatch CRÍTICO] FALLO. No se pudo acceder al prototipo de Product.");
        return false;
    }
    
    // 2. Comprobar si ya está parcheado
    if (ProductPrototype.getFormattedUnitPrice && ProductPrototype.getFormattedUnitPrice._isPatched) {
        return true; 
    }
    
    // 3. Obtener el formateador de precio del POS Store antes de aplicar el parche.
    const formatPrice = pos.env.utils?.formatPrice;
    
    if (!formatPrice) {
        console.error("🔴 [ProductPatch CRÍTICO] FALLO. No se pudo encontrar la función formatPrice en pos.env.utils. El formato será básico.");
        // Continuamos, pero el parche tendrá un fallback.
    }
    
    patch(ProductPrototype, {
        __OWL_DEBUG__: "pos_offline_session.ProductPatchRuntime",
        
        getFormattedUnitPrice(price) {
            // 🚨 USO DE LA FUNCIÓN CAPTURADA EN EL ÁMBITO SUPERIOR.
            if (formatPrice) {
                 this.getFormattedUnitPrice._isPatched = true; // Marcar como parcheado
                 return formatPrice(price);
            }
            
            // Fallback CRÍTICO: Devolver el precio como STRING para evitar el OwlError en ProductCard.
            console.warn("⚠️ [ProductPatch FALLBACK] Devolviendo precio como String sin formato.");
            return String(price); 
        },
    });

    console.log("✅ [ProductPatch] getFormattedUnitPrice aplicado correctamente al modelo Product.");
    return true;
}


// =================================================================
// 🎯 PATCH PosStore: Ejecución del parche y manejo de IndexDB
// =================================================================

patch(PosStore.prototype, {
    __OWL_DEBUG__: "pos_offline_session.PosStorePatch",

    async setup(...args) {
        console.log("🔥 [PRE-SETUP] Iniciando PosStore setup. Intentando inicialización base.");
        
        if (this.env && this.env.services && this.env.services.rpc && !this.env.services.rpc._isPatched) {
            patchRpcService(this.env);
            this.env.services.rpc._isPatched = true; 
        }
        
        let setupSuccess = false;
        try {
            await super.setup(...args); 
            console.log("🔥 [POST-SETUP] Super setup finalizado (ÉXITO).");
            setupSuccess = true;
        } catch (e) {
            console.warn("⚠️ [SETUP CATCH] Fallo en la inicialización base (Servicio fallido). Detalle del error:", e);
        }
        
        const currentParams = getUrlParameters();
        const forceOffline = currentParams.force_offline === '1';

        if (!setupSuccess && forceOffline) {
             console.warn("⚠️ FORZANDO FLUJO OFFLINE: Se ha saltado la carga de servicios inicial. Ejecutando data-loaders manualmente.");
             
             await this.load_server_data();
             await this.init_db();
             await this.after_load_server_data();
             
             console.warn("✅ Flujo de carga de datos offline completado. Continuando el arranque.");
        } else if (!setupSuccess && !forceOffline) {
            console.error("🚫 FLUJO OFFLINE CANCELADO: Inicialización fallida.");
        }
        
        getMasterIndexedDB()
            .then(() => console.log("✅ IndexedDB de Maestros verificada/creada."))
            .catch(e => console.error("🔴 IndexedDB de Maestros falló la verificación inicial.", e));
    },

    get isOnline() {
        const currentParams = getUrlParameters();
        const forceOffline = currentParams.force_offline === '1';

        if (forceOffline && !navigator.onLine) {
            return true;
        }

        return super.isOnline;
    },

    async load_server_data() {
        const currentParams = getUrlParameters();
        const forceOffline = currentParams.force_offline === '1';

        if (forceOffline) {
            console.warn("🟢 INTERCEPCIÓN LOAD_SERVER_DATA: Modo Offline forzado. Cargando datos desde IndexedDB.");

            const MOCK_CONFIG = {
                id: 1, name: "Offline POS Config", module_pos_hr: false, module_pos_discount: false, 
                currency_id: [1, "EUR"], company_id: [1, "Offline Company"], payment_method_ids: [], 
                pricelist_id: [1, "Default Pricelist"], default_unit_of_measure_id: 1,
            };
            const MOCK_UOM = { 
                id: 1, name: "Unit(s)", factor: 1, rounding: 0.01, category_id: 1, measure_type: 'unit' 
            };

            const [products, partners, taxes] = await Promise.all([
                loadAllFromStore(STORES.PRODUCTS).catch(e => { console.error("Error cargando productos:", e); return []; }),
                loadAllFromStore(STORES.PARTNERS).catch(e => { console.error("Error cargando clientes:", e); return []; }),
                loadAllFromStore(STORES.TAXES).catch(e => { console.error("Error cargando impuestos:", e); return []; }),
            ]);

            console.log(`🔎 [DIAGNÓSTICO] Productos: ${products.length}, Clientes: ${partners.length}, Impuestos: ${taxes.length}.`);

            this.config = MOCK_CONFIG;
            this.pos_session = {
                id: 99999, user_id: [1, "Odoo User"], name: "Offline Session",
                config_id: [MOCK_CONFIG.id, MOCK_CONFIG.name], currency_id: MOCK_CONFIG.currency_id,
                stock_location_id: [1, "Mock Location"], default_unit_of_measure_id: 1,
            };
            
            this.taxes = taxes;
            this.companies = []; 
            this.partners = partners;
            this.products = products; 
            
            this.uoms = [MOCK_UOM];
            this.units_by_id = { 1: MOCK_UOM };
            this.units_by_name = { "Unit(s)": MOCK_UOM };

            return Promise.resolve({}); 
        }

        return super.load_server_data(...arguments);
    },

    async init_db() {
        // 🚨 Parche 1: Ejecutar antes de la inicialización de la base de datos local
        patchProductModelInStore(this);
        return super.init_db(...arguments);
    },

    async after_load_server_data() {
        // 🚨 Parche 2: Ejecutar antes de que los componentes empiecen a renderizar los datos
        patchProductModelInStore(this);

        // CRÍTICO: Ejecutar primero el core de Odoo.
        await super.after_load_server_data(...arguments);

        const currentParams = getUrlParameters();
        const forceOffline = currentParams.force_offline === '1';

        if (!forceOffline) {
            console.log("💾 [IndexedDB Pre-Save] Modo ONLINE detectado. Preparando datos para persistencia.");

            const cleanAndSerialize = (item) => {
                const rawData = item.export_as_JSON ? item.export_as_JSON() : item;
                if (rawData && typeof rawData === 'object') {
                    delete rawData.pos; delete rawData.env; delete rawData.partner_id; 
                }
                try { return JSON.parse(JSON.stringify(rawData)); } 
                catch (e) {
                    console.error(`🔴 [IndexedDB Serialización] Fallo de serialización para ID ${item.id}. Error:`, e);
                    return null;
                }
            };

            const productsToSave = Object.values(this.db.product_by_id || {}).map(cleanAndSerialize).filter(p => p !== null);
            const partnersToSave = Array.from(this.partners || []).map(cleanAndSerialize).filter(p => p !== null);
            const taxesToSave = Array.from(this.taxes || []).map(cleanAndSerialize).filter(t => t !== null);

            if (productsToSave.length > 0 || partnersToSave.length > 0 || taxesToSave.length > 0) {
                try {
                    await Promise.all([
                        saveAllToStore(STORES.PRODUCTS, productsToSave),
                        saveAllToStore(STORES.PARTNERS, partnersToSave),
                        saveAllToStore(STORES.TAXES, taxesToSave),
                    ]);
                    console.log(`✅ [IndexedDB Save] Persistencia finalizada. Productos: ${productsToSave.length}, Clientes: ${partnersToSave.length}, Impuestos: ${taxesToSave.length}.`);
                } catch (error) {
                    console.error("🔴 [IndexedDB Save] Fallo CRÍTICO al guardar.", error);
                }
            } else {
                console.warn("⚠️ [IndexedDB Save] No se detectaron datos del servidor. Omitiendo persistencia.");
            }
        }
    },
});


// =================================================================
// 🎯 REGISTRO DEL SERVICE WORKER
// =================================================================

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/pos_sw.js', {
            scope: '/'
        }).then(reg => {
            console.log('[SW Registration] Éxito. Scope de raíz permitido.');
        }).catch(error => {
            console.error('[SW Registration] Fallo en el registro del Service Worker.', error);
        });
    }
}

registerServiceWorker();