/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { Navbar } from "@point_of_sale/app/navbar/navbar";
import { useService } from "@web/core/utils/hooks";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { onMounted, onWillUnmount } from "@odoo/owl";

const DB_NAME = 'PosOfflineDB';
const STORE_NAME = 'closure_logs';
const DB_VERSION = 1;

function openIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = (event) => reject(event.target.error);
        request.onsuccess = (event) => resolve(event.target.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'timestamp' });
            }
        };
    });
}

async function saveIndexedDBLog(logEntry) {
    try {
        const db = await openIndexedDB();
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(logEntry);

        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                resolve();
            };
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    } catch (error) {
    }
}

async function getAllIndexedDBLogs() {
    try {
        const db = await openIndexedDB();
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        return new Promise((resolve, reject) => {
            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(event.target.error);
        });
    } catch (error) {
        return [];
    }
}

async function clearIndexedDBLogs() {
    try {
        const db = await openIndexedDB();
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                resolve();
            };
            request.onerror = (event) => reject(event.target.error);
        });
    } catch (error) {
    }
}

function ordersCount() {
    const DB_NAME = "POS_Order";
    const STORE_NAME = "store1";
    const DB_VERSION = 1;

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            reject(event.target.error); 
        };

        request.onsuccess = (event) => {
            const db = event.target.result;

            try {
                const transaction = db.transaction([STORE_NAME], "readonly");
                const objectStore = transaction.objectStore(STORE_NAME);
                const countRequest = objectStore.count();

                countRequest.onsuccess = () => {
                    const totalPedidos = countRequest.result;
                    resolve(totalPedidos); 
                };

                countRequest.onerror = (event) => {
                    reject(event.target.error);
                };

                transaction.oncomplete = () => {
                    db.close();
                };

            } catch (error) {
                db.close();
                reject(error);
            }
        };

        request.onupgradeneeded = (event) => {  
             event.target.transaction.abort(); 
             reject(new Error("La base de datos no está disponible o la versión es incorrecta."));
        };
    });
}

async function isOdooReachable() {
    try {
        const response = await fetch("/web", {
            method: "HEAD", 
            cache: "no-store",
            signal: AbortSignal.timeout(3000), 
        });
        return response.ok;
    } catch (e) {
        return false;
    }
}

patch(Navbar.prototype, {
    __OWL_DEBUG__: "pos_offline_session.NavbarDOMPatch",

    setup() {
        super.setup();
        this.dialog = useService("dialog");
        this.rpc = useService("rpc");
        this._syncAttemptCount = 0;
        this._maxSyncAttempts = 5;

        this.isCurrentlyOffline = !navigator.onLine;

        // Se exponen el estado y la función de log
        this.pos.isCurrentlyOffline = this.isCurrentlyOffline;
        this.pos._saveLog = this._saveLog.bind(this);

        this.updateConnectionStatus = async () => {
            const isDeviceOnline = navigator.onLine;
            let isOdooOnline = false;

            if (isDeviceOnline) {
                isOdooOnline = await isOdooReachable();
            }

            const newStatusOffline = !isDeviceOnline || !isOdooOnline;

            if (this.isCurrentlyOffline !== newStatusOffline) {
                this.pos.isCurrentlyOffline = newStatusOffline; 
                
                if (newStatusOffline) { 
                    this._saveLog('network_lost', `El dispositivo pasó a OFFLINE. Razón: ${!isDeviceOnline ? 'Dispositivo' : 'Servidor Odoo no accesible'}.`);
                } else { 
                    this._saveLog('network_recovered', 'El dispositivo recuperó la conexión ONLINE y el servidor Odoo es accesible.');
                    this._syncAttemptCount = 0;
                    setTimeout(() => {
                        this._syncOfflineLogs();
                    }, 2000);
                }

                this.isCurrentlyOffline = newStatusOffline;
            }

        };
        

        window.addEventListener("online", this.updateConnectionStatus);
        window.addEventListener("offline", this.updateConnectionStatus);

        setTimeout(() => this.updateConnectionStatus(), 500);

        onMounted(this.setupCloseButtonInterceptor);
        
        setTimeout(() => {
            this._syncOfflineLogs();
        }, 1000);
        

        onWillUnmount(() => {
            window.removeEventListener("online", this.updateConnectionStatus);
            window.removeEventListener("offline", this.updateConnectionStatus);
            
        });
    },

    async _saveLog(eventType, details) {
        const session_id = this.pos.pos_session?.id;
        const user_id = this.pos.pos_session?.user_id?.[0];

        if (session_id && user_id) {
            const logEntry = {
                timestamp: new Date().toISOString(),
                session_id: session_id,
                user_id: user_id,
                eventType: eventType,
                details: details,
            };
            await saveIndexedDBLog(logEntry);
        } else {
        }
    },
    
    setupCloseButtonInterceptor() {
        const topHeader = document.querySelector('.pos-topheader');
        if (!topHeader) {
            return;
        }

        const observer = new MutationObserver((mutationsList, observer) => {
            const subMenu = topHeader.querySelector('.sub-menu');
            const closeButtonAnchor = subMenu ? subMenu.querySelector('.close-button a') : null;

            if (closeButtonAnchor && !closeButtonAnchor._is_intercepted) {

                closeButtonAnchor.onclick = async (event) => {
                    
                    if (this.isCurrentlyOffline) {
                        const orderlength = await ordersCount();
                        event.preventDefault();
                        event.stopPropagation();

                        await this._saveLog(
                            'attempted_close',
                            `El usuario hizo clic en "Cerrar Sesión" estando OFFLINE. Órdenes pendientes: ${orderlength}. Se muestra la advertencia.`
                        );

                        const shouldContinue = await this.showOfflineCloseWarning();

                        if (shouldContinue) {
                            closeButtonAnchor.onclick = null;
                            closeButtonAnchor.click();
                        } else {
                        }

                    } else {
                    }
                };

                closeButtonAnchor._is_intercepted = true;
            }
        });

        observer.observe(topHeader, { childList: true, subtree: true });
    },
    
    async showOfflineCloseWarning() {
        const sessionName = this.pos.pos_session.name || 'Sesión POS';

        const warningTitle = "🛑 ADVERTENCIA CRÍTICA: SIN CONEXIÓN A INTERNET";

        const orderlength = await ordersCount();

        const warningBody = `
            La Sesión ${sessionName} no tiene conexión a Internet.
            CERRAR SESIÓN en este estado puede llevar a la **PÉRDIDA PERMANENTE de las órdenes**
            no sincronizadas.

            Hay ${orderlength} órdenes pendientes. Solo debe presionar "He Entendido"
            si ha **entendido y acepta las consecuencias**.
        `;

        try {
            await this.dialog.add(ConfirmationDialog, {
                title: warningTitle,
                body: warningBody,
                confirmLabel: "He Entendido", 
                
                keyboard: false,       
                backdrop: 'static',      
                isCriticalWarning: true, 
            });

            const logDetails = `El usuario le dió a aceptar en el mensaje de aviso. Órdenes pendientes: ${orderlength}.`;
            await this._saveLog('accepted_close', logDetails);

            return true; 

        } catch (e) {
            return false; 
        }
    },
    
    async _retrySyncLogs(delay = 2000) {
        if (this.isCurrentlyOffline) {
            return;
        }

        this._syncAttemptCount += 1;
        if (this._syncAttemptCount > this._maxSyncAttempts) {
            return;
        }

        await new Promise(resolve => setTimeout(resolve, delay));
        await this._syncOfflineLogs();
    },

    async _syncOfflineLogs() {
        if (this.isCurrentlyOffline) {
            return;
        }

        const logsToSync = await getAllIndexedDBLogs();

        if (logsToSync.length === 0) {
            return;
        }

        const formattedLogs = logsToSync.map(log => ({
            session_id: log.session_id,
            user_id: log.user_id,
            timestamp: log.timestamp,
            event_type: log.eventType,
            details: log.details,
        }));

        try {
            const response = await fetch('/web/dataset/call_kw/pos.offline.log/create_multiple_log_entries', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': odoo.csrf_token,
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'call',
                    params: {
                        model: 'pos.offline.log',
                        method: 'create_multiple_log_entries',
                        args: [formattedLogs],
                        kwargs: {},
                    }
                }),
            });

            const result = await response.json();

            if (result.error) {
                throw new Error(`Odoo Server Error (RPC Response): ${result.error.message}`);
            }

            await clearIndexedDBLogs();
            this._syncAttemptCount = 0;

        } catch (error) {
            this._retrySyncLogs(2000);
        }
    },
});

patch(ConfirmationDialog, {
    props: {
        ...ConfirmationDialog.props,
        isCriticalWarning: { type: Boolean, optional: true, default: false },
        keyboard: { type: Boolean, optional: true },
        backdrop: { type: [Boolean, String], optional: true }, 
    },
});

patch(ConfirmationDialog.prototype, {
    setup() {
        super.setup();
        
        if (this.props.isCriticalWarning) {
            
            const handleKeydown = (ev) => {
                if (ev.key === "Escape") {
                    ev.stopPropagation(); 
                    ev.preventDefault(); 
                }
            };
            
            document.addEventListener('keydown', handleKeydown, true); 

            onWillUnmount(() => {
                document.removeEventListener('keydown', handleKeydown, true);
            });
        }
    },
});