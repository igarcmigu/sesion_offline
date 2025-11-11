/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/store/pos_store"; 
import { Product } from "@point_of_sale/app/store/models"; 

// 🛑 GUARDIA GLOBAL CONTRA DOBLE CARGA
if (window.POSPosStorePatchLoaded) { return; }
window.POSPosStorePatchLoaded = true;
console.log("🔥 [LOAD CHECK] pos_offline_rpc_patch.js ha iniciado la ejecución (V9: Fix Carga Crítica Agresiva).");

// =================================================================
// 🎯 FUNCIONES DE AYUDA Y CONTROL DE MODO (Exportadas para el Data Handler)
// =================================================================

function parseParams(paramString) {
 const params = {};
 if (paramString) {
  paramString.split('&').forEach(part => {
   const [key, value] = part.split('=');
   if (key) { params[key] = decodeURIComponent(value || 'true'); }
  });
 }
 return params;
}

export function getUrlParameters() {
 if (typeof window === 'undefined' || !window.location) { return {}; }
 const searchParams = parseParams(window.location.search.substring(1));
 const hashParams = parseParams(window.location.hash.substring(1));
 return { ...searchParams, ...hashParams };
}

/** ⚠️ FUNCIÓN CRÍTICA: Determina si el TPV debe operar en modo offline/mockeado. **/
export function isPatchingOfflineMode() {
  const urlParams = getUrlParameters();
  const forceOffline = urlParams.force_offline === '1';
  const isBrowserOffline = (typeof navigator !== 'undefined') && (navigator.onLine === false);
  
  return forceOffline || isBrowserOffline;
}

function patchRpcService(env) {
  if (!isPatchingOfflineMode()) {
    console.log("🟡 RPC MOCK: Modo ONLINE detectado. Omitiendo parche de RPC.");
    return;
  }
 const originalQuery = env.services.rpc.query;
 
 env.services.rpc.query = async function(route, args = {}) {
  const model = args.model || (route.includes('/call_kw/') ? route.split('/call_kw/')[1].split('/')[0] : null);
  const method = args.method;
  
  if (model) {
   if (model === 'pos.order' && (method === 'create_from_ui' || method === 'search_read')) { 
    return originalQuery.apply(this, arguments);
   }
   if (model === 'barcode.nomenclature' && method === 'read') { return Promise.resolve([]); }
   if (model === 'pos.session' && method === 'load_pos_data') { 
    console.warn(`🟢 RPC MOCK: Mockeado RPC CRÍTICO a ${model}/${method}. Devolviendo datos vacíos para forzar carga local.`);
    return Promise.resolve({}); 
   }
   console.warn(`🟢 RPC MOCK: Mockeado RPC secundario a ${model}/${method}.`);
   return Promise.resolve([]); 
  }
  
  if (route.includes('/web/session/authenticate')) { return Promise.resolve({ uid: 1, is_superuser: true }); }
  
  return Promise.resolve({});
 };
 env.services.rpc.query._isPatched = true; 
  console.log("✅ RPC Service parcheado para modo OFFLINE/FORZADO.");
}


// =================================================================
// 🎯 PATCH: Product Model (FIX de Referencias y Formato)
// =================================================================

function patchProductModelInStore(pos) {
 const ProductPrototype = Product ? Product.prototype : (pos?.models?.Product?.prototype);
 if (!ProductPrototype) { return; }
    
    // FIX CRÍTICO: Parchear getAddProductOptions para inyectar la referencia 'pos'
    if (ProductPrototype.getAddProductOptions && !ProductPrototype.getAddProductOptions._isPatched) {
        const originalGetAddProductOptions = ProductPrototype.getAddProductOptions;
        
        patch(ProductPrototype, {
            getAddProductOptions(options) {
                // Inyectamos la referencia 'pos' si falta
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

 // Parchear getFormattedUnitPrice
    if (!ProductPrototype.getFormattedUnitPrice || ProductPrototype.getFormattedUnitPrice._isPatched) { 
        // Ya parcheado, o no existe para parchear
    } else {
        patch(ProductPrototype, {
            __OWL_DEBUG__: "pos_offline_session.ProductPatchRuntime",
            
            getFormattedUnitPrice(price) {
                const formatPrice = this.pos?.env?.utils?.formatPrice;
                if (formatPrice) {
                    this.getFormattedUnitPrice._isPatched = true; 
                    return formatPrice(price);
                }
                // Fallback defensivo
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
// 🎯 PATCH PosStore: Control de Modo y RPC
// =================================================================

// FUNCIÓN DUMMY CRÍTICA
const _loadFontsDummy = async function() {
    console.log("⚠️ [POS OFFLINE PATCH] _loadFonts dummy ejecutado para evitar TypeError.");
    return Promise.resolve();
};

patch(PosStore.prototype, {
 __OWL_DEBUG__: "pos_offline_session.PosStorePatch",

 // 🎯 FIX CRÍTICO: Definimos _loadFonts
 _loadFonts: _loadFontsDummy,

 async setup(...args) {
  console.log("🔥 [PRE-SETUP] Iniciando PosStore setup parcheado.");

    // FIX CRÍTICO V8: Inicialización defensiva de objetos base para prevenir 'cannot read properties of null (reading use_proxy)'
        if (!this.config) {
            this.config = {};
        }
        if (!this.company) {
            this.company = {};
        }

    patchProductModelInStore(this);
  
  if (this.env && this.env.services && this.env.services.rpc && !this.env.services.rpc._isPatched) {
   patchRpcService(this.env);
  }
  
  try {
   await super.setup(...args); 
   console.log("🔥 [POST-SETUP] Super setup finalizado.");
  } catch (e) {
   if (isPatchingOfflineMode()) {
    console.warn("⚠️ [SETUP CATCH] Fallo de conexión inicial esperado (Modo Offline/Forzado). Continuando con carga local.", e);
        return; 
   }
   console.error("🔴 [SETUP CRÍTICO] Fallo catastrófico en la inicialización base en modo online.", e);
   throw e;
  }
 },

 get isOnline() {
  if (isPatchingOfflineMode()) { return true; } 
  return super.isOnline;
 },
});


// =================================================================
// 🚨 FAILSAFE CRÍTICO: Doble chequeo de _loadFonts
// =================================================================

if (!PosStore.prototype._loadFonts) {
    console.warn("🚨 [POS OFFLINE CRITICAL FAILSAFE] El patch de _loadFonts falló. Forzando asignación directa al prototype.");
    // Asignación agresiva directa al prototipo para garantizar que el método existe.
    Object.assign(PosStore.prototype, {
        _loadFonts: _loadFontsDummy
    });
} else {
    console.log("✅ [POS OFFLINE PATCH VERIFIED] _loadFonts existe en el prototype después del patch.");
}


// =================================================================
// 🎯 REGISTRO INCONDICIONAL DEL SERVICE WORKER
// =================================================================

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/pos_sw.js', { scope: '/' })
   .then(reg => { 
        console.log('✅ [SW Registration] Éxito. El Service Worker está listo para cachear.'); 
      })
   .catch(error => { console.error('🔴 [SW Registration] Fallo en el registro del Service Worker.', error); });
 }
}

registerServiceWorker();