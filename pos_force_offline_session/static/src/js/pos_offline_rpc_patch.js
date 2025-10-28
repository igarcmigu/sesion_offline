/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/store/pos_store";

// 🛑 GUARDIA GLOBAL CONTRA DOBLE CARGA
if (window.POSPosStorePatchLoaded) { return; }
window.POSPosStorePatchLoaded = true;

// =================================================================
// 🎯 CONFIGURACIÓN E INTERFAZ DE INDEXEDDB PARA DATOS MAESTROS (DEFINICIONES)
// Se mantienen las definiciones aunque no se usen en el patch, por si se reintroducen.
// =================================================================

const MASTER_DB_NAME = "POS_MASTER_DATA";
const MASTER_DB_VERSION = 1;

// Object Stores for our IndexedDB
const STORES = {
    PRODUCTS: 'products',
    PARTNERS: 'partners',
    TAXES: 'taxes',
};

// --- Función para abrir/crear la DB ---
function getMasterIndexedDB() {
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
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => {
            console.error("🔴 Error al abrir IndexedDB de Maestros:", e.target.error);
            reject(e.target.error);
        };
    });
}

// Lógica de Guardado/Carga (Mantenida como funciones puras pero sin uso en este patch)
async function saveMasterData(data) { /* ... */ }
async function loadMasterData() { /* ... */ }


// =================================================================
// 🎯 FUNCIONES DE AYUDA Y MOCKING
// =================================================================

// --- Función nativa para parsear parámetros del hash de la URL ---
function getHashParameters() {
    const hash = window.location.hash.substring(1);
    const params = {};
    if (hash) {
        hash.split('&').forEach(part => {
            const [key, value] = part.split('=');
            if (key) {
                params[key] = decodeURIComponent(value);
            }
        });
    }
    // FIX: El return debe estar dentro de la función, al final.
    return params;
}

// --- Function to patch the RPC service for offline mocking ---
function patchRpcService(env) {
    // Obtenemos la función original para poder llamarla cuando estemos online
    const originalQuery = env.services.rpc.query;
    
    env.services.rpc.query = async function(route, args = {}) {
        const currentHash = getHashParameters();
        const forceOffline = currentHash.force_offline === '1';
        
        const model = args.model || (route.includes('/call_kw/') ? route.split('/call_kw/')[1].split('/')[0] : null);
        const method = args.method;

        // --- DEBUG LOGGING: Imprimimos todas las RPCs que pasan por el parche ---
        if (model) {
            console.log(`[RPC DEBUG] Model: ${model}, Method: ${method}`);
        } else {
            console.log(`[RPC DEBUG] Route: ${route}`);
        }
        // ------------------------------------------------------------------------

        // 1. Si NO estamos forzando el modo offline, o si estamos conectados, 
        // ejecutamos la RPC original.
        if (!forceOffline || navigator.onLine) {
            return originalQuery.apply(this, arguments);
        }

        // 2. Estamos en modo OFFLINE FORZADO y la red está inactiva.
        
        if (model) {
            // a) Barcode Nomenclatures (el bloqueo inmediato)
            if (model === 'barcode.nomenclature' && method === 'read') {
                console.warn("🟢 RPC MOCK: Interceptado y mockeado 'barcode.nomenclature/read'.");
                // Devuelve una lista vacía para que el barcode_reader se inicialice
                return Promise.resolve([]); 
            }
            
            // b) La carga principal (ya interceptada por load_server_data, pero mantenemos por si acaso)
            if (model === 'pos.session' && method === 'load_pos_data') {
                console.warn("🟢 RPC MOCK: Interceptado y mockeado 'pos.session/load_pos_data'. Devolviendo un objeto vacío.");
                // Devolvemos un objeto vacío, ya que el bypass en load_server_data manejará la configuración.
                return Promise.resolve({}); 
            }

            // c) Permitimos que la sincronización de pedidos falle (comportamiento deseado)
            if (model === 'pos.order' && (method === 'create_from_ui' || method === 'search_read')) {
                 console.warn(`🔴 RPC PASS: Dejando pasar la llamada a pos.order/${method} para que falle (Comportamiento deseado).`);
                 // Llamamos a la original, que fallará con ERR_INTERNET_DISCONNECTED
                 return originalQuery.apply(this, arguments);
            }
            
            // d) Mockeamos otras llamadas secundarias
            console.warn(`🟢 RPC MOCK: Interceptado y mockeado RPC secundario a ${model}/${method}.`);
            return Promise.resolve([]); 
        }
        
        // Mock por defecto para rutas no relacionadas con modelos (ej. /web/session/authenticate)
        return Promise.resolve({});
    };
}


// =================================================================
// 🎯 PATCH PosStore: SOLO MANEJO DE CONECTIVIDAD Y MOCKING
// =================================================================

patch(PosStore.prototype, {
    __OWL_DEBUG__: "pos_offline_session.PosStorePatch",

    // -----------------------------------------------------------
    // 0. Setup (Aplica el Parche RPC)
    // -----------------------------------------------------------
    async setup(...args) {
        console.log("🔥 [PRE-SETUP] Iniciando PosStore setup. Intentando inicialización base."); // Log de diagnóstico A
        
        try {
            // 1. Inicializa el entorno (this.env) y servicios. 
            await super.setup(...args); 
            console.log("🔥 [POST-SETUP] Super setup finalizado SIN ERRORES de red."); // Log de diagnóstico B (si no falló)
        } catch (e) {
            // Capturamos el error de RPC para que la ejecución continúe y podamos aplicar el parche.
            console.warn("⚠️ [SETUP CATCH] Fallo en la inicialización base (posiblemente por red). Detalle del error:", e);
        }

        // 2. Aplica el parche RPC. Esto se ejecuta incluso si super.setup() falló.
        if (this.env && this.env.services && this.env.services.rpc) {
            patchRpcService(this.env);
            console.log("✅ RPC Service patched successfully. Subsequent RPCs will be MOCKED."); // Log de diagnóstico C
        } else {
             // Este caso solo debería ocurrir si el error fue más grave que una simple falla de RPC.
             console.error("🔴 CRÍTICO: No se pudo acceder al servicio RPC después del setup.");
        }
        
        // 3. Verificación de DB de Maestros.
        getMasterIndexedDB()
            .then(() => console.log("✅ IndexedDB de Maestros verificada/creada."))
            .catch(e => console.error("🔴 IndexedDB de Maestros falló la verificación inicial.", e));
    },

    // -----------------------------------------------------------
    // 1. Engañar al chequeo de conectividad (isOnline)
    // -----------------------------------------------------------
    get isOnline() {
        const currentHash = getHashParameters();
        const forceOffline = currentHash.force_offline === '1';

        if (forceOffline && !navigator.onLine) {
            console.warn("🟢 OFFLINE SPOOFING: ¡Conexión falseada! Cuidado al operar.");
            return true;
        }

        return super.isOnline;
    },

    // -----------------------------------------------------------
    // 2. Interceptar la carga inicial (load_server_data)
    // -----------------------------------------------------------
    async load_server_data() {
        const currentHash = getHashParameters();
        const forceOffline = currentHash.force_offline === '1';

        if (forceOffline && !navigator.onLine) {
            console.warn("🟢 INTERCEPCIÓN LOAD_SERVER_DATA: Modo Offline forzado. Estableciendo configuración mínima.");

            // --- FIX CRÍTICO para el error 'cannot read properties of null reading module_pos_hr' ---
            // Sobrescribimos la lógica de carga para establecer la configuración mínima y evitar fallos de null.

            const MOCK_CONFIG = {
                id: 1, 
                name: "Offline POS Config",
                module_pos_hr: false, // <-- SOLUCIÓN al error 'module_pos_hr'
                module_pos_discount: false, 
                currency_id: [1, "EUR"],
                company_id: [1, "Offline Company"],
                // Odoo 17 espera que ciertas propiedades existan en 'this.config'
                payment_method_ids: [],
                pricelist_id: [1, "Default Pricelist"],
            };
            
            // Establecemos la configuración mínima directamente en la instancia de PosStore
            this.config = MOCK_CONFIG;
            
            // Establecemos una sesión mínima (necesario para el flujo de Odoo)
            this.pos_session = {
                id: 99999, 
                user_id: [1, "Odoo User"], 
                name: "Offline Session",
                config_id: [MOCK_CONFIG.id, MOCK_CONFIG.name],
                currency_id: MOCK_CONFIG.currency_id,
            };

            // Establecemos arrays vacíos para otros datos que Odoo intentará leer
            this.taxes = [];
            this.companies = [];
            this.partners = [];
            this.products = [];

            // Devolvemos {} para que el flujo de Odoo continúe y llame a after_load_server_data
            return Promise.resolve({}); 
        }

        return super.load_server_data(...arguments);
    },

    // -----------------------------------------------------------
    // 3. Sobrescribir el método de inicialización de la DB (init_db)
    // -----------------------------------------------------------
    async init_db() {
        // Usa la función original de Odoo.
        return super.init_db(...arguments);
    },

    // -----------------------------------------------------------
    // 4. Parchear el método POST-CARGA para GUARDAR la data (after_load_server_data)
    // -----------------------------------------------------------
    async after_load_server_data() {
        // Usa la función original de Odoo.
        await super.after_load_server_data(...arguments);
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

// Ejecutar el registro
registerServiceWorker();