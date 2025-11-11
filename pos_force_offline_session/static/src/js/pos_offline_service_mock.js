/** @odoo-module **/

import { registry } from "@web/core/registry";
import { patch } from "@web/core/utils/patch";

// =================================================================
// 🎯 CONTROL DE ESTADO GLOBAL Y LECTURA DE PARÁMETROS (V63)
// =================================================================

// 🛑 GUARDIA: Evita la ejecución doble en caso de carga múltiple
if (window.POSServiceMockLoaded) {
    return;
}
window.POSServiceMockLoaded = true;
window.posOfflineDataHandler = window.posOfflineDataHandler || {};
const POS_APP_MODULE_NAME = '@point_of_sale/app/pos_app';

// Función IFFE para determinar y guardar el estado offline
const IS_OFFLINE_ACTIVE = (() => {
    // Si la aplicación ya está cargada y no es undefined, ya podemos usarla
    if (typeof window === 'undefined' || !window.location) return false;
    
    const urlParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const forceOffline = urlParams.get('force_offline') === '1' || hashParams.get('force_offline') === '1';
    const isBrowserOffline = (typeof navigator !== 'undefined') && (navigator.onLine === false);
    
    window.posOfflineDataHandler.isOfflineModeActive = forceOffline || isBrowserOffline;
    return window.posOfflineDataHandler.isOfflineModeActive;
})();

console.log(`🔥 [LOAD CHECK] pos_offline_service_mock.js ha iniciado la ejecución (V63: Fix de Traducción Profunda). Modo Offline Activo: ${IS_OFFLINE_ACTIVE}`);


// ----------------------------------------------------------------------
// 🛠️ Funciones Críticas de Parcheo
// ----------------------------------------------------------------------

/**
 * Aplica el parche de defensa a la clase PosApp/Chrome.
 * @param {Object} PosApp La clase PosApp (o Chrome)
 */
function applyCriticalPosAppPatch(PosApp) {
    // Evita doble parcheo en el mismo prototipo
    if (!PosApp || PosApp.prototype.pos_offline_posapp_setup_guard_v63_applied) {
        return false;
    }
    
    try {
        patch(PosApp.prototype, "pos_offline_posapp_setup_guard_v63_final", {
            setup() {
                try {
                    // Llama al setup original
                    super.setup(); 
                } catch (e) {
                    // Captura y neutraliza el error de 'bind' (TypeError)
                    if (e instanceof TypeError && (e.message.includes("bind") || e.message.includes("Cannot read properties of undefined"))) {
                        console.error("✅ POSAPP SETUP GUARD (V63): Se ha interceptado y neutralizado el error de 'bind' (TypeError) durante el setup de PosApp/Chrome. ¡Éxito de intercepción!");
                        return; // Neutraliza el error
                    }
                    throw e;
                }
            },
            // Marca de parche aplicado
            pos_offline_posapp_setup_guard_v63_applied: true, 
        });
        console.log("✅ POSAPP SETUP GUARD V63: Parche de defensa aplicado con éxito.");
        return true;
    } catch (e) {
        console.error("🔴 POSAPP SETUP PATCH FAILED (V63): Falló el parche del prototipo.", e);
        return false;
    }
}

// =================================================================
// 🎯 MOCKS DE SERVICIOS (V63 - Conjunto Completo y Detallado)
// =================================================================

// ----------------------------------------------------------------------
// 1. Mocks de Servicios Críticos (RPC, ORM, SESSION)
// ----------------------------------------------------------------------

const mockedRpcService = {
    start() {
        console.warn("🟢 GLOBAL MOCK: RPC Service Mocked (V63).");
        return {
            query: async function(route, args = {}) {
                const model = args.model || (route.includes('/call_kw/') ? route.split('/call_kw/')[1].split('/')[0] : null);
                const method = args.method;

                if (IS_OFFLINE_ACTIVE) {
                    if (model === 'barcode.nomenclature' && method === 'read') {
                        return Promise.resolve([]);
                    }
                    if (model === 'pos.session' && method === 'load_pos_data') {
                        return Promise.resolve({});
                    }

                    if (route.includes('/web/dataset/call_kw/') || model || route.includes('/web/session/authenticate')) {
                        return Promise.resolve([]);
                    }
                }
                return Promise.resolve([]);
            },
            loadViews: () => Promise.resolve({}),
            name: 'rpc',
            _rpc: () => Promise.resolve(),
        };
    },
};

const mockedOrmService = {
    dependencies: ["rpc"],
    start(env) {
        console.warn("🟢 GLOBAL MOCK: ORM Service Mocked (V63).");
        return {
            search: () => Promise.resolve([]),
            searchRead: (model, domain) => {
                if (model === 'res.users' && domain.length === 1 && domain[0][0] === 'id') {
                    console.warn(`🟢 ORM MOCK: Interceptado res.users. Devolviendo usuario Mock.`);
                    return Promise.resolve([{
                        id: domain[0][2],
                        name: "Offline User Mock",
                        login: "offline@mock",
                        company_id: [1, "Offline Company"],
                        partner_id: [1, "Offline Partner"],
                        pos_security_pin: "0000",
                        active: true,
                        tz: "Europe/Madrid",
                        lang: "es_ES",
                    }]);
                }
                if (model === 'res.company' && domain.length === 1 && domain[0][0] === 'id') {
                    console.warn(`🟢 ORM MOCK: Interceptado res.company. Devolviendo compañía Mock.`);
                    return Promise.resolve([{
                        id: domain[0][2],
                        name: "Offline Company Mock",
                        currency_id: [1, "EUR"]
                    }]);
                }
                console.warn(`🟢 ORM MOCK: Interceptado ${model}. Devolviendo [].`);
                return Promise.resolve([]);
            },
            call: () => Promise.resolve(null),
            read: () => Promise.resolve(null),
            rpc: env.services.rpc,
            name: 'orm',
        };
    },
};

const mockedSessionService = {
    start() {
        console.warn("🟢 GLOBAL MOCK: SESSION Service Mocked (V63).");
        return {
            name: "session",
            uid: 1,
            user_context: {},
            db: "offline_db_mock",
            session_id: "mock_session_id",
            user_id: 1,
            partner_id: 1,
            company_id: 1,
            debug: false,
            rpc: () => Promise.resolve(),
            prevent_unload: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
        };
    },
};

// ----------------------------------------------------------------------
// 2. Mocks de Servicios Odoo Web (UI, USER, COMPANY, NOTIFICATION, etc.)
// ----------------------------------------------------------------------

// 🚨 MOCK DE UI CRÍTICO (Defensa de 'bind')
const mockedUIService = {
    start() {
        console.warn("🟢 GLOBAL MOCK: UI Service Mocked (V63 - CRITICAL PATCH).");
        return {
            title: {
                setParts: () => {},
                reset: () => {}
            },
            toggleFullscreen: () => {},
            block: () => {}, 
            unblock: () => {}, 
            // Elementos que Chrome.setup usa y fallan el bind (CRÍTICOS)
            bus: {
                on: () => {},
                off: () => {},
                trigger: () => {},
            },
            blockUI: () => {},
            unblockUI: () => {},
            is_mobile: false,
            isSmall: () => false,
            isMobile: () => false,
            addLoadingTask: (promise) => {
                if (promise && promise.catch) {
                    return promise.catch(() => {});
                }
                return Promise.resolve();
            },
            removeLoadingTask: (promise) => Promise.resolve(promise),
        };
    },
};
window.posOfflineDataHandler.mockedUIService = mockedUIService; // Guardamos para el parche temprano de registro

const mockedUserService = {
    dependencies: ["orm"],
    start(env) {
        console.warn("🟢 GLOBAL MOCK: USER Service Mocked.");
        return {
            name: "Offline User",
            userId: 1,
            isSystem: true,
            hasGroup: () => Promise.resolve(true),
            getUserId: () => 1,
            loadUser: () => Promise.resolve({
                id: 1,
                name: "Offline User",
                partner_id: [1, "Mock Partner"]
            }),
            user: {
                id: 1,
                name: "Offline User",
                company_id: [1, "Offline Company"]
            }
        };
    },
};

const mockedCompanyService = {
    start(env) {
        console.warn("🟢 GLOBAL MOCK: COMPANY Service Mocked (Forzado Síncrono).");
        const companyData = {
            id: 1,
            name: "Offline Company Mock",
            currency_id: [1, "EUR"]
        };
        return {
            get: (id = 1) => Promise.resolve(companyData),
            load: (id = 1) => Promise.resolve(companyData),
            company: companyData
        };
    },
};

const mockedNotificationService = {
    start() {
        console.warn("🟢 GLOBAL MOCK: NOTIFICATION Service Mocked.");
        return {
            notify: () => {},
            add: () => {},
            close: () => {},
            bus: {
                on: () => {},
                off: () => {}
            },
        };
    },
};

const mockedDialogService = {
    start() {
        console.warn("🟢 GLOBAL MOCK: DIALOG Service Mocked.");
        return {
            add: () => {},
            close: () => {},
            open: () => {},
        };
    },
};

const mockedCommandService = {
    start() {
        console.warn("🟢 GLOBAL MOCK: COMMAND Service Mocked.");
        return {
            add: () => {},
            remove: () => {},
            open: () => {},
        };
    },
};

const mockedFieldService = {
    start() {
        console.warn("🟢 GLOBAL MOCK: FIELD Service Mocked.");
        return {
            getFields: () => Promise.resolve({}),
        };
    },
};

const mockedProfilingService = {
    start() {
        console.warn("🟢 GLOBAL MOCK: PROFILING Service Mocked.");
        return {
            start: () => {},
            stop: () => {},
            isEnabled: () => false,
        };
    },
};

// 🚨 CRITICAL FIX: MOCK DEL SERVICIO DE TRADUCCIÓN (Translation Service)
// 💡 FIX V63: Añadir getLanguage y translate
const mockedTranslationService = {
    start() {
        console.warn("🟢 GLOBAL MOCK: TRANSLATION Service Mocked (V63 - Enhanced Fix).");
        return {
            // Devuelve un objeto vacío o la clave de entrada para evitar fallos.
            get: () => ({}), 
            getTranslations: () => ({}), 
            getTranslation: (key) => key,
            getLanguage: () => ({ code: 'es' }), // Necesario para la inicialización
            translate: (key) => key, // Redundante, pero previene fallos
            // Evita la llamada de red forzando una resolución de promesa vacía.
            load: () => Promise.resolve(), 
        };
    },
};


// 🚨 CRITICAL FIX: ACTUALIZACIÓN DEL MOCK DE LOCALIZATION (Localization Service)
const mockedLocalizationService = {
    start() {
        console.warn("🟢 GLOBAL MOCK: LOCALIZATION Service Mocked (V63 - RETAIN FIX).");
        return {
            // 💡 FIX CRÍTICO: Añadir translate y code para resolver el 'translation error' de LazyTranslatedString
            translate: (key, data) => { 
                // Devuelve la clave tal cual, lo que permite que LazyTranslatedString se resuelva.
                return key;
            },
            code: 'es', // Código de idioma necesario para la inicialización
            
            date: {
                format: (date) => date.toLocaleDateString()
            },
            time: {
                format: (time) => time.toLocaleTimeString()
            },
            formatFloat: (val) => val.toFixed(2),
            formatTime: (val) => val,
            formatDate: (val) => val,
            formatDateTime: (val) => val,
            locale: { 
                direction: 'ltr',
                dateFormat: 'YYYY/MM/DD',
                dateTimeFormat: 'YYYY/MM/DD HH:mm:ss',
                timeFormat: 'HH:mm:ss',
                decimalPoint: '.',
                thousandsSeparator: ',',
                grouping: [3, 0],
                monetary_pattern: '%,.2f',
                date: 'YYYY-MM-DD',
                time: 'HH:mm:ss',
            },
            get isRTL() { return false; },
        };
    },
};

const mockedNameService = {
    start: () => ({
        name: "offline_mock"
    }),
};

const mockedViewService = {
    start() {
        console.warn("🟢 GLOBAL MOCK: VIEW Service Mocked.");
        return {
            loadViews: () => Promise.resolve({}),
            getDefaultView: () => Promise.resolve({}),
        };
    },
};

const mockedTourService = {
    start() {
        console.warn("🟢 GLOBAL MOCK: TOUR_SERVICE Mocked.");
        return {
            bus: {
                addEventListener: () => {},
                removeEventListener: () => {}
            },
            is_active: () => false,
            on: () => {},
            off: () => {},
        };
    },
};

const mockedActionService = {
    start() {
        console.warn("🟢 GLOBAL MOCK: ACTION Service Mocked.");
        return {
            doAction: () => Promise.resolve(),
            loadAction: () => Promise.resolve({}),
        };
    },
};

const mockedReportService = {
    start() {
        console.warn("🟢 GLOBAL MOCK: REPORT Service Mocked.");
        return {
            doAction: () => Promise.resolve(),
        };
    },
};

const mockedRouterService = {
    start() {
        console.warn("🟢 GLOBAL MOCK: ROUTER Service Mocked.");
        return {
            current: {
                hash: {}
            },
            on: () => {},
            off: () => {},
            navigate: () => {},
        };
    },
};

const mockedMainComponents = {
    start() {
        console.warn("🟢 GLOBAL MOCK: main_components Service Mocked.");
        return {
            add: () => {},
            remove: () => {},
            get: () => [],
        };
    },
};

const mockedPopupsService = {
    start() {
        console.warn("🟢 GLOBAL MOCK: POPUPS Service Mocked.");
        return {
            add: () => {},
            close: () => {},
        };
    },
};

const mockedDebugService = {
    start() {
        console.warn("🟢 GLOBAL MOCK: DEBUG Service Mocked (V63).");
        return {
            bus: {
                on: () => {},
                off: () => {}
            },
            registerGlobalCommands: () => {},
            isActive: () => false,
        };
    },
};

// ----------------------------------------------------------------------
// 3. Mocks de Servicios del TPV y Hardware
// ----------------------------------------------------------------------

const mockedPosService = {
    dependencies: ["user", "orm", "rpc"],
    start(env) {
        console.warn("🟢 GLOBAL MOCK: POS Service Mocked (Para evitar dependencias).");
        return {
            getPos: () => ({}),
            load_server_data: () => Promise.resolve(),
            db: {
                load: (model, callback) => callback(null, []),
                get_product_by_id: (id) => false,
            }
        };
    },
};

const mockedPosBus = {
    start() {
        console.warn("🟢 GLOBAL MOCK: PosBus Service Mocked (V63).");
        return {
            start: () => {},
            getBusId: () => 99999,
            isActive: () => false,
            addChannel: () => {},
            removeChannel: () => {},
            polling: () => Promise.resolve(null),
            on: () => {},
            off: () => {},
        };
    },
};

const mockedHardwareProxy = {
    start() {
        console.warn("🟢 GLOBAL MOCK: HARDWARE_PROXY Service Mocked.");
        return {
            add_listener: () => {},
            remove_listener: () => {},
            message: () => Promise.resolve({}),
            init: () => Promise.resolve(true),
        };
    },
};

const mockedPrinter = {
    start() {
        console.warn("🟢 GLOBAL MOCK: PRINTER Service Mocked.");
        return {
            printReceipt: () => Promise.resolve(),
            is_enabled: () => false,
        };
    },
};

const mockedCustomerFacingDisplay = {
    start() {
        console.warn("🟢 GLOBAL MOCK: Customer Facing Display Service Mocked.");
        return {
            isReady: () => Promise.resolve(),
            start: () => {},
            setSale: () => {},
        };
    },
};

const mockedBarcodeReader = {
    start() {
        console.warn("🟢 GLOBAL MOCK: Barcode Reader Service Mocked (V63).");
        return {
            init: () => Promise.resolve(),
            add_action_callback: () => () => {},
            scan: () => {},
            set_active_session_channel: () => {},
        };
    },
};

const mockedContextualUtils = {
    start() {
        console.warn("🟢 GLOBAL MOCK: Contextual Utils Service Mocked.");
        return {
            isSmall: () => false,
            isMobile: () => false,
        };
    },
};

// ----------------------------------------------------------------------
// 4. Mocks de Servicios de Módulos Offline Deshabilitados
// ----------------------------------------------------------------------

const mockedPrefetch = {
    isOfflineMock: true,
    start() {
        console.warn("🟢 GLOBAL MOCK: pos_offline_prefetch Mocked.");
        return {
            fetch: () => Promise.resolve(),
            pos_offline_info_get: () => Promise.resolve({}),
        };
    },
};

const mockedAutoflush = {
    isOfflineMock: true,
    start() {
        console.warn("🟢 GLOBAL MOCK: pos_offline_autoflush Mocked.");
        return {
            start: () => {}
        };
    },
};

const mockedChooseLocation = {
    isOfflineMock: true,
    start() {
        console.warn("🟢 GLOBAL MOCK: pos_choose_location_on_validate Mocked.");
        return {
            choose: () => Promise.resolve()
        };
    },
};


// =================================================================
// 🚨 INTERCEPCIÓN AGRESIVA DEL CARGADOR DE MÓDULOS (V63)
// =================================================================

if (IS_OFFLINE_ACTIVE && window.odoo && window.odoo.define) {
    
    // Servicios que desactivamos en el registro temprano (por si otro módulo los intentó registrar)
    const SERVICES_TO_DISABLE = [
        "pos_offline_prefetch",
        "pos_offline_autoflush",
        "pos_choose_location_on_validate"
    ];

    console.log("🔥 [PRE-PATCH] Aplicando parche de neutralización al registro de servicios.");

    const serviceRegistry = registry.category("services");

    patch(serviceRegistry, {
        add(name, service, options = {}) {
            if (SERVICES_TO_DISABLE.includes(name) && serviceRegistry.contains(name)) {
                console.warn(`⚠️ REGISTRY NEUTRALIZED: Ignorando el registro duplicado del servicio '${name}'.`);
                return;
            }

            // 🛑 Parche de Defensa V63 para el UI Service
            if (name === 'ui' && window.posOfflineDataHandler.mockedUIService) {
                console.warn("🟢 UI PATCH AGGRESSIVE: Forzando la inyección del servicio 'ui' Mocked.");
                return super.add(name, window.posOfflineDataHandler.mockedUIService, { force: true });
            }

            return super.add(name, service, options);
        },
    });
    console.log("✅ SERVICE REGISTRY PATCH: Parche de neutralización de 'add' aplicado.");
    
    // --- Interceptamos odoo.define para ganar la carrera al PosApp.setup() ---
    
    const originalOdooDefine = window.odoo.define;
    
    console.warn("🔥 INTERCEPTANDO: Se ha interceptado la función 'odoo.define' para parchear PosApp a tiempo.");

    window.odoo.define = function(moduleName, dependencies, factory) {
        
        if (moduleName !== POS_APP_MODULE_NAME) {
            return originalOdooDefine(moduleName, dependencies, factory);
        }

        console.warn(`🔥 MÓDULO DETECTADO: Interceptando la definición de ${POS_APP_MODULE_NAME}.`);
        
        const wrappedFactory = function(require, exports, module) {
            
            // 1. Ejecutamos la definición original del módulo (esto crea la clase PosApp/Chrome)
            const moduleReturn = factory(require, exports, module);
            
            // 2. Ejecutamos el parche con 0ms de retraso para garantizar que la clase esté disponible 
            //    en module.exports, pero antes de que Odoo la use para instanciar la App.
            setTimeout(() => {
                try {
                    // PosApp o Chrome, dependiendo de la versión exacta de Odoo
                    const PosAppClass = module.exports.PosApp || module.exports.Chrome;
                    if (PosAppClass) {
                        applyCriticalPosAppPatch(PosAppClass);
                    } else {
                        console.warn("⚠️ MÓDULO DETECTADO: PosApp/Chrome no se encontró en module.exports.");
                    }
                } catch (e) {
                    console.error("🔴 ERROR EN INTERCEPCIÓN ASÍNCRONA de PosApp.", e);
                }
            }, 0); 

            return moduleReturn;
        };

        return originalOdooDefine(moduleName, dependencies, wrappedFactory);
    };
}


// =================================================================
// 🎯 REGISTRO FINAL DE MOCKS DE SERVICIOS
// =================================================================

// ⚠️ Este bloque registra todos los mocks FORZADAMENTE para asegurar que el registro
//    final de Odoo (que se ejecuta después de la intercepción) tenga los mocks listos.

if (IS_OFFLINE_ACTIVE) {
    try {
        const services = registry.category("services");

        // [REGISTRO DIRECTO CON FORCE: TRUE]
        services.add("rpc", mockedRpcService, { force: true });
        services.add("orm", mockedOrmService, { force: true });
        services.add("session", mockedSessionService, { force: true });
        services.add("user", mockedUserService, { force: true });
        services.add("company", mockedCompanyService, { force: true });
        services.add("ui", window.posOfflineDataHandler.mockedUIService, { force: true });
        services.add("notification", mockedNotificationService, { force: true });
        services.add("dialog", mockedDialogService, { force: true });
        services.add("command", mockedCommandService, { force: true });
        services.add("router", mockedRouterService, { force: true });
        services.add("field", mockedFieldService, { force: true });
        services.add("profiling", mockedProfilingService, { force: true });
        
        // 🚨 MOCKS CRÍTICOS PARA LA TRADUCCIÓN
        services.add("localization", mockedLocalizationService, { force: true });
        services.add("translation", mockedTranslationService, { force: true });
        
        services.add("name", mockedNameService, { force: true });
        services.add("view", mockedViewService, { force: true });
        services.add("action", mockedActionService, { force: true });
        services.add("report", mockedReportService, { force: true });
        services.add("tour_service", mockedTourService, { force: true });
        services.add("main_components", mockedMainComponents, { force: true });
        services.add("popups", mockedPopupsService, { force: true });
        services.add("debug", mockedDebugService, { force: true });
        services.add("pos", mockedPosService, { force: true });
        services.add("pos_bus", mockedPosBus, { force: true });
        services.add("hardware_proxy", mockedHardwareProxy, { force: true });
        services.add("printer", mockedPrinter, { force: true });
        services.add("barcode_reader", mockedBarcodeReader, { force: true });
        services.add("contextual_utils_service", mockedContextualUtils, { force: true });
        services.add("iface_customer_facing_display", mockedCustomerFacingDisplay, { force: true });
        services.add("customer_display", mockedCustomerFacingDisplay, { force: true });
        services.add("pos_offline_prefetch", mockedPrefetch, { force: true });
        services.add("pos_offline_autoflush", mockedAutoflush, { force: true });
        services.add("pos_choose_location_on_validate", mockedChooseLocation, { force: true });
        
        console.log("🔥 GLOBAL SERVICE MOCKS: Critical services registered (V63 - Fix de Traducción Profunda).");
    } catch (e) {
        console.error("🔴 GLOBAL SERVICE MOCKS: Failed to register mocks.", e);
    }
} else {
    console.log("🟡 GLOBAL SERVICE MOCKS: Offline mode not detected. Skipping critical service mocks.");
}